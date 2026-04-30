/**
 * v5.1: AtomExecutor Durable Object — per-atom synthesis with its own lifetime.
 *
 * Each atom gets its own DO instance, solving the coordinator eviction problem:
 * the coordinator exits after dispatching atoms to the queue, and each
 * AtomExecutor DO runs independently for up to 900s.
 *
 * The DO:
 * - Receives atom spec + sharedContext via POST /execute-atom
 * - Checks idempotency (cached result returned on re-call)
 * - Sets 900s alarm
 * - Runs executeAtomSlice() (reuses existing function)
 * - Stores result in DO storage
 * - Publishes to ATOM_RESULTS queue
 * - Returns result
 */

import { Agent } from 'agents'
import { executeAtomSlice, type AtomSlice, type AtomResult } from './atom-executor.js'
import { createClientFromEnv } from '@factory/arango-client'
import { resolveAgentModel, keyForModel } from '../agents/resolve-model.js'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface AtomExecutorEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT?: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  OFOX_API_KEY?: string
  CF_API_TOKEN?: string
  ATOM_RESULTS?: { send(body: unknown): Promise<void> }
}

interface ExecuteAtomPayload {
  atomId: string
  atomSpec: Record<string, unknown>
  sharedContext: {
    workGraphId: string
    specContent: string | null
    briefingScript: unknown
  }
  upstreamArtifacts: Record<string, unknown>
  workflowId: string
  workGraphId: string
  maxRetries: number
  dryRun: boolean
}

// ────────────────────────────────────────────────────────────
// AtomExecutor DO
// ────────────────────────────────────────────────────────────

export class AtomExecutor extends Agent<AtomExecutorEnv> {

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/execute-atom' && request.method === 'POST') {
      return this.handleExecuteAtom(request)
    }

    return new Response('Not found', { status: 404 })
  }

  override async alarm(): Promise<void> {
    const completed = await this.ctx.storage.get<boolean>('__completed')
    if (completed) return

    const atomId = await this.ctx.storage.get<string>('__atomId') ?? 'unknown'
    const workGraphId = await this.ctx.storage.get<string>('__workGraphId') ?? 'unknown'
    const workflowId = await this.ctx.storage.get<string>('__workflowId')

    const interruptResult: AtomResult = {
      atomId,
      verdict: {
        decision: 'fail',
        confidence: 1.0,
        reason: `AtomExecutor alarm: atom ${atomId} exceeded 900s wall-clock deadline`,
      },
      codeArtifact: null,
      testReport: null,
      critiqueReport: null,
      retryCount: 0,
    }

    await this.ctx.storage.put('atomResult', interruptResult)
    await this.ctx.storage.put('__completed', true)

    // Publish interrupt result to queue
    await this.publishResult(workGraphId, atomId, interruptResult, workflowId)
  }

  private async handleExecuteAtom(request: Request): Promise<Response> {
    const payload = await request.json() as ExecuteAtomPayload

    // Idempotency check: if already completed, return cached result
    const cached = await this.ctx.storage.get<AtomResult>('atomResult')
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Pre-flight auth check: verify API key exists for resolved model provider
    // before burning 900s of DO lifetime on a guaranteed failure
    if (!payload.dryRun) {
      const preflightModel = resolveAgentModel('coder')
      const preflightEnv = { CF_API_TOKEN: this.env.CF_API_TOKEN, OFOX_API_KEY: this.env.OFOX_API_KEY }
      const key = keyForModel(preflightModel, preflightEnv)

      if (!key) {
        const failResult: AtomResult = {
          atomId: payload.atomId,
          verdict: {
            decision: 'fail',
            confidence: 1.0,
            reason: `Pre-flight auth check failed: no API key for provider "${preflightModel.provider}" (need ${preflightModel.provider === 'cloudflare' ? 'CF_API_TOKEN' : 'OFOX_API_KEY'})`,
          },
          codeArtifact: null,
          testReport: null,
          critiqueReport: null,
          retryCount: 0,
        }

        await this.ctx.storage.put('atomResult', failResult)
        await this.ctx.storage.put('__completed', true)
        await this.publishResult(payload.workGraphId, payload.atomId, failResult, payload.workflowId)

        return new Response(JSON.stringify(failResult), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Store metadata for alarm handler
    await this.ctx.storage.put('__atomId', payload.atomId)
    await this.ctx.storage.put('__workGraphId', payload.workGraphId)
    await this.ctx.storage.put('__workflowId', payload.workflowId)
    await this.ctx.storage.put('__completed', false)

    // Set 900s alarm
    await this.ctx.storage.setAlarm(Date.now() + 900_000)

    // Build the atom slice
    const slice: AtomSlice = {
      atomId: payload.atomId,
      atomSpec: payload.atomSpec,
      upstreamArtifacts: payload.upstreamArtifacts,
      sharedContext: payload.sharedContext,
    }

    // Build deps from environment — agents are created fresh per atom
    const deps = this.buildAtomDeps(payload.dryRun)

    // Execute the 4-node pipeline
    const result = await executeAtomSlice(slice, deps, {
      maxRetries: payload.maxRetries,
      dryRun: payload.dryRun,
    })

    // Store result for idempotency and mark complete
    await this.ctx.storage.put('atomResult', result)
    await this.ctx.storage.put('__completed', true)
    await this.ctx.storage.deleteAlarm()

    // Publish to ATOM_RESULTS queue
    await this.publishResult(
      payload.workGraphId,
      payload.atomId,
      result,
      payload.workflowId,
    )

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async publishResult(
    workGraphId: string,
    atomId: string,
    result: AtomResult,
    workflowId?: string | null,
  ): Promise<void> {
    try {
      if (this.env.ATOM_RESULTS) {
        await this.env.ATOM_RESULTS.send({
          workGraphId,
          atomId,
          result,
          workflowId: workflowId ?? null,
        })
      }
    } catch (err) {
      console.error(
        `[AtomExecutor] Failed to publish result for atom ${atomId}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Build AtomExecutorDeps — in v5.1 these are dry-run stubs.
   * The real agent wiring comes from the coordinator's existing agents.
   *
   * For now, the queue consumer creates the agent deps and passes them
   * to the DO via the executeAtomSlice function. The DO itself creates
   * minimal deps that match the interface.
   */
  private buildAtomDeps(dryRun: boolean) {
    // Provider-aware API key selection via shared keyForModel utility.
    const env = { CF_API_TOKEN: this.env.CF_API_TOKEN, OFOX_API_KEY: this.env.OFOX_API_KEY }

    // Resolve models from task-routing config (same source as coordinator)
    const coderModel = resolveAgentModel('coder')
    const criticModel = resolveAgentModel('critic')
    const testerModel = resolveAgentModel('tester')
    const verifierModel = resolveAgentModel('verifier')

    return {
      coderAgent: {
        produceCode: async (_input: Record<string, unknown>) => {
          if (dryRun) {
            return {
              files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' as const }],
              summary: 'Dry-run code output',
              testsIncluded: false,
            }
          }
          // Real agent: instantiate with resolved model + provider-aware key
          const { CoderAgent } = await import('../agents/coder-agent.js')
          const db = createClientFromEnv(this.env)
          const agent = new CoderAgent({ db, apiKey: keyForModel(coderModel, env), model: coderModel, dryRun: false })
          return agent.produceCode(_input as never)
        },
      },
      criticAgent: {
        codeReview: async (_input: Record<string, unknown>) => {
          if (dryRun) {
            return {
              passed: true,
              issues: [],
              mentorRuleCompliance: [],
              overallAssessment: 'Dry-run OK',
            }
          }
          const { CriticAgent } = await import('../agents/critic-agent.js')
          const db = createClientFromEnv(this.env)
          const agent = new CriticAgent({ db, apiKey: keyForModel(criticModel, env), model: criticModel, dryRun: false })
          return agent.codeReview(_input as never)
        },
      },
      testerAgent: {
        runTests: async (_input: Record<string, unknown>) => {
          if (dryRun) {
            return {
              passed: true,
              testsRun: 1,
              testsPassed: 1,
              testsFailed: 0,
              failures: [],
              summary: 'Dry-run tests pass',
            }
          }
          const { TesterAgent } = await import('../agents/tester-agent.js')
          const db = createClientFromEnv(this.env)
          const agent = new TesterAgent({ db, apiKey: keyForModel(testerModel, env), model: testerModel, dryRun: false })
          return agent.runTests(_input as never)
        },
      },
      verifierAgent: {
        verify: async (_input: Record<string, unknown>) => {
          if (dryRun) {
            return {
              decision: 'pass' as const,
              confidence: 1.0,
              reason: 'Dry-run auto-pass',
            }
          }
          const { VerifierAgent } = await import('../agents/verifier-agent.js')
          const db = createClientFromEnv(this.env)
          const agent = new VerifierAgent({ db, apiKey: keyForModel(verifierModel, env), model: verifierModel, dryRun: false })
          return agent.verify(_input as never)
        },
      },
      fetchMentorRules: async () => {
        try {
          const db = createClientFromEnv(this.env)
          return await db.query<{ ruleId: string; rule: string }>(
            `FOR r IN mentorscript_rules
               FILTER r.status == 'active'
               RETURN { ruleId: r._key, rule: r.rule }`,
          )
        } catch {
          return []
        }
      },
    }
  }
}
