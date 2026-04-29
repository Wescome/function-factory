import { Agent, callable, type FiberContext, type FiberRecoveryContext } from 'agents'
import { createClientFromEnv, type ArangoClient } from '@factory/arango-client'
import { validateArtifact } from '@factory/artifact-validator'
import { buildSynthesisGraph } from './graph'
import type { GraphDeps } from './graph'
import { createModelBridge } from './model-bridge-do'
import { createInitialState, type GraphState, type Verdict } from './state'
import { makeExecutionRole, type SandboxDeps } from './sandbox-role'
import { buildSandboxDeps as buildRealSandboxDeps } from './sandbox-deps-factory'
import { ArchitectAgent } from '../agents/architect-agent'
import { CoderAgent } from '../agents/coder-agent'
import { PlannerAgent } from '../agents/planner-agent'
import { TesterAgent } from '../agents/tester-agent'
import { VerifierAgent } from '../agents/verifier-agent'
import { CriticAgent, type CodeReviewInput } from '../agents/critic-agent'
import { prefetchAgentContext, formatContextForPrompt } from '../agents/context-prefetch'
import { resolveAgentModel } from '../agents/resolve-model'
import { HotConfigLoader, seedHotConfig } from '../config/hot-config'
import { createCRP } from '../crp'
import { topologicalSort } from './layer-dispatch'
import { createLedger } from './completion-ledger'
import type { AtomResult } from './atom-executor'

export interface CoordinatorEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  OFOX_API_KEY?: string
  /** CF API token for Workers AI REST API */
  CF_API_TOKEN?: string
  /** Workers AI binding — used by pipeline stages (callProvider). */
  AI?: { run(model: string, input: Record<string, unknown>): Promise<Record<string, unknown>> }
  /** @cloudflare/sandbox DurableObject namespace binding. Optional until sandbox container is deployed. */
  SANDBOX?: unknown
  /** Queue for publishing synthesis results back to the Worker (avoids self-fetch deadlock) */
  SYNTHESIS_RESULTS?: { send(body: unknown): Promise<void> }
  /** v5.1: Queue for dispatching individual atoms to AtomExecutor DOs */
  SYNTHESIS_QUEUE?: { send(body: unknown): Promise<void> }
}

export interface SynthesisResult {
  functionId: string
  verdict: Verdict
  tokenUsage: number
  repairCount: number
  roleHistory: { role: string; tokenUsage: number; timestamp: string }[]
  briefingScript?: unknown
  semanticReview?: unknown
}

export class SynthesisCoordinator extends Agent<CoordinatorEnv> {
  private db: ArangoClient | null = null
  private currentWorkGraphId: string = 'unknown'
  private configLoader: HotConfigLoader | null = null
  private configSeeded = false

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
      this.db.setValidator(validateArtifact)
    }
    return this.db
  }

  private getConfigLoader(): HotConfigLoader {
    if (!this.configLoader) {
      this.configLoader = new HotConfigLoader(this.getDb())
    }
    return this.configLoader
  }

  private async ensureConfigSeeded(): Promise<void> {
    if (this.configSeeded) return
    try {
      await seedHotConfig(this.getDb())
      this.configSeeded = true
    } catch { /* non-fatal — config loading still works with defaults */ }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/synthesize' && request.method === 'POST') {
      const body = await request.json() as {
        workGraph: Record<string, unknown>
        dryRun?: boolean
        specContent?: string
        workflowId?: string
      }

      // Store workflowId in DO storage so alarm handler can also publish results
      if (body.workflowId) await this.ctx.storage.put('__workflowId', body.workflowId)

      const result = await this.synthesize(body.workGraph, {
        dryRun: body.dryRun ?? false,
        ...(body.specContent ? { specContent: body.specContent } : {}),
      })

      // If callback info was provided, notify the Worker (fire-and-forget pattern).
      // The Worker's /synthesis-callback route will forward to the Workflow.
      await this.notifyCallback(result)

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not found', { status: 404 })
  }

  /**
   * DO Alarm — wall-clock timeout managed by Cloudflare runtime.
   * Fires even when the V8 isolate is suspended on I/O.
   * setTimeout does NOT tick during fetch() suspension in DOs.
   */
  override async alarm(): Promise<void> {
    const completed = await this.ctx.storage.get<boolean>('__completed')
    if (completed) return

    const state = await this.ctx.storage.get<GraphState>('graphState')
    const workGraphId = (state?.workGraphId ?? await this.ctx.storage.get<string>('workGraphId')) || 'unknown'
    const timedOutState: GraphState = {
      ...(state ?? createInitialState('unknown', {})),
      verdict: {
        decision: 'interrupt',
        confidence: 1.0,
        reason: 'DO alarm: synthesis exceeded wall-clock deadline',
      },
    }
    await this.ctx.storage.put('graphState', timedOutState)
    await this.ctx.storage.put('__alarm_fired', true)
    await this.ctx.storage.put('__completed', true)

    // Notify the Workflow via callback so it doesn't hang at waitForEvent
    await this.notifyCallback(this.buildResult(workGraphId, timedOutState))
  }

  /**
   * Fiber recovery hook — fires when the DO restarts after eviction
   * and finds an interrupted synthesis fiber in SQLite.
   */
  override async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
    const snapshot = ctx.snapshot as { workGraphId?: string; state?: GraphState } | null
    const workGraphId = snapshot?.workGraphId ?? ctx.name.replace('synth-', '')
    console.warn(
      `[Stage 6] Fiber "${ctx.name}" (id=${ctx.id}) recovered after eviction. ` +
      `WorkGraph=${workGraphId}, age=${Date.now() - ctx.createdAt}ms`,
    )

    // If there's a stashed state, mark it as interrupted so the next
    // synthesize() call sees a terminal verdict and returns immediately.
    if (snapshot?.state && !snapshot.state.verdict) {
      const interruptedState: GraphState = {
        ...snapshot.state,
        verdict: {
          decision: 'interrupt',
          confidence: 1.0,
          reason: `Fiber recovered after DO eviction (fiber=${ctx.id})`,
        },
      }
      await this.ctx.storage.put('graphState', interruptedState)
      await this.ctx.storage.put('__completed', true)

      // Notify the Workflow via Queue so it doesn't hang at waitForEvent
      await this.notifyCallback(this.buildResult(workGraphId, interruptedState))
    }
  }

  @callable()
  async synthesize(
    workGraph: Record<string, unknown>,
    opts?: { dryRun?: boolean; specContent?: string },
  ): Promise<SynthesisResult> {
    const workGraphId = (workGraph._key ?? workGraph.id ?? 'unknown') as string
    this.currentWorkGraphId = workGraphId
    const dryRun = opts?.dryRun ?? false

    const persisted = await this.ctx.storage.get<GraphState>('graphState')
    const initialState = persisted ?? createInitialState(workGraphId, workGraph, {
      ...(opts?.specContent ? { specContent: opts.specContent } : {}),
    })

    // Already completed — return cached result
    if (persisted?.verdict?.decision === 'pass' ||
        persisted?.verdict?.decision === 'fail' ||
        persisted?.verdict?.decision === 'interrupt') {
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.put('__completed', true)
      return this.buildResult(workGraphId, persisted)
    }

    // Wrap synthesis in runFiber for crash recovery.
    // If the DO is evicted mid-synthesis, onFiberRecovered fires on restart.
    return this.runFiber(`synth-${workGraphId}`, async (fiberCtx: FiberContext) => {
      const callModel = dryRun
        ? this.dryRunModelBridge()
        : createModelBridge(this.env)

      const persistState = async (state: GraphState, _role?: string) => {
        await this.ctx.storage.put('graphState', state)
        // Checkpoint into fiber for crash recovery
        fiberCtx.stash({ workGraphId, state })
      }

      const fetchMentorRules = async () => {
        try {
          const db = this.getDb()
          return await db.query<{ ruleId: string; rule: string }>(
            `FOR r IN mentorscript_rules
               FILTER r.status == 'active'
               RETURN { ruleId: r._key, rule: r.rule }`,
          )
        } catch {
          return []
        }
      }

      // ADR-008: Seed hot config on first synthesis, then load for this run
      await this.ensureConfigSeeded()
      const hotConfig = await this.getConfigLoader().get()

      // Pre-fetch ArangoDB context ONCE for all agents (replaces multi-turn tool calling)
      const agentContext = await prefetchAgentContext(this.getDb())
      const contextPrompt = formatContextForPrompt(agentContext)

      // Resolve models centrally from hot-loaded routing config
      // ofox.ai agents use OFOX_API_KEY, Workers AI pipeline uses CF_API_TOKEN
      const ofoxKey = this.env.OFOX_API_KEY ?? ''
      const apiKey = ofoxKey || this.env.CF_API_TOKEN || ''
      const architectModel = resolveAgentModel('semantic_review', ofoxKey, hotConfig.routing)
      const plannerModel = resolveAgentModel('planner', apiKey, hotConfig.routing)
      const coderModel = resolveAgentModel('coder', apiKey, hotConfig.routing)
      const criticModel = resolveAgentModel('critic', apiKey, hotConfig.routing)
      const testerModel = resolveAgentModel('tester', apiKey, hotConfig.routing)
      const verifierModel = resolveAgentModel('verifier', apiKey, hotConfig.routing)

      // Instantiate reasoning agents for 9-node topology
      // All agents receive pre-fetched context instead of tools (single-turn, no tool calling)
      // ADR-008: models + alias overrides from hot-loaded config
      const architectAgent = new ArchitectAgent({
        db: this.getDb(),
        apiKey: ofoxKey,
        dryRun,
        ai: this.env.AI,
        model: architectModel,
        aliasOverrides: hotConfig.aliases['BriefingScript'],
        contextPrompt,
      })
      const coderAgent = new CoderAgent({
        db: this.getDb(),
        apiKey: ofoxKey,
        dryRun,
        ai: this.env.AI,
        model: coderModel,
        aliasOverrides: hotConfig.aliases['CodeArtifact'],
        contextPrompt,
      })
      const plannerAgent = new PlannerAgent({
        db: this.getDb(),
        apiKey: ofoxKey,
        dryRun,
        ai: this.env.AI,
        model: plannerModel,
        aliasOverrides: hotConfig.aliases['Plan'],
        contextPrompt,
      })
      const testerAgent = new TesterAgent({
        db: this.getDb(),
        apiKey: ofoxKey,
        dryRun,
        ai: this.env.AI,
        model: testerModel,
        aliasOverrides: hotConfig.aliases['TestReport'],
        contextPrompt,
      })
      const verifierAgent = new VerifierAgent({
        db: this.getDb(),
        apiKey: ofoxKey,
        dryRun,
        ai: this.env.AI,
        model: verifierModel,
        aliasOverrides: hotConfig.aliases['Verdict'],
        contextPrompt,
      })
      const criticAgent = new CriticAgent({
        db: this.getDb(),
        apiKey: ofoxKey,
        dryRun,
        ai: this.env.AI,
        model: criticModel,
        semanticReviewAliasOverrides: hotConfig.aliases['SemanticReview'],
        codeReviewAliasOverrides: hotConfig.aliases['CritiqueReport'],
        contextPrompt,
      })

      const deps: GraphDeps = {
        callModel,
        persistState,
        fetchMentorRules,
        // Phase C: sandbox execution for coder/tester with 3-tier fallback:
        // Tier 1: Sandbox Container (real filesystem, real tools) — stubs throw when no binding
        // Tier 2: Agent (gdk-agent agentLoop in V8, arango_query tool)
        // Tier 3: callModel (raw prompt, no tools)
        executionRole: makeExecutionRole({
          dryRun,
          sandboxDeps: this.buildSandboxDeps(),
          callModel,
          persistState,
          fetchMentorRules,
          coderAgent: { produceCode: (input) => coderAgent.produceCode(input) },
          testerAgent: { runTests: (input) => testerAgent.runTests(input) },
        }),
        // 9-node topology: architect pipeline + planner agent + code-critic
        architectAgent: {
          produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
        },
        plannerAgent: {
          producePlan: (input) => plannerAgent.producePlan(input),
        },
        coderAgent: {
          produceCode: (input) => coderAgent.produceCode(input),
        },
        criticAgent: {
          semanticReview: (input) => criticAgent.semanticReview(input),
          codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
        },
        testerAgent: {
          runTests: (input) => testerAgent.runTests(input),
        },
        verifierAgent: {
          verify: (input) => verifierAgent.verify(input),
        },
        verticalSlicing: true,
      }

      const graph = buildSynthesisGraph(deps)

      // Set wall-clock alarm — survives I/O suspension and DO hibernation
      await this.ctx.storage.put('__completed', false)
      await this.ctx.storage.put('__alarm_fired', false)
      const atomCount = (workGraph.atoms as unknown[] | undefined)?.length ?? 0
      // v5: shorter Phase 1 (5 nodes) + parallel Phase 2, so less total serial time
      const timeoutMs = Math.max(900_000, 900_000 + atomCount * 30_000)
      await this.ctx.storage.setAlarm(Date.now() + timeoutMs)

      let finalState: GraphState
      try {
        // ── Phase 1: serial planning graph (architect → critic → compile → gate-1 → planner) ──
        finalState = await graph.run(initialState, {
          onNodeStart: (name, state) => {
            console.log(`[Stage 6] Phase 1: ${name} starting (tokens ${state.tokenUsage})`)
          },
          maxSteps: 20,
        })
      } catch (err) {
        await this.ctx.storage.deleteAlarm()
        const alarmFired = await this.ctx.storage.get<boolean>('__alarm_fired')
        const reason = alarmFired
          ? 'DO alarm: synthesis exceeded wall-clock deadline'
          : (err instanceof Error ? err.message : 'Phase 1 failed')
        const failState: GraphState = {
          ...initialState,
          verdict: { decision: 'interrupt', confidence: 1.0, reason },
        }
        await this.ctx.storage.delete('graphState')
        await this.ctx.storage.put('__completed', true)
        return this.buildResult(workGraphId, failState)
      }

      // Phase 1 may have ended early (budget exceeded, semantic miscast, gate-1 fail)
      if (finalState.verdict) {
        await this.ctx.storage.deleteAlarm()
        await this.ctx.storage.put('__completed', true)
        await this.ctx.storage.delete('graphState')
        await this.persistSynthesisResult(workGraphId, finalState)
        return this.buildResult(workGraphId, finalState)
      }

      // ── Phase 2: dispatch atoms to queue (event-driven, coordinator exits) ──
      try {
        const wgAtoms = (finalState.workGraph as Record<string, unknown>).atoms as Record<string, unknown>[] ?? []
        const wgDeps = (finalState.workGraph as Record<string, unknown>).dependencies as Record<string, unknown>[] ?? []
        const layers = topologicalSort(wgAtoms, wgDeps)

        console.log(`[Stage 6] Phase 2 dispatch: ${wgAtoms.length} atoms in ${layers.length} layers`)

        const allAtomSpecs: Record<string, Record<string, unknown>> = {}
        for (const atom of wgAtoms) {
          const id = (atom.id ?? atom._key) as string
          allAtomSpecs[id] = atom
        }

        const sharedContext = {
          workGraphId,
          specContent: finalState.specContent ?? null,
          briefingScript: finalState.briefingScript,
        }

        const workflowId = await this.ctx.storage.get<string>('__workflowId')

        // Create completion ledger in ArangoDB
        const db = this.getDb()
        await createLedger(db as never, {
          workGraphId,
          workflowId: workflowId ?? '',
          totalAtoms: wgAtoms.length,
          layers,
          allAtomSpecs,
          sharedContext,
        })

        // Dispatch Layer 0 atoms to SYNTHESIS_QUEUE (type: 'atom-execute')
        const layer0 = layers[0]
        if (layer0 && this.env.SYNTHESIS_QUEUE) {
          for (const atomId of layer0.atomIds) {
            await this.env.SYNTHESIS_QUEUE.send({
              type: 'atom-execute',
              workGraphId,
              workflowId: workflowId ?? '',
              atomId,
              atomSpec: allAtomSpecs[atomId],
              sharedContext,
              upstreamArtifacts: {},
              maxRetries: 3,
              dryRun,
            })
          }
          console.log(`[Stage 6] Phase 2 dispatch: ${layer0.atomIds.length} Layer 0 atoms dispatched to queue`)
        }

        // Coordinator exits — does NOT wait for atoms.
        // Phase 3 runs in the atom-results queue consumer when all atoms complete.
        finalState = {
          ...finalState,
          verdict: undefined as never, // no verdict yet — atoms are running
        }

        // Return Phase 1 result immediately
        await this.ctx.storage.deleteAlarm()
        await this.ctx.storage.put('__completed', true)
        await this.ctx.storage.delete('graphState')

        // Persist Phase 1 result
        await this.persistSynthesisResult(workGraphId, {
          ...finalState,
          verdict: null, // Phase 1 complete, Phase 2 dispatched
        })

        // Notify via SYNTHESIS_RESULTS that Phase 1 is done + atoms dispatched
        if (workflowId && this.env.SYNTHESIS_RESULTS) {
          await this.env.SYNTHESIS_RESULTS.send({
            type: 'phase1-complete',
            workflowId,
            workGraphId,
            atomCount: wgAtoms.length,
            layerCount: layers.length,
          })
        }

        return {
          functionId: workGraphId,
          verdict: {
            decision: 'dispatched' as const,
            confidence: 1.0,
            reason: `Phase 1 complete. ${wgAtoms.length} atoms dispatched to ${layers.length} layers.`,
          },
          tokenUsage: finalState.tokenUsage,
          repairCount: 0,
          roleHistory: finalState.roleHistory.map(r => ({
            role: r.role,
            tokenUsage: r.tokenUsage,
            timestamp: r.timestamp,
          })),
          briefingScript: finalState.briefingScript ?? undefined,
          semanticReview: finalState.semanticReview ?? undefined,
        } as SynthesisResult
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Phase 2 dispatch failed'
        finalState = {
          ...finalState,
          verdict: { decision: 'interrupt', confidence: 1.0, reason },
        }
      }

      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.put('__completed', true)
      await this.ctx.storage.delete('graphState')
      await this.persistSynthesisResult(workGraphId, finalState)

      return this.buildResult(workGraphId, finalState)
    })
  }

  private dryRunModelBridge() {
    return async (taskKind: string, _system: string, _user: string): Promise<string> => {
      switch (taskKind) {
        // 'architect' removed — ArchitectAgent handles dry-run internally
        // 'semantic_review' removed — CriticAgent handles dry-run internally
        case 'planner':
          return JSON.stringify({
            approach: 'Dry-run implementation plan',
            atoms: [{ id: 'atom-001', description: 'Stub implementation', assignedTo: 'coder' }],
            executorRecommendation: 'gdk-agent',
            estimatedComplexity: 'low',
          })
        case 'coder':
          return JSON.stringify({
            files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' }],
            summary: 'Dry-run code output',
            testsIncluded: false,
          })
        // 'critic' removed — CriticAgent handles dry-run internally
        case 'tester':
          return JSON.stringify({
            passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
            failures: [], summary: 'Dry-run — all tests pass',
          })
        case 'verifier':
          return JSON.stringify({
            decision: 'pass', confidence: 1.0,
            reason: 'Dry-run — auto-pass',
          })
        default:
          return JSON.stringify({ result: 'dry-run stub' })
      }
    }
  }

  /**
   * Build SandboxDeps — wired to @cloudflare/sandbox when SANDBOX binding is
   * available, otherwise returns stubs that throw (triggering callModel fallback).
   */
  private buildSandboxDeps(): SandboxDeps {
    if (this.env.SANDBOX) {
      return buildRealSandboxDeps(this.env.SANDBOX, this.currentWorkGraphId)
    }
    // No SANDBOX binding — return stubs that throw so makeExecutionRole
    // falls back to callModel (callModel fallback equivalent)
    return {
      execInSandbox: async (_taskJson) => {
        throw new Error('Sandbox not yet deployed — falling back to callModel')
      },
      prepareWorkspace: async (_config) => {
        throw new Error('Sandbox not yet deployed')
      },
      createBackup: async (_dir) => '',
      restoreBackup: async (_handle) => {},
    }
  }

  /**
   * Publish synthesis result to SYNTHESIS_RESULTS queue so the Worker's queue
   * consumer can forward it to the Workflow via sendEvent.
   *
   * This replaces the previous fetch-based callback which was blocked by CF's
   * self-fetch restriction (DO cannot fetch its own Worker URL).
   *
   * Called after synthesis completes (success or failure) and from the alarm handler.
   * Non-fatal: if the queue publish fails, the result is still in DO storage and
   * the response is returned to the caller. The Workflow has a 30-min waitForEvent
   * timeout as backstop.
   */
  private async notifyCallback(result: SynthesisResult): Promise<void> {
    const workflowId = await this.ctx.storage.get<string>('__workflowId')
    if (!workflowId) return

    try {
      if (this.env.SYNTHESIS_RESULTS) {
        await this.env.SYNTHESIS_RESULTS.send({
          workflowId,
          verdict: result.verdict,
          tokenUsage: result.tokenUsage,
          repairCount: result.repairCount,
        })
      }
    } catch (err) {
      console.error(`[Stage 6] Result queue publish failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private buildResult(workGraphId: string, state: GraphState): SynthesisResult {
    return {
      functionId: workGraphId,
      verdict: state.verdict ?? {
        decision: 'fail',
        confidence: 0,
        reason: 'No verdict reached',
      },
      tokenUsage: state.tokenUsage,
      repairCount: state.repairCount,
      roleHistory: state.roleHistory.map(r => ({
        role: r.role,
        tokenUsage: r.tokenUsage,
        timestamp: r.timestamp,
      })),
      briefingScript: state.briefingScript ?? undefined,
      semanticReview: state.semanticReview ?? undefined,
    }
  }

  private async persistSynthesisResult(workGraphId: string, state: GraphState): Promise<void> {
    const db = this.getDb()

    if (state.code) {
      await db.save('execution_artifacts', {
        _key: `EA-${workGraphId}-code`,
        functionRunId: workGraphId,
        type: 'code',
        content: JSON.stringify(state.code),
        createdAt: new Date().toISOString(),
      }).catch(() => {})
    }

    if (state.tests) {
      await db.save('execution_artifacts', {
        _key: `EA-${workGraphId}-tests`,
        functionRunId: workGraphId,
        type: 'test_report',
        content: JSON.stringify(state.tests),
        createdAt: new Date().toISOString(),
      }).catch(() => {})
    }

    await db.save('execution_artifacts', {
      _key: `EA-${workGraphId}-synthesis`,
      functionRunId: workGraphId,
      type: 'synthesis_summary',
      content: JSON.stringify({
        verdict: state.verdict,
        plan: state.plan,
        critique: state.critique?.overallAssessment,
        tokenUsage: state.tokenUsage,
        repairCount: state.repairCount,
        roleHistory: state.roleHistory,
        briefingScript: state.briefingScript,
        semanticReview: state.semanticReview,
        gate1Report: state.gate1Report,
      }),
      createdAt: new Date().toISOString(),
    }).catch(() => {})

    await db.save('memory_episodic', {
      _key: `ep-synth-${workGraphId}`,
      action: `stage-6-${state.verdict?.decision ?? 'unknown'}`,
      functionId: workGraphId,
      detail: {
        verdict: state.verdict?.decision,
        repairCount: state.repairCount,
        tokenUsage: state.tokenUsage,
        rolesExecuted: state.roleHistory.length,
      },
      timestamp: new Date().toISOString(),
      pain_score: state.verdict?.decision === 'fail' ? 8 : state.verdict?.decision === 'pass' ? 1 : 5,
      importance: 8,
    }).catch(() => {})

    // ── Phase D: CRP auto-generation (C7) ──
    // Check verdict confidence — if < 0.7 and not a clean pass, create CRP
    if (state.verdict && state.verdict.confidence < 0.7 && state.verdict.decision !== 'pass') {
      await createCRP(db, {
        artifactKey: `EA-${workGraphId}-synthesis`,
        collection: 'execution_artifacts',
        confidence: state.verdict.confidence,
        context: `Synthesis verdict: ${state.verdict.decision} — ${state.verdict.reason}`,
        agentRole: 'verifier',
        workGraphId,
      })
    }

    // Check semantic review confidence
    const semReview = state.semanticReview as { confidence?: number } | null
    if (semReview && typeof semReview.confidence === 'number' && semReview.confidence < 0.7) {
      await createCRP(db, {
        artifactKey: `EA-${workGraphId}-semantic-review`,
        collection: 'execution_artifacts',
        confidence: semReview.confidence,
        context: 'Semantic review produced low-confidence result',
        agentRole: 'critic',
        workGraphId,
      })
    }
  }
}
