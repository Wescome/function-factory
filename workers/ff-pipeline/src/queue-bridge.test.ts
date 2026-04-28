/**
 * CF Queue bridge tests for Stage 6 synthesis.
 *
 * Tests the Queue-based synthesis bridge (replacing HTTP trigger):
 *   A) Queue consumer (queue() handler in index.ts) — receives message,
 *      calls DO via fetch, sends workflow event, acks message.
 *   B) Pipeline enqueue step (pipeline.ts) — sends message to CF Queue
 *      instead of HTTP self-fetch.
 *   C) Error handling — DO failure triggers retry, max retries sends
 *      failure event so workflow doesn't hang.
 *
 * Mock targets: CF Queue, DO stub, Workflow instance, ArangoDB client.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock cloudflare:workers (unavailable outside CF runtime) ───

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

// ─── Mock agents SDK (depends on cloudflare:workers transitively) ───

vi.mock('agents', () => {
  class Agent {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
    async runFiber(_name: string, fn: (ctx: unknown) => Promise<unknown>) {
      return fn({ id: 'mock-fiber', stash: () => {}, snapshot: null })
    }
    stash() {}
    async onFiberRecovered() {}
  }
  const callable = () => (_target: unknown, _context: unknown) => _target
  return { Agent, callable }
})

// ─── Mock @cloudflare/sandbox + containers (unavailable in vitest) ───

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))


// ─── Shared ArangoDB mock ───

const mockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
  setValidator: vi.fn(),
}

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => mockDb,
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

// ─── Stage stubs (isolate Stage 6 from Stages 1-5) ───

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
    rationale: 'Aligned',
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

// ─── Test helpers ───

function createMockCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

function createMockStep() {
  const stepDoNames: string[] = []
  const step = {
    do: vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
      const fn = typeof optsOrFn === 'function'
        ? optsOrFn as () => Promise<unknown>
        : maybeFn as () => Promise<unknown>
      stepDoNames.push(name)
      return fn()
    }),
    waitForEvent: vi.fn((_name: string, _opts?: unknown) => {
      return Promise.resolve({ payload: {} })
    }),
  }
  return { step, stepDoNames }
}

/** Standard env with passing Gate 1 and stubbed bindings. */
function createEnv(overrides?: Record<string, unknown>) {
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
        fetch: vi.fn(async () => new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        })),
      })),
    },
    SYNTHESIS_QUEUE: {
      send: vi.fn(async () => ({})),
    },
    ...overrides,
  }
}

const SIGNAL_PAYLOAD = {
  signal: { signalType: 'internal' as const, source: 'test', title: 'Test', description: 'Test signal' },
}

/** Create a mock CF Queue message. */
function createMockMessage(body: unknown, attempts = 1) {
  return {
    id: `msg-${Date.now()}`,
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

/** Create a mock CF Queue MessageBatch. */
function createMockBatch(messages: ReturnType<typeof createMockMessage>[]) {
  return {
    messages,
    queue: 'synthesis-queue',
    metadata: {
      metrics: {
        backlogCount: messages.length,
        backlogBytes: 0,
      },
    },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  }
}

// ─── Global fetch mock (pipeline's fire-synthesis-trigger uses globalThis.fetch) ───

const originalFetch = globalThis.fetch
const mockGlobalFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
  headers: { 'Content-Type': 'application/json' },
}))

// ─── Tests ───

describe('CF Queue bridge for Stage 6 synthesis', () => {
  beforeEach(() => {
    mockDb.save.mockClear()
    mockDb.saveEdge.mockClear()
    globalThis.fetch = mockGlobalFetch as unknown as typeof fetch
    mockGlobalFetch.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ── A) Queue consumer tests (fire-and-forget pattern, ADR-005 v4.1) ──

  describe('queue consumer (queue() handler) — fire-and-forget', () => {

    it('dispatches to DO via stub.fetch with workGraph, dryRun, callbackUrl, and workflowId', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-synth-WG-TEST'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-123',
        workGraphId: 'WG-TEST',
        workGraph: { _key: 'WG-TEST', title: 'Test', atoms: [] },
        dryRun: false,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // DO was called with correct payload including callback info
      expect(mockDoFetch).toHaveBeenCalledOnce()
      const calls = mockDoFetch.mock.calls as unknown[][]
      const fetchArg = calls[0]![0] as Request
      expect(new URL(fetchArg.url).pathname).toBe('/synthesize')

      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      expect(fetchBody.workGraph).toBeDefined()
      expect(fetchBody.dryRun).toBe(false)
      // ADR-005: callbackUrl and workflowId are included for fire-and-forget
      expect(fetchBody.callbackUrl).toBe('https://ff-pipeline.koales.workers.dev/synthesis-callback')
      expect(fetchBody.workflowId).toBe('wf-123')
    })

    it('acks IMMEDIATELY after dispatching — does NOT await DO synthesis result', async () => {
      const { default: worker } = await import('./index')

      // DO that takes "forever" (returns response, but the key is we don't parse it)
      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-123',
        workGraphId: 'WG-TEST',
        workGraph: { _key: 'WG-TEST' },
        dryRun: false,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // Acked immediately — fire-and-forget
      expect(msg.ack).toHaveBeenCalledOnce()
      expect(msg.retry).not.toHaveBeenCalled()
    })

    it('does NOT call workflow.sendEvent directly — callback handles that', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-123',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-synth-WG-TEST'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-123',
        workGraphId: 'WG-TEST',
        workGraph: { _key: 'WG-TEST' },
        dryRun: false,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // Queue consumer should NOT call sendEvent — the DO callback does that
      expect(mockSendEvent).not.toHaveBeenCalled()
    })

    it('uses env.COORDINATOR.idFromName with synth-{workGraphId} naming', async () => {
      const { default: worker } = await import('./index')

      const mockIdFromName = vi.fn(() => 'do-synth-WG-CUSTOM')
      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        COORDINATOR: {
          idFromName: mockIdFromName,
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-456',
        workGraphId: 'WG-CUSTOM',
        workGraph: { _key: 'WG-CUSTOM' },
        dryRun: true,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockIdFromName).toHaveBeenCalledWith('synth-WG-CUSTOM')
    })

    it('passes dryRun: true through to DO when message specifies it', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-789',
        workGraphId: 'WG-DRY',
        workGraph: { _key: 'WG-DRY' },
        dryRun: true,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      const calls = mockDoFetch.mock.calls as unknown[][]
      const fetchArg = calls[0]![0] as Request
      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      expect(fetchBody.dryRun).toBe(true)
    })

    it('defaults dryRun to false when not specified in message', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-789',
        workGraphId: 'WG-NODRY',
        workGraph: { _key: 'WG-NODRY' },
        // dryRun intentionally omitted
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      const calls = mockDoFetch.mock.calls as unknown[][]
      const fetchArg = calls[0]![0] as Request
      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      expect(fetchBody.dryRun).toBe(false)
    })
  })

  // ── B) Error handling tests (dispatch failures only — synthesis errors go through callback) ──

  describe('queue consumer error handling', () => {

    it('retries message when DO dispatch (stub.fetch) throws', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => { throw new Error('DO unavailable') })

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-err',
        workGraphId: 'WG-ERR',
        workGraph: { _key: 'WG-ERR' },
        dryRun: false,
      }, 1) // first attempt

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.retry).toHaveBeenCalledOnce()
      expect(msg.ack).not.toHaveBeenCalled()
    })

    it('sends failure event and acks when max dispatch retries exhausted (attempts >= 3)', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => { throw new Error('DO permanently broken') })

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-maxretry',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      // attempts = 3 means this is the final attempt (max_retries: 2 = 3 total attempts)
      const msg = createMockMessage({
        workflowId: 'wf-maxretry',
        workGraphId: 'WG-MAXRETRY',
        workGraph: { _key: 'WG-MAXRETRY' },
        dryRun: false,
      }, 3)

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // Should NOT retry (exhausted)
      expect(msg.retry).not.toHaveBeenCalled()

      // Should send failure event so workflow doesn't hang
      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'synthesis-complete',
          payload: expect.objectContaining({
            verdict: expect.objectContaining({
              decision: 'fail',
              reason: expect.stringContaining('DO permanently broken'),
            }),
            tokenUsage: 0,
            repairCount: 0,
          }),
        }),
      )

      // Should ack the message to remove it from queue
      expect(msg.ack).toHaveBeenCalledOnce()
    })
  })

  // ── C) Pipeline enqueue step tests ──

  describe('pipeline enqueue-synthesis step', () => {

    it('sends message to SYNTHESIS_QUEUE with workflowId, workGraphId, workGraph, dryRun', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })

      const { step, stepDoNames } = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
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
          instanceId: 'wf-enqueue-test',
          payload: SIGNAL_PAYLOAD,
        },
        step,
      )

      // Verify enqueue-synthesis step was called (not fire-synthesis-trigger)
      expect(stepDoNames).toContain('enqueue-synthesis')
      expect(stepDoNames).not.toContain('fire-synthesis-trigger')

      // Verify SYNTHESIS_QUEUE.send was called with correct payload
      expect(mockQueueSend).toHaveBeenCalledOnce()
      const calls = mockQueueSend.mock.calls as unknown[][]
      const sentMessage = calls[0]![0] as Record<string, unknown>
      expect(sentMessage.workflowId).toBe('wf-enqueue-test')
      expect(sentMessage.workGraphId).toBe('WG-TEST')
      expect(sentMessage.workGraph).toBeDefined()
      expect((sentMessage.workGraph as Record<string, unknown>)._key).toBe('WG-TEST')
      expect(sentMessage.dryRun).toBe(false)
    })

    it('passes dryRun: true when pipeline params specify dryRun', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })

      const { step } = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
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
          instanceId: 'wf-dry-test',
          payload: { ...SIGNAL_PAYLOAD, dryRun: true },
        },
        step,
      )

      const calls = mockQueueSend.mock.calls as unknown[][]
      const sentMessage = calls[0]![0] as Record<string, unknown>
      expect(sentMessage.dryRun).toBe(true)
    })

    it('returns { enqueued: true } from the enqueue-synthesis step', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })

      let enqueueResult: unknown
      const step = {
        do: vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
          const fn = typeof optsOrFn === 'function'
            ? optsOrFn as () => Promise<unknown>
            : maybeFn as () => Promise<unknown>
          const result = await fn()
          if (name === 'enqueue-synthesis') {
            enqueueResult = result
          }
          return result
        }),
        waitForEvent: vi.fn((name: string) => {
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
        }),
      }

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-result-test',
          payload: SIGNAL_PAYLOAD,
        },
        step,
      )

      expect(enqueueResult).toEqual({ enqueued: true })
    })

    it('no longer writes to ArangoDB synthesis_queue collection', async () => {
      mockDb.save.mockClear()

      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })

      const { step } = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
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
          instanceId: 'wf-no-arango',
          payload: SIGNAL_PAYLOAD,
        },
        step,
      )

      // Should NOT have written to synthesis_queue collection in ArangoDB
      const arangoQueueSave = (mockDb.save.mock.calls as unknown[][]).find(
        (call) => call[0] === 'synthesis_queue',
      )
      expect(arangoQueueSave).toBeUndefined()
    })

    it('enqueue-synthesis step runs between gate-1 and waitForEvent(synthesis-complete)', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })

      const stepOrder: string[] = []
      const step = {
        do: vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
          const fn = typeof optsOrFn === 'function'
            ? optsOrFn as () => Promise<unknown>
            : maybeFn as () => Promise<unknown>
          stepOrder.push(name)
          return fn()
        }),
        waitForEvent: vi.fn((name: string) => {
          stepOrder.push(`waitForEvent:${name}`)
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
        }),
      }

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-order-test',
          payload: SIGNAL_PAYLOAD,
        },
        step,
      )

      const enqueueIdx = stepOrder.indexOf('enqueue-synthesis')
      const waitIdx = stepOrder.indexOf('waitForEvent:synthesis-complete')

      expect(enqueueIdx).toBeGreaterThan(-1)
      expect(waitIdx).toBeGreaterThan(-1)
      expect(enqueueIdx).toBeLessThan(waitIdx)
    })
  })

  // ── C) Dispatch failure event resilience ──

  describe('queue consumer dispatch failure event resilience', () => {

    it('logs the ACTUAL sendEvent error when failure event also fails at max retries', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => { throw new Error('DO permanently broken') })
      const mockSendEvent = vi.fn(async () => {
        throw new Error('(workflow.invalid_event_type) Provided event type is invalid')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-logbug',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-logbug',
        workGraphId: 'WG-LOGBUG',
        workGraph: { _key: 'WG-LOGBUG' },
        dryRun: false,
      }, 3) // max retries exhausted

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // The console.error should log the ACTUAL sendEvent error, not just the original error
      expect(consoleSpy).toHaveBeenCalled()
      const loggedMessage = consoleSpy.mock.calls[0]![0] as string
      expect(loggedMessage).toContain('wf-logbug')
      // Must contain the sendEvent failure reason so we can debug why the workflow hangs
      expect(loggedMessage).toContain('invalid_event_type')
      // Should also include the original dispatch error for full context
      expect(loggedMessage).toContain('DO permanently broken')

      consoleSpy.mockRestore()
    })

    it('includes error context in log when sendEvent fails at max dispatch retries', async () => {
      const { default: worker } = await import('./index')

      const mockDoFetch = vi.fn(async () => { throw new Error('DO crashed') })
      const mockSendEvent = vi.fn(async () => {
        throw new Error('workflow not running')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-status-log',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-status-log',
        workGraphId: 'WG-STATUSLOG',
        workGraph: { _key: 'WG-STATUSLOG' },
        dryRun: false,
      }, 3)

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // Should still ack and log
      expect(consoleSpy).toHaveBeenCalled()
      const loggedMessage = consoleSpy.mock.calls[0]![0] as string
      expect(loggedMessage).toContain('wf-status-log')
      expect(loggedMessage).toContain('workflow not running')
      expect(loggedMessage).toContain('DO crashed')

      consoleSpy.mockRestore()
    })
  })

  // ── D) Existing /trigger-synthesis route still works ──

  describe('/trigger-synthesis HTTP route preserved', () => {

    it('POST /trigger-synthesis still returns 202', async () => {
      const { default: worker } = await import('./index')

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-123',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response(JSON.stringify({
              verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
              tokenUsage: 100,
              repairCount: 0,
            }), { headers: { 'Content-Type': 'application/json' } })),
          })),
        },
      })

      const ctx = createMockCtx()

      const request = new Request('https://host/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraphId: 'WG-TEST',
          workGraph: { _key: 'WG-TEST' },
          dryRun: false,
        }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      expect(response.status).toBe(202)
    })
  })
})
