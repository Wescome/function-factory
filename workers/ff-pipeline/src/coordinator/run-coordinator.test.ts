/**
 * RunCoordinator DO — unit tests for the three HTTP endpoints.
 *
 * Tests the coordination logic without CF runtime: /init, /get-compiled,
 * /stage-complete. advanceHarness is mocked so tests focus on the DO's
 * storage/dispatch/notification wiring, not the NLAH pure function.
 *
 * ADR-009 §8 gate 4: harness-path integration test coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock cloudflare:workers (DurableObject base) ──────────────────────────────
vi.mock('cloudflare:workers', () => {
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { DurableObject }
})

// ── Mock @factory/nlah ────────────────────────────────────────────────────────
const mockAdvanceHarness = vi.fn()

vi.mock('@factory/nlah', () => ({
  advanceHarness: (...args: unknown[]) => mockAdvanceHarness(...args),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockStorage() {
  const data = new Map<string, unknown>()
  return {
    get: vi.fn(async <T = unknown>(key: string): Promise<T | undefined> => data.get(key) as T | undefined),
    // Supports both put(key, value) and put({ key: value, ... })
    put: vi.fn(async (keyOrObj: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrObj === 'string') {
        data.set(keyOrObj, value)
      } else {
        for (const [k, v] of Object.entries(keyOrObj)) {
          data.set(k, v)
        }
      }
    }),
    delete: vi.fn(async (key: string) => data.delete(key)),
    _data: data,
  }
}

function makeMockCtx() {
  return { storage: makeMockStorage(), id: { toString: () => 'rc-do-id' } }
}

function makeMockEnv(overrides: Record<string, unknown> = {}) {
  return {
    HARNESS_QUEUE: { send: vi.fn(async () => {}) },
    FACTORY_PIPELINE: {
      get: vi.fn(async () => ({
        id: 'wf-id',
        status: vi.fn(async () => ({})),
        sendEvent: vi.fn(async () => {}),
      })),
      create: vi.fn(async () => ({ id: 'wf-id' })),
    },
    ...overrides,
  }
}

function makeCompiledHarness() {
  return {
    spec: {
      harness: { name: 'TEST' },
      stages: {
        PLAN: { from: 'TaskReceived', to: 'Planned', role: 'Planner', worker: 'pi', inputs: [], outputs: ['Plan'], max_stage_attempts: 2 },
        CODE: { from: 'Planned', to: 'Coded', role: 'Coder', worker: 'pi', inputs: [], outputs: ['Code'] },
      },
      runtime: { max_repair_rounds: 2, default_failure_action: 'abort', graph_mode: 'linear' },
    },
    stageOrder: ['PLAN', 'CODE'],
    artifactPaths: { Plan: 'artifacts/plan.md', Code: 'artifacts/code.md' },
  }
}

function makeHarnessState(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-test-001',
    currentStage: 'PLAN',
    status: 'running',
    completedStages: [],
    stageAttempts: {},
    totalAttempts: 0,
    ...overrides,
  }
}

function makeHarnessRunResult(overall: 'pass' | 'fail' = 'pass') {
  return { overall, finalStage: 'CODE', reason: overall === 'pass' ? undefined : 'gate failed' }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunCoordinator DO', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /init', () => {
    it('stores compiled, state, workflowId, taskText atomically and dispatches first stage', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const compiled = makeCompiledHarness()
      const initialState = makeHarnessState()

      const req = new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiled, initialState, workflowId: 'wf-001', taskText: 'Build X' }),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(200)

      const body = await resp.json() as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(body.runId).toBe('run-test-001')
      expect(body.firstStage).toBe('PLAN')

      // Storage atomic put was called once with all four keys
      const putCall = ctx.storage.put.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'object' && c[0] !== null,
      )
      expect(putCall).toBeDefined()
      const stored = putCall![0] as Record<string, unknown>
      expect(stored['harness:compiled']).toEqual(compiled)
      expect(stored['harness:state']).toEqual(initialState)
      expect(stored['harness:workflowId']).toBe('wf-001')
      expect(stored['harness:taskText']).toBe('Build X')

      // HARNESS_QUEUE dispatched the start stage
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
      const queueMsg = (env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
      expect(queueMsg.runId).toBe('run-test-001')
      expect(queueMsg.stageName).toBe('PLAN')
    })

    it('returns 400 when required fields are missing', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const req = new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiled: null, initialState: null }),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(400)
    })
  })

  describe('GET /get-compiled', () => {
    it('returns compiled + state + taskText when initialized', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const compiled = makeCompiledHarness()
      const state = makeHarnessState()
      ctx.storage._data.set('harness:compiled', compiled)
      ctx.storage._data.set('harness:state', state)
      ctx.storage._data.set('harness:taskText', 'Objective text')

      const req = new Request('https://do/get-compiled', { method: 'GET' })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(200)

      const body = await resp.json() as Record<string, unknown>
      expect(body.compiled).toEqual(compiled)
      expect(body.state).toEqual(state)
      expect(body.taskText).toBe('Objective text')
    })

    it('returns 404 when run has not been initialized', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const req = new Request('https://do/get-compiled', { method: 'GET' })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(404)
    })
  })

  describe('POST /stage-complete', () => {
    async function initRc() {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const compiled = makeCompiledHarness()
      const state = makeHarnessState()
      ctx.storage._data.set('harness:compiled', compiled)
      ctx.storage._data.set('harness:state', state)
      ctx.storage._data.set('harness:workflowId', 'wf-001')

      return { rc, ctx, env, compiled, state }
    }

    function makeStageCompletePayload(overrides: Record<string, unknown> = {}) {
      return {
        stageName: 'PLAN',
        workerOutput: { createdArtifacts: ['Plan'] },
        gateResults: [{ gateName: 'exists-Plan', passed: true }],
        ...overrides,
      }
    }

    it('dispatch action: persists new state and sends next stage to HARNESS_QUEUE', async () => {
      const { rc, ctx, env, compiled, state } = await initRc()
      const nextState = makeHarnessState({ currentStage: 'CODE', completedStages: ['PLAN'] })

      mockAdvanceHarness.mockReturnValue({
        action: 'dispatch',
        stage: 'CODE',
        newState: nextState,
      })

      const req = new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeStageCompletePayload()),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(200)

      const body = await resp.json() as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(body.action).toBe('dispatch')
      expect(body.nextStage).toBe('CODE')

      // advanceHarness called with correct args
      expect(mockAdvanceHarness).toHaveBeenCalledOnce()
      const [calledCompiled, calledState] = mockAdvanceHarness.mock.calls[0] as unknown[]
      expect(calledCompiled).toEqual(compiled)
      expect((calledState as typeof state).currentStage).toBe('PLAN')

      // State persisted
      const putCalls = (ctx.storage.put as ReturnType<typeof vi.fn>).mock.calls
      const statePut = putCalls.find((c: unknown[]) => c[0] === 'harness:state')
      expect(statePut).toBeDefined()
      expect(statePut![1]).toEqual(nextState)

      // Next stage queued
      const queueMsg = (env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
      expect(queueMsg.stageName).toBe('CODE')
    })

    it('complete action: persists result and notifies Workflow via sendEvent', async () => {
      const { rc, env, compiled: _c, state: _s } = await initRc()
      const result = makeHarnessRunResult('pass')
      const nextState = makeHarnessState({ status: 'completed', completedStages: ['PLAN', 'CODE'] })

      mockAdvanceHarness.mockReturnValue({
        action: 'complete',
        result,
        newState: nextState,
      })

      const req = new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeStageCompletePayload({ stageName: 'CODE' })),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(200)

      const body = await resp.json() as Record<string, unknown>
      expect(body.action).toBe('complete')

      // Workflow notified
      expect((env.FACTORY_PIPELINE.get as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
      expect((env.FACTORY_PIPELINE.get as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('wf-001')
    })

    it('fail action: persists result and notifies Workflow', async () => {
      const { rc, env } = await initRc()
      const result = makeHarnessRunResult('fail')
      const nextState = makeHarnessState({ status: 'failed' })

      mockAdvanceHarness.mockReturnValue({ action: 'fail', result, newState: nextState })

      const req = new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeStageCompletePayload()),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(200)

      const body = await resp.json() as Record<string, unknown>
      expect(body.action).toBe('fail')

      // Workflow still notified on fail
      expect((env.FACTORY_PIPELINE.get as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    })

    it('workerThrew: unshifts synthetic worker_executed gate into stageResult', async () => {
      const { rc } = await initRc()
      const nextState = makeHarnessState({ currentStage: 'PLAN' })
      mockAdvanceHarness.mockReturnValue({ action: 'retry', stage: 'PLAN', newState: nextState })

      const req = new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageName: 'PLAN',
          workerOutput: { createdArtifacts: [] },
          gateResults: [],
          workerThrew: { message: 'container timed out' },
        }),
      })
      await rc.fetch(req)

      // The stageResult passed to advanceHarness should have the synthetic gate
      const stageResult = mockAdvanceHarness.mock.calls[0]![2] as { gateResults: Array<{ gateName: string; passed: boolean; detail?: string }> }
      expect(stageResult.gateResults[0]).toMatchObject({
        gateName: 'worker_executed',
        passed: false,
        detail: expect.stringContaining('container timed out'),
      })
    })

    it('returns 409 when stage-complete arrives before /init', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const req = new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageName: 'PLAN', workerOutput: { createdArtifacts: [] }, gateResults: [] }),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(409)
    })
  })
})
