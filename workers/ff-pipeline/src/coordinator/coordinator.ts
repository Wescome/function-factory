import { DurableObject } from 'cloudflare:workers'
import { createClientFromEnv, type ArangoClient } from '@factory/arango-client'
import { buildSynthesisGraph } from './graph'
import type { GraphDeps } from './graph'
import { createModelBridge } from './model-bridge-do'
import { createInitialState, type GraphState, type Verdict } from './state'

export interface CoordinatorEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  OFOX_API_KEY?: string
}

export interface SynthesisResult {
  functionId: string
  verdict: Verdict
  tokenUsage: number
  repairCount: number
  roleHistory: { role: string; tokenUsage: number; timestamp: string }[]
}

export class SynthesisCoordinator extends DurableObject<CoordinatorEnv> {
  private db: ArangoClient | null = null

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
    }
    return this.db
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/synthesize' && request.method === 'POST') {
      const body = await request.json() as { workGraph: Record<string, unknown>; dryRun?: boolean }
      const result = await this.synthesize(body.workGraph, { dryRun: body.dryRun })
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

  async synthesize(
    workGraph: Record<string, unknown>,
    opts?: { dryRun?: boolean },
  ): Promise<SynthesisResult> {
    const workGraphId = (workGraph._key ?? workGraph.id ?? 'unknown') as string
    const dryRun = opts?.dryRun ?? false

    const persisted = await this.ctx.storage.get<GraphState>('graphState')
    const initialState = persisted ?? createInitialState(workGraphId, workGraph)

    if (persisted?.verdict?.decision === 'pass' ||
        persisted?.verdict?.decision === 'fail' ||
        persisted?.verdict?.decision === 'interrupt') {
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.put('__completed', true)
      return this.buildResult(workGraphId, persisted)
    }

    const callModel = dryRun
      ? this.dryRunModelBridge()
      : createModelBridge(this.env)

    const deps: GraphDeps = {
      callModel,
      persistState: async (state) => {
        await this.ctx.storage.put('graphState', state)
      },
      fetchMentorRules: async () => {
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
      },
    }

    const graph = buildSynthesisGraph(deps)

    // Set wall-clock alarm — survives I/O suspension and DO hibernation
    await this.ctx.storage.put('__completed', false)
    await this.ctx.storage.put('__alarm_fired', false)
    await this.ctx.storage.setAlarm(Date.now() + 180_000)

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
  }

  private dryRunModelBridge() {
    return async (taskKind: string, _system: string, _user: string): Promise<string> => {
      switch (taskKind) {
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
        case 'critic':
          return JSON.stringify({
            passed: true,
            issues: [],
            mentorRuleCompliance: [],
            overallAssessment: 'Dry-run — no issues found',
          })
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
        roleHistory: state.roleHistory.map(r => ({ role: r.role, timestamp: r.timestamp })),
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
