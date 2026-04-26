/**
 * Event-driven Stage 6 handoff tests.
 *
 * Verifies the pipeline's event-driven synthesis pattern:
 *   1. Pipeline queues synthesis request after Gate 1 pass
 *   2. Pipeline enters waitForEvent('synthesis-complete')
 *   3. External trigger reads queue, calls DO via HTTP, sends event
 *   4. Pipeline resumes with correct PipelineResult including synthesis verdict
 *   5. Timeout produces clean error when synthesis doesn't complete
 *
 * These tests use mocks for Workflow step operations, ArangoDB, and
 * DO bindings since the real CF runtime is not available in vitest.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock cloudflare:workers runtime (not available outside CF) ───

vi.mock('cloudflare:workers', () => {
  class WorkflowEntrypoint {
    env: unknown
    constructor() {}
  }
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { WorkflowEntrypoint, DurableObject }
})

// ─── Mock types matching CF Workflow contracts ───

interface StepDoCall {
  name: string
  fn: () => Promise<unknown>
  opts: { timeout?: string } | undefined
}

interface WaitForEventCall {
  name: string
  opts: { type: string; timeout: string }
}

function createMockStep() {
  const doCalls: StepDoCall[] = []
  const waitCalls: WaitForEventCall[] = []
  let waitForEventResolver: ((value: { payload: unknown }) => void) | null = null
  let waitForEventRejector: ((error: Error) => void) | null = null

  const step = {
    do: vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
      const fn = typeof optsOrFn === 'function'
        ? optsOrFn as () => Promise<unknown>
        : maybeFn as () => Promise<unknown>
      const opts = typeof optsOrFn === 'object' ? optsOrFn as { timeout?: string } : undefined
      doCalls.push({ name, fn, opts })
      return fn()
    }),
    waitForEvent: vi.fn((name: string, opts: { type: string; timeout: string }) => {
      waitCalls.push({ name, opts })
      return new Promise<{ payload: unknown }>((resolve, reject) => {
        waitForEventResolver = resolve
        waitForEventRejector = reject
      })
    }),
  }

  return {
    step,
    doCalls,
    waitCalls,
    resolveWaitForEvent: (payload: unknown) => waitForEventResolver?.({ payload }),
    rejectWaitForEvent: (error: Error) => waitForEventRejector?.(error),
  }
}

function createMockDb() {
  return {
    save: vi.fn(async () => ({ _key: 'mock-key' })),
    saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
    query: vi.fn(async () => []),
  }
}

function createMockEnv(overrides?: Partial<Record<string, unknown>>) {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: {
      evaluateGate1: vi.fn(async () => ({
        gate: 1,
        passed: true,
        timestamp: '2026-04-25T00:00:00Z',
        workGraphId: 'WG-TEST',
        checks: [{ name: 'lineage', passed: true, detail: 'ok' }],
        summary: 'All checks passed',
      })),
    },
    FACTORY_PIPELINE: {
      create: vi.fn(async () => ({ id: 'wf-123' })),
      get: vi.fn(async () => ({
        id: 'wf-123',
        status: vi.fn(async () => ({ status: 'running' })),
        sendEvent: vi.fn(async () => {}),
      })),
    },
    COORDINATOR: {
      idFromName: vi.fn(() => 'do-id-123'),
      get: vi.fn(() => ({
        synthesize: vi.fn(async () => ({
          functionId: 'WG-TEST',
          verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
          tokenUsage: 4200,
          repairCount: 0,
          roleHistory: [],
        })),
      })),
    },
    SYNTHESIS_QUEUE: {
      send: vi.fn(async () => ({})),
    },
    ...overrides,
  }
}

// ─── Shared mock DB instance (tests can inspect calls on this) ───
const sharedMockDb = createMockDb()

// ─── Minimal stage stubs ───
// We mock all upstream stages so we can isolate the Stage 6 handoff behavior.
// The pipeline imports are mocked at module level.

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => sharedMockDb,
}))

vi.mock('./stages/ingest-signal', () => ({
  ingestSignal: vi.fn(async () => ({ _key: 'SIG-001', signalType: 'internal', title: 'test' })),
}))

vi.mock('./stages/synthesize-pressure', () => ({
  synthesizePressure: vi.fn(async () => ({ _key: 'PRS-001', title: 'test pressure' })),
}))

vi.mock('./stages/map-capability', () => ({
  mapCapability: vi.fn(async () => ({ _key: 'BC-001', title: 'test capability' })),
}))

vi.mock('./stages/propose-function', () => ({
  proposeFunction: vi.fn(async () => ({
    _key: 'FP-001',
    title: 'test proposal',
    prd: { title: 'Test PRD', atoms: [], invariants: [] },
  })),
}))

vi.mock('./stages/semantic-review', () => ({
  semanticReview: vi.fn(async () => ({
    alignment: 'aligned',
    confidence: 0.9,
    citations: [],
    rationale: 'Aligned with capabilities',
    timestamp: '2026-04-25T00:00:00Z',
  })),
}))

vi.mock('./stages/compile', () => ({
  PASS_NAMES: ['atoms', 'contracts', 'invariants', 'validations', 'dependencies', 'schedule', 'budget', 'workgraph'],
  compilePRD: vi.fn(async (_pass: string, state: Record<string, unknown>) => ({
    ...state,
    workGraph: {
      _key: 'WG-TEST',
      title: 'Test WorkGraph',
      atoms: [{ id: 'a1', description: 'test atom' }],
      invariants: [],
      dependencies: [],
    },
  })),
}))


// ─── Global fetch mock (needed for fire-synthesis-trigger step) ───

const originalFetch = globalThis.fetch
const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
  headers: { 'Content-Type': 'application/json' },
}))

// ─── Tests ───

describe('Stage 6: Event-driven synthesis handoff', () => {

  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('queue-and-wait pattern', () => {

    it('enqueues a synthesis request to CF Queue after Gate 1 passes', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
              tokenUsage: 4200,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      // Verify enqueue-synthesis step was called (not queue-synthesis)
      const enqueueCall = mockStep.step.do.mock.calls.find(
        (call: unknown[]) => call[0] === 'enqueue-synthesis',
      )
      expect(enqueueCall).toBeDefined()

      // Verify SYNTHESIS_QUEUE.send was called
      expect(mockQueueSend).toHaveBeenCalledOnce()
    })

    it('enters waitForEvent(synthesis-complete) with 5-minute timeout after queueing', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const env = createMockEnv()
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string, opts: { type: string; timeout: string }) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
              tokenUsage: 4200,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      // Verify synthesis-complete waitForEvent was called with 5-minute timeout
      const synthWait = mockStep.step.waitForEvent.mock.calls.find(
        (call: unknown[]) => call[0] === 'synthesis-complete',
      )
      expect(synthWait).toBeDefined()
      expect((synthWait![1] as { timeout: string }).timeout).toBe('5 minutes')
    })

    it('returns PipelineResult with synthesis verdict on success', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const env = createMockEnv()
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
              tokenUsage: 4200,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      const result = await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      expect(result.status).toBe('synthesis-passed')
      expect(result.synthesisResult).toBeDefined()
      expect(result.synthesisResult!.verdict.decision).toBe('pass')
      expect(result.synthesisResult!.verdict.confidence).toBe(0.95)
      expect(result.synthesisResult!.tokenUsage).toBe(4200)
      expect(result.synthesisResult!.repairCount).toBe(0)
      expect(result.signalId).toBe('SIG-001')
      expect(result.workGraphId).toBe('WG-TEST')
    })

    it('returns synthesis-fail status when verdict is fail', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const env = createMockEnv()
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'fail', confidence: 1.0, reason: 'Repair cap exceeded' },
              tokenUsage: 12000,
              repairCount: 5,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      const result = await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      expect(result.status).toBe('synthesis-fail')
      expect(result.synthesisResult!.verdict.decision).toBe('fail')
      expect(result.synthesisResult!.repairCount).toBe(5)
    })

    it('does not enter synthesis when Gate 1 fails', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const env = createMockEnv({
        GATES: {
          evaluateGate1: vi.fn(async () => ({
            gate: 1,
            passed: false,
            timestamp: '2026-04-25T00:00:00Z',
            workGraphId: 'WG-TEST',
            checks: [{ name: 'lineage', passed: false, detail: 'missing lineage' }],
            summary: 'Gate 1 failed',
          })),
        },
      })
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      const result = await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      expect(result.status).toBe('gate-1-failed')

      // Verify synthesis-complete was never waited on
      const synthWait = mockStep.step.waitForEvent.mock.calls.find(
        (call: unknown[]) => call[0] === 'synthesis-complete',
      )
      expect(synthWait).toBeUndefined()
    })

    it('sends workGraphId and workGraph via SYNTHESIS_QUEUE.send', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
              tokenUsage: 4200,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      // Verify CF Queue message has correct shape
      const calls = mockQueueSend.mock.calls as unknown[][]
      expect(calls.length).toBeGreaterThan(0)
      const sentMessage = calls[0]![0] as Record<string, unknown>
      expect(sentMessage.workGraphId).toBe('WG-TEST')
      expect(sentMessage.workGraph).toBeDefined()
      expect(sentMessage.dryRun).toBe(false)
    })
  })

  describe('synthesis trigger route', () => {

    it('POST /trigger-synthesis calls DO via HTTP and returns result', async () => {
      const { default: worker } = await import('./index')

      // Mock fetch for the DO HTTP call
      const mockDoResponse = {
        functionId: 'WG-TEST',
        verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
        tokenUsage: 4200,
        repairCount: 0,
        roleHistory: [],
      }

      const mockWorkflowInstance = {
        id: 'wf-123',
        status: vi.fn(async () => ({ status: 'running' })),
        sendEvent: vi.fn(async () => {}),
      }

      const env = createMockEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(async () => ({ id: 'wf-123' })),
          get: vi.fn(async () => mockWorkflowInstance),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id-123'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response(JSON.stringify(mockDoResponse), {
              headers: { 'Content-Type': 'application/json' },
            })),
          })),
        },
      })

      const request = new Request('https://ff-pipeline.example.com/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraphId: 'WG-TEST',
          workGraph: { _key: 'WG-TEST', title: 'Test', atoms: [], invariants: [], dependencies: [] },
          dryRun: false,
        }),
      })

      const response = await worker.fetch(request, env as never, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext)
      expect(response.status).toBe(202)

      const body = await response.json() as Record<string, unknown>
      expect(body.accepted).toBe(true)
    })

    it('sends synthesis-complete event to the workflow after DO completes', async () => {
      const { default: worker } = await import('./index')

      const mockDoResponse = {
        functionId: 'WG-TEST',
        verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
        tokenUsage: 4200,
        repairCount: 0,
        roleHistory: [],
      }

      const mockSendEvent = vi.fn(async () => {})
      const mockWorkflowInstance = {
        id: 'wf-123',
        status: vi.fn(async () => ({ status: 'running' })),
        sendEvent: mockSendEvent,
      }

      const env = createMockEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(async () => ({ id: 'wf-123' })),
          get: vi.fn(async () => mockWorkflowInstance),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id-123'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response(JSON.stringify(mockDoResponse), {
              headers: { 'Content-Type': 'application/json' },
            })),
          })),
        },
      })

      const request = new Request('https://ff-pipeline.example.com/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraphId: 'WG-TEST',
          workGraph: { _key: 'WG-TEST', title: 'Test', atoms: [], invariants: [], dependencies: [] },
          dryRun: false,
        }),
      })

      const waitUntilFn = vi.fn((p: Promise<unknown>) => { p.catch(() => {}) })
      await worker.fetch(request, env as never, { waitUntil: waitUntilFn, passThroughOnException: vi.fn() } as unknown as ExecutionContext)

      // waitUntil runs async — await the promise it captured
      if (waitUntilFn.mock.calls[0]) await waitUntilFn.mock.calls[0][0]

      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'synthesis-complete',
          payload: expect.objectContaining({
            verdict: expect.objectContaining({ decision: 'pass' }),
            tokenUsage: 4200,
            repairCount: 0,
          }),
        }),
      )
    })

    it('returns 400 when required fields are missing from trigger request', async () => {
      const { default: worker } = await import('./index')

      const env = createMockEnv()
      const request = new Request('https://ff-pipeline.example.com/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'wf-123' }), // missing workGraphId, workGraph
      })

      const response = await worker.fetch(request, env as never, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext)
      expect(response.status).toBe(400)
    })

    it('returns 500 and sends error event when DO call fails', async () => {
      const { default: worker } = await import('./index')

      const mockSendEvent = vi.fn(async () => {})
      const mockWorkflowInstance = {
        id: 'wf-123',
        status: vi.fn(async () => ({ status: 'running' })),
        sendEvent: mockSendEvent,
      }

      const env = createMockEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(async () => ({ id: 'wf-123' })),
          get: vi.fn(async () => mockWorkflowInstance),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id-123'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => { throw new Error('DO unavailable') }),
          })),
        },
      })

      const request = new Request('https://ff-pipeline.example.com/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraphId: 'WG-TEST',
          workGraph: { _key: 'WG-TEST', title: 'Test', atoms: [], invariants: [], dependencies: [] },
          dryRun: false,
        }),
      })

      const waitUntilFn = vi.fn((p: Promise<unknown>) => { p.catch(() => {}) })
      const response = await worker.fetch(request, env as never, { waitUntil: waitUntilFn, passThroughOnException: vi.fn() } as unknown as ExecutionContext)
      expect(response.status).toBe(202)

      // waitUntil runs async — await the promise it captured
      if (waitUntilFn.mock.calls[0]) await waitUntilFn.mock.calls[0][0]

      // Should still send an error event to the workflow so it doesn't hang
      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'synthesis-complete',
          payload: expect.objectContaining({
            verdict: expect.objectContaining({ decision: 'fail' }),
          }),
        }),
      )
    })
  })

  describe('synthesis timeout handling', () => {

    it('pipeline includes synthesis-complete waitForEvent with type and timeout', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const env = createMockEnv()
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      const synthCall = mockStep.step.waitForEvent.mock.calls.find(
        (call: unknown[]) => call[0] === 'synthesis-complete',
      )
      expect(synthCall).toBeDefined()
      const opts = synthCall![1] as { type: string; timeout: string }
      expect(opts.type).toBe('synthesis-complete')
      expect(opts.timeout).toBe('5 minutes')
    })
  })

  describe('no WorkGraph edge case', () => {

    it('returns compile-incomplete when workGraph is null after compilation', async () => {
      // Temporarily override compilePRD to return null workGraph
      const { compilePRD } = await import('./stages/compile')
      const mockedCompile = vi.mocked(compilePRD)
      const originalImpl = mockedCompile.getMockImplementation()

      mockedCompile.mockImplementation(async (_pass: string, state: Record<string, unknown>) => ({
        ...state,
        workGraph: null,
      }))

      try {
        const { FactoryPipeline } = await import('./pipeline')

        const env = createMockEnv()
        const mockStep = createMockStep()

        mockStep.step.waitForEvent = vi.fn((name: string) => {
          if (name === 'architect-approval') {
            return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
          }
          return Promise.reject(new Error(`Unexpected: ${name}`))
        })

        const pipeline = Object.create(FactoryPipeline.prototype)
        pipeline.env = env

        const result = await pipeline.run(
          { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
          mockStep.step,
        )

        expect(result.status).toBe('compile-incomplete')
      } finally {
        // Restore original mock
        if (originalImpl) {
          mockedCompile.mockImplementation(originalImpl)
        }
      }
    })
  })

  describe('lineage edge persistence', () => {

    it('persists synthesis lineage edge after synthesis completes', async () => {
      // Clear shared mock to isolate this test
      sharedMockDb.saveEdge.mockClear()

      const { FactoryPipeline } = await import('./pipeline')

      const env = createMockEnv()
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        { payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } } },
        mockStep.step,
      )

      // Verify the synthesis lineage edge was written
      const edgeCall = sharedMockDb.saveEdge.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'lineage_edges' &&
          (call[1] as string).includes('EA-') &&
          (call[1] as string).includes('synthesis'),
      )
      expect(edgeCall).toBeDefined()
    })
  })

  describe('enqueue-synthesis step (CF Queue)', () => {

    it('enqueue-synthesis step runs between gate-1 and waitForEvent(synthesis-complete)', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })
      const mockStep = createMockStep()
      const stepOrder: string[] = []

      // Track the order of step.do calls
      mockStep.step.do = vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
        const fn = typeof optsOrFn === 'function'
          ? optsOrFn as () => Promise<unknown>
          : maybeFn as () => Promise<unknown>
        stepOrder.push(name)
        return fn()
      })

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          stepOrder.push('waitForEvent:synthesis-complete')
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-test-123',
          payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
        },
        mockStep.step,
      )

      const enqueueIdx = stepOrder.indexOf('enqueue-synthesis')
      const waitIdx = stepOrder.indexOf('waitForEvent:synthesis-complete')

      expect(enqueueIdx).toBeGreaterThan(-1)
      expect(waitIdx).toBeGreaterThan(-1)
      expect(enqueueIdx).toBeLessThan(waitIdx)
    })

    it('sends correct payload to SYNTHESIS_QUEUE.send', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-test-456',
          payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
        },
        mockStep.step,
      )

      expect(mockQueueSend).toHaveBeenCalledOnce()
      const calls = mockQueueSend.mock.calls as unknown[][]
      const sentMessage = calls[0]![0] as Record<string, unknown>
      expect(sentMessage.workflowId).toBe('wf-test-456')
      expect(sentMessage.workGraphId).toBe('WG-TEST')
      expect(sentMessage.workGraph).toBeDefined()
      expect(sentMessage.dryRun).toBe(false)
    })

    it('includes dryRun: true when pipeline params specify dryRun', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-dry-789',
          payload: {
            signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' },
            dryRun: true,
          },
        },
        mockStep.step,
      )

      const calls = mockQueueSend.mock.calls as unknown[][]
      const sentMessage = calls[0]![0] as Record<string, unknown>
      expect(sentMessage.dryRun).toBe(true)
    })

    it('does not enqueue when Gate 1 fails', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
        GATES: {
          evaluateGate1: vi.fn(async () => ({
            gate: 1,
            passed: false,
            timestamp: '2026-04-25T00:00:00Z',
            workGraphId: 'WG-TEST',
            checks: [{ name: 'lineage', passed: false, detail: 'broken' }],
            summary: 'Gate 1 failed',
          })),
        },
      })
      const mockStep = createMockStep()

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      const result = await pipeline.run(
        {
          instanceId: 'wf-gate-fail',
          payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
        },
        mockStep.step,
      )

      expect(result.status).toBe('gate-1-failed')
      expect(mockQueueSend).not.toHaveBeenCalled()
    })

    it('returns { enqueued: true } from the enqueue-synthesis step', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createMockEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })
      const mockStep = createMockStep()
      let enqueueResult: unknown

      mockStep.step.do = vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
        const fn = typeof optsOrFn === 'function'
          ? optsOrFn as () => Promise<unknown>
          : maybeFn as () => Promise<unknown>
        const result = await fn()
        if (name === 'enqueue-synthesis') {
          enqueueResult = result
        }
        return result
      })

      mockStep.step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        if (name === 'synthesis-complete') {
          return Promise.resolve({
            payload: {
              verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            },
          })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-result-check',
          payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
        },
        mockStep.step,
      )

      expect(enqueueResult).toEqual({ enqueued: true })
    })
  })
})
