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

const mockEmitRunEvent = vi.hoisted(() => vi.fn(async (_env: unknown, _input: unknown) => {}))

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

vi.mock('../observability/run-event-log', () => ({
  emitRunEvent: (env: unknown, input: unknown) => mockEmitRunEvent(env, input),
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
    setAlarm: vi.fn(async (_time: number | Date) => {}),
    deleteAlarm: vi.fn(async () => {}),
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

    it('replay: second /init with identical payload does NOT re-dispatch and returns replayed: true', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const compiled = makeCompiledHarness()
      const initialState = makeHarnessState()
      const body = JSON.stringify({ compiled, initialState, workflowId: 'wf-001', taskText: 'Build X' })

      // First call — fresh init
      const resp1 = await rc.fetch(new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }))
      expect(resp1.status).toBe(200)
      const body1 = await resp1.json() as Record<string, unknown>
      expect(body1.ok).toBe(true)
      expect(body1.replayed).toBeUndefined()
      expect(body1.resumed).toBeUndefined()

      // Second call — true replay (state + dispatched both set)
      const resp2 = await rc.fetch(new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }))
      expect(resp2.status).toBe(200)
      const body2 = await resp2.json() as Record<string, unknown>
      expect(body2.ok).toBe(true)
      expect(body2.replayed).toBe(true)
      expect(body2.runId).toBe('run-test-001')

      // HARNESS_QUEUE.send must be called exactly ONCE across both calls
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    })

    it('crash-recovery: state set but dispatched flag absent re-dispatches and returns resumed: true', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const compiled = makeCompiledHarness()
      const initialState = makeHarnessState()

      // Simulate crash between storage.put and HARNESS_QUEUE.send:
      // KEY_STATE (and the rest) are set, but KEY_DISPATCHED is NOT.
      ctx.storage._data.set('harness:compiled', compiled)
      ctx.storage._data.set('harness:state', initialState)
      ctx.storage._data.set('harness:workflowId', 'wf-001')
      ctx.storage._data.set('harness:taskText', 'Build X')
      // Intentionally do NOT set 'harness:dispatched'

      const req = new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiled, initialState, workflowId: 'wf-001', taskText: 'Build X' }),
      })
      const resp = await rc.fetch(req)
      expect(resp.status).toBe(200)

      const body = await resp.json() as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(body.resumed).toBe(true)
      expect(body.replayed).toBeUndefined()
      expect(body.runId).toBe('run-test-001')
      expect(body.firstStage).toBe('PLAN')

      // HARNESS_QUEUE.send IS called on crash-recovery path
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)

      // KEY_DISPATCHED is now set in storage
      expect(ctx.storage._data.get('harness:dispatched')).toBe('1')
    })

    it('first-write-wins: replay with DIFFERENT payload does not mutate stored state', async () => {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)

      const compiledFirst = makeCompiledHarness()
      const stateFirst = makeHarnessState({ runId: 'run-first', currentStage: 'PLAN' })

      // First call — fresh init with first payload
      const resp1 = await rc.fetch(new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiled: compiledFirst,
          initialState: stateFirst,
          workflowId: 'wf-first',
          taskText: 'first task',
        }),
      }))
      expect(resp1.status).toBe(200)

      // Snapshot stored state after first call
      const storedCompiledAfterFirst = ctx.storage._data.get('harness:compiled')
      const storedStateAfterFirst = ctx.storage._data.get('harness:state')
      const storedWorkflowAfterFirst = ctx.storage._data.get('harness:workflowId')
      const storedTaskAfterFirst = ctx.storage._data.get('harness:taskText')

      // Second call — DIFFERENT payload; should be a true replay (no-op)
      const compiledSecond = makeCompiledHarness()
      compiledSecond.spec.harness.name = 'DIFFERENT'
      const stateSecond = makeHarnessState({ runId: 'run-second', currentStage: 'CODE' })

      const resp2 = await rc.fetch(new Request('https://do/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiled: compiledSecond,
          initialState: stateSecond,
          workflowId: 'wf-second',
          taskText: 'second task',
        }),
      }))
      expect(resp2.status).toBe(200)
      const body2 = await resp2.json() as Record<string, unknown>
      expect(body2.replayed).toBe(true)
      // Replay returns the EXISTING runId, not the new payload's runId
      expect(body2.runId).toBe('run-first')

      // Stored state matches the FIRST call — replay did not mutate
      expect(ctx.storage._data.get('harness:compiled')).toBe(storedCompiledAfterFirst)
      expect(ctx.storage._data.get('harness:state')).toBe(storedStateAfterFirst)
      expect(ctx.storage._data.get('harness:workflowId')).toBe(storedWorkflowAfterFirst)
      expect(ctx.storage._data.get('harness:taskText')).toBe(storedTaskAfterFirst)

      // And only one dispatch occurred across both calls
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
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

    it('sendEvent failure schedules an alarm retry using persisted terminal result', async () => {
      const sendEvent = vi.fn(async () => {
        throw new Error('workflow event temporarily unavailable')
      })
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv({
        FACTORY_PIPELINE: {
          get: vi.fn(async () => ({ id: 'wf-001', status: vi.fn(async () => ({})), sendEvent })),
          create: vi.fn(async () => ({ id: 'wf-001' })),
        },
      })
      const rc = new RunCoordinator(ctx as never, env as never)
      const result = makeHarnessRunResult('pass')
      ctx.storage._data.set('harness:compiled', makeCompiledHarness())
      ctx.storage._data.set('harness:state', makeHarnessState())
      ctx.storage._data.set('harness:workflowId', 'wf-001')
      mockAdvanceHarness.mockReturnValue({
        action: 'complete',
        result,
        newState: makeHarnessState({ status: 'completed' }),
      })

      const resp = await rc.fetch(new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeStageCompletePayload()),
      }))

      expect(resp.status).toBe(200)
      expect(ctx.storage._data.get('harness:result')).toEqual(result)
      expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
    })

    it('alarm retries persisted terminal notification and clears alarm on success', async () => {
      const sendEvent = vi.fn(async () => {})
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv({
        FACTORY_PIPELINE: {
          get: vi.fn(async () => ({ id: 'wf-001', status: vi.fn(async () => ({})), sendEvent })),
          create: vi.fn(async () => ({ id: 'wf-001' })),
        },
      })
      const rc = new RunCoordinator(ctx as never, env as never)
      const result = makeHarnessRunResult('pass')
      ctx.storage._data.set('harness:result', result)
      ctx.storage._data.set('harness:workflowId', 'wf-001')
      ctx.storage._data.set('harness:state', makeHarnessState())

      await rc.alarm()

      expect(sendEvent).toHaveBeenCalledWith({ type: 'harness-complete', payload: result })
      expect(ctx.storage.deleteAlarm).toHaveBeenCalledOnce()
      expect(ctx.storage._data.get('harness:notifyAttempts')).toBeUndefined()
    })

    it('caps terminal Workflow notification retries and permanently abandons after attempt 100', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const sendEvent = vi.fn(async () => {
        throw new Error('workflow event permanently unavailable')
      })
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv({
        FACTORY_PIPELINE: {
          get: vi.fn(async () => ({ id: 'wf-001', status: vi.fn(async () => ({})), sendEvent })),
          create: vi.fn(async () => ({ id: 'wf-001' })),
        },
      })
      const rc = new RunCoordinator(ctx as never, env as never)
      const result = makeHarnessRunResult('pass')
      ctx.storage._data.set('harness:result', result)
      ctx.storage._data.set('harness:workflowId', 'wf-001')
      ctx.storage._data.set('harness:state', makeHarnessState())

      for (let i = 0; i < 101; i += 1) {
        await rc.alarm()
      }

      expect(sendEvent).toHaveBeenCalledTimes(100)
      expect(ctx.storage._data.get('harness:notifyAttempts')).toBe(100)
      expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(99)
      expect(ctx.storage.deleteAlarm).toHaveBeenCalled()
      expect(mockEmitRunEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        runId: 'run-test-001',
        type: 'workflow_notify_failed',
        emitter: 'run-coordinator',
        data: expect.objectContaining({
          workflowId: 'wf-001',
          attempts: 100,
          permanentlyAbandoned: true,
        }),
      }))
      consoleError.mockRestore()
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

    it('ignores stage-complete after a terminal result is already persisted', async () => {
      const { rc, ctx, env } = await initRc()
      const result = makeHarnessRunResult('pass')
      ctx.storage._data.set('harness:result', result)

      const resp = await rc.fetch(new Request('https://do/stage-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeStageCompletePayload()),
      }))

      expect(resp.status).toBe(200)
      expect(await resp.json()).toMatchObject({
        ok: true,
        action: 'already-complete',
        result: {
          overall: result.overall,
          finalStage: result.finalStage,
        },
      })
      expect(mockAdvanceHarness).not.toHaveBeenCalled()
      expect((env.FACTORY_PIPELINE.get as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })
  })

  describe('POST /force-complete', () => {
    it('persists a forced failure result and notifies Workflow', async () => {
      const sendEvent = vi.fn(async () => {})
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv({
        FACTORY_PIPELINE: {
          get: vi.fn(async () => ({ id: 'wf-001', status: vi.fn(async () => ({})), sendEvent })),
          create: vi.fn(async () => ({ id: 'wf-001' })),
        },
      })
      const rc = new RunCoordinator(ctx as never, env as never)
      const result = makeHarnessRunResult('fail')
      ctx.storage._data.set('harness:state', makeHarnessState())
      ctx.storage._data.set('harness:workflowId', 'wf-001')

      const resp = await rc.fetch(new Request('https://do/force-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'run-test-001', result, reason: 'dlq' }),
      }))

      expect(resp.status).toBe(200)
      expect(ctx.storage._data.get('harness:result')).toEqual(result)
      expect(sendEvent).toHaveBeenCalledWith({ type: 'harness-complete', payload: result })
    })
  })

  describe('POST /operator-dispatch', () => {
    async function initRc(overrides: Record<string, unknown> = {}) {
      const { RunCoordinator } = await import('./run-coordinator.js')
      const ctx = makeMockCtx()
      const env = makeMockEnv()
      const rc = new RunCoordinator(ctx as never, env as never)
      ctx.storage._data.set('harness:compiled', makeCompiledHarness())
      ctx.storage._data.set('harness:state', makeHarnessState(overrides))
      ctx.storage._data.set('harness:workflowId', 'wf-001')
      return { rc, ctx, env }
    }

    it('validates current state and enqueues an operator retry with idempotency', async () => {
      const { rc, env } = await initRc({ stageAttempts: { PLAN: 1 } })
      const body = {
        runId: 'run-test-001',
        stageName: 'PLAN',
        action: 'retry-stage',
        operator: 'ops',
        reason: 'recover transient failure',
        idempotencyKey: 'retry-001',
      }

      const first = await rc.fetch(new Request('https://do/operator-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))

      expect(first.status).toBe(202)
      expect(await first.json()).toMatchObject({
        ok: true,
        action: 'retry-stage',
        runId: 'run-test-001',
        stageName: 'PLAN',
        attemptNumber: 2,
        effect: { attempted: true, ok: true, enqueued: true, deduped: false },
      })
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
        runId: 'run-test-001',
        stageName: 'PLAN',
        attemptNumber: 2,
      })

      const duplicate = await rc.fetch(new Request('https://do/operator-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))

      expect(duplicate.status).toBe(200)
      expect(await duplicate.json()).toMatchObject({
        action: 'already-dispatched',
        attemptNumber: 2,
        effect: { deduped: true },
      })
      expect((env.HARNESS_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    })

    it('refuses operator dispatch for non-current, unknown, or terminal stages', async () => {
      const { rc, ctx } = await initRc({ currentStage: 'PLAN' })

      const nonCurrent = await rc.fetch(new Request('https://do/operator-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-test-001',
          stageName: 'CODE',
          action: 'redispatch-stage',
          idempotencyKey: 'wrong-stage',
        }),
      }))
      expect(nonCurrent.status).toBe(409)
      expect(await nonCurrent.json()).toMatchObject({
        error: 'stage is not current',
        currentStage: 'PLAN',
      })

      const unknown = await rc.fetch(new Request('https://do/operator-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-test-001',
          stageName: 'NOPE',
          action: 'redispatch-stage',
          idempotencyKey: 'unknown',
        }),
      }))
      expect(unknown.status).toBe(404)

      ctx.storage._data.set('harness:result', makeHarnessRunResult('fail'))
      const terminal = await rc.fetch(new Request('https://do/operator-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-test-001',
          stageName: 'PLAN',
          action: 'retry-stage',
          idempotencyKey: 'terminal',
        }),
      }))
      expect(terminal.status).toBe(409)
      expect(await terminal.json()).toMatchObject({ error: 'run is already terminal' })
    })
  })
})
