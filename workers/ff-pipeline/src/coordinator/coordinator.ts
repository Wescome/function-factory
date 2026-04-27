import { Agent, callable, type FiberContext, type FiberRecoveryContext } from 'agents'
import { createClientFromEnv, type ArangoClient } from '@factory/arango-client'
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

export interface CoordinatorEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  OFOX_API_KEY?: string
  /** @cloudflare/sandbox DurableObject namespace binding. Optional until sandbox container is deployed. */
  SANDBOX?: unknown
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

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
    }
    return this.db
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/synthesize' && request.method === 'POST') {
      const body = await request.json() as {
        workGraph: Record<string, unknown>
        dryRun?: boolean
        specContent?: string
      }
      const result = await this.synthesize(body.workGraph, {
        dryRun: body.dryRun ?? false,
        ...(body.specContent ? { specContent: body.specContent } : {}),
      })
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
    const timedOutState: GraphState = {
      ...(state ?? createInitialState('unknown', {})),
      verdict: {
        decision: 'interrupt',
        confidence: 1.0,
        reason: 'DO alarm: synthesis exceeded 180s wall-clock deadline',
      },
    }
    await this.ctx.storage.put('graphState', timedOutState)
    await this.ctx.storage.put('__alarm_fired', true)
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

      // Instantiate reasoning agents for 9-node topology
      // All roles converted to gdk-agent agentLoop sessions with arango_query tool
      const architectAgent = new ArchitectAgent({
        db: this.getDb(),
        apiKey: this.env.OFOX_API_KEY ?? '',
        dryRun,
      })
      const coderAgent = new CoderAgent({
        db: this.getDb(),
        apiKey: this.env.OFOX_API_KEY ?? '',
        dryRun,
      })
      const plannerAgent = new PlannerAgent({
        db: this.getDb(),
        apiKey: this.env.OFOX_API_KEY ?? '',
        dryRun,
      })
      const testerAgent = new TesterAgent({
        db: this.getDb(),
        apiKey: this.env.OFOX_API_KEY ?? '',
        dryRun,
      })
      const verifierAgent = new VerifierAgent({
        db: this.getDb(),
        apiKey: this.env.OFOX_API_KEY ?? '',
        dryRun,
      })
      const criticAgent = new CriticAgent({
        db: this.getDb(),
        apiKey: this.env.OFOX_API_KEY ?? '',
        dryRun,
      })

      const deps: GraphDeps = {
        callModel,
        persistState,
        fetchMentorRules,
        // Sandbox execution for coder/tester — stubs throw until container is deployed,
        // triggering automatic fallback to callModel (piAiRole equivalent)
        executionRole: makeExecutionRole({
          dryRun,
          sandboxDeps: this.buildSandboxDeps(),
          callModel,
          persistState,
          fetchMentorRules,
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
      }

      const graph = buildSynthesisGraph(deps)

      // Set wall-clock alarm — survives I/O suspension and DO hibernation
      await this.ctx.storage.put('__completed', false)
      await this.ctx.storage.put('__alarm_fired', false)
      // Scale timeout with WorkGraph complexity: 3min base + 30s per atom
      const atoms = (workGraph.atoms as unknown[] | undefined)?.length ?? 0
      const timeoutMs = Math.max(180_000, 180_000 + atoms * 30_000)
      await this.ctx.storage.setAlarm(Date.now() + timeoutMs)

      let finalState: GraphState
      try {
        finalState = await graph.run(initialState, {
          onNodeStart: (name, state) => {
            console.log(`[Stage 6] ${name} starting (repair ${state.repairCount}, tokens ${state.tokenUsage})`)
          },
          maxSteps: 50,
        })
      } catch (err) {
        await this.ctx.storage.deleteAlarm()
        const alarmFired = await this.ctx.storage.get<boolean>('__alarm_fired')
        const reason = alarmFired
          ? 'DO alarm: synthesis exceeded 180s wall-clock deadline'
          : (err instanceof Error ? err.message : 'Synthesis failed')
        const failState: GraphState = {
          ...initialState,
          verdict: { decision: 'interrupt', confidence: 1.0, reason },
        }
        await this.ctx.storage.delete('graphState')
        await this.ctx.storage.put('__completed', true)
        return this.buildResult(workGraphId, failState)
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
            executorRecommendation: 'pi-sdk',
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
    // falls back to callModel (piAiRole equivalent)
    return {
      execInSandbox: async (_taskJson) => {
        throw new Error('Sandbox not yet deployed — falling back to piAiRole')
      },
      prepareWorkspace: async (_config) => {
        throw new Error('Sandbox not yet deployed')
      },
      createBackup: async (_dir) => '',
      restoreBackup: async (_handle) => {},
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
  }
}
