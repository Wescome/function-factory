/**
 * CF Queue bridge tests for Agent Call execution synthesis.
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

const harnessDispatcherMocks = vi.hoisted(() => ({
  dispatchOne: vi.fn(async () => {}),
  buildDefaultDispatcherDeps: vi.fn(() => ({ mocked: true })),
}))

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
  ensureCollection: vi.fn(async () => {}),
}

vi.mock('@factory/db-client', () => ({
  createClientFromEnv: () => mockDb,
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

// ─── Compatibility stage stubs (isolate Agent Call execution from upstream transformations) ───

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
    intentSpecification: { title: 'Test Intent Specification', atoms: [], invariants: [] },
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
  PASS_NAMES: ['atoms', 'contracts', 'invariants', 'validations', 'dependencies', 'schedule', 'budget', 'executableSpecification'],
  compileIntentSpecification: vi.fn(async (_pass: string, state: Record<string, unknown>) => ({
    ...state,
    executableSpecification: {
      _key: 'ES-TEST',
      title: 'Test ExecutableSpecification',
      atoms: [{ id: 'a1', description: 'test atom' }],
      invariants: [],
      dependencies: [],
    },
  })),
}))

vi.mock('./harness-dispatcher.js', () => ({
  dispatchOne: harnessDispatcherMocks.dispatchOne,
  buildDefaultDispatcherDeps: harnessDispatcherMocks.buildDefaultDispatcherDeps,
}))

vi.mock('./gascity/skeleton-builder', () => ({
  buildSkeleton: vi.fn(async () => ({ r2Key: 'skeletons/test/skeleton.tar.gz', skeletonSha: 'abc123def456' })),
  getSkeletonDownloadUrl: vi.fn(() => 'https://ff-pipeline.koales.workers.dev/skeleton-download?key=test&token=tok'),
}))

vi.mock('./compilers/formula-compiler-adapter', () => ({
  buildFormulaCompilerDeps: vi.fn(() => ({})),
}))

vi.mock('./compilers/formula-compiler', () => ({
  compileAndDispatchFormula: vi.fn(async () => ({
    outcome: 'dispatched',
    form_id: 'FORM-TEST',
    dispatch_log_key: 'DL-TEST',
    gc_bead_id: 'bead-123',
    gc_workflow_id: 'wf-123',
  })),
}))

vi.mock('./gascity/autonomy-monitor', () => ({
  markFunctionDispatched: vi.fn(async () => {}),
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

/** Standard env with passing Coherence Verification and stubbed bindings. */
function createEnv(overrides?: Record<string, unknown>) {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: {
      evaluateCoherenceVerification: vi.fn(async () => ({
        verification: "coherence",
        passed: true,
        timestamp: '2026-04-25T00:00:00Z',
        executableSpecificationId: 'ES-TEST',
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
    SYNTHESIS_RESULTS: {
      send: vi.fn(async () => ({})),
    },
    GITHUB_TOKEN: 'test-token',
    GAS_CITY_HMAC_SECRET_V1: 'test-secret',
    WORKSPACE_BUCKET: { put: vi.fn(async () => ({})), get: vi.fn(async () => null) },
    GAS_CITY_BASE_URL: 'https://gascity.example.com',
    GAS_CITY_BEARER_TOKEN: 'test-bearer',
    ...overrides,
  }
}

const SIGNAL_PAYLOAD = {
  signal: { signalType: 'internal' as const, source: 'test', title: 'Test', description: 'Test signal' },
}

function sampleTrellisExecutionPacket(executableSpecificationId = 'ES-TEST') {
  const subject = executableSpecificationId.replace(/^ES-/, '')
  return {
    id: `EP-${subject}`,
    executableSpecificationId,
    audit: { packetHash: `hash-${subject}` },
  }
}

/** Create a mock CF Queue message. */
function createMockMessage(body: unknown, attempts = 1) {
  const messageBody = body && typeof body === 'object' && !Array.isArray(body)
    ? {
        ...(body as Record<string, unknown>),
        ...(
          'workflowId' in (body as Record<string, unknown>)
          && 'executableSpecificationId' in (body as Record<string, unknown>)
          && 'executableSpecification' in (body as Record<string, unknown>)
          && !('trellisExecutionPacket' in (body as Record<string, unknown>))
            ? {
                trellisExecutionPacket: sampleTrellisExecutionPacket(
                  (body as Record<string, unknown>).executableSpecificationId as string,
                ),
              }
            : {}
        ),
      }
    : body
  return {
    id: `msg-${Date.now()}`,
    timestamp: new Date(),
    body: messageBody,
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

describe('CF Queue bridge for Agent Call execution synthesis', () => {
  beforeEach(() => {
    mockDb.save.mockClear()
    mockDb.saveEdge.mockClear()
    harnessDispatcherMocks.dispatchOne.mockClear()
    harnessDispatcherMocks.buildDefaultDispatcherDeps.mockClear()
    globalThis.fetch = mockGlobalFetch as unknown as typeof fetch
    mockGlobalFetch.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ── A) Queue consumer tests (fire-and-forget pattern, ADR-005 v4.1) ──

  describe('queue consumer (queue() handler) — fire-and-forget', () => {

    it('dispatches to DO via stub.fetch with executableSpecification, dryRun, and workflowId (no callbackUrl)', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-synth-ES-TEST'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-123',
        executableSpecificationId: 'ES-TEST',
        executableSpecification: { _key: 'ES-TEST', title: 'Test', atoms: [] },
        dryRun: false,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // DO was called with correct payload
      expect(mockDoFetch).toHaveBeenCalledOnce()
      const calls = mockDoFetch.mock.calls as unknown[][]
      const fetchArg = calls[0]![0] as Request
      expect(new URL(fetchArg.url).pathname).toBe('/synthesize')

      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      expect(fetchBody.executableSpecification).toBeDefined()
      expect(fetchBody.dryRun).toBe(false)
      // Queue fallback: workflowId is passed, callbackUrl is NOT (DO uses Queue instead)
      expect(fetchBody.workflowId).toBe('wf-123')
      expect(fetchBody.callbackUrl).toBeUndefined()
    })

    it('does not route stale harness-shaped messages when batch.queue is unavailable', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const env = createEnv()
      const msg = createMockMessage({
        runId: 'smoke-shape-route',
        stageName: 'SMOKE',
      })
      const batch = {
        messages: [msg],
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(harnessDispatcherMocks.buildDefaultDispatcherDeps).not.toHaveBeenCalled()
      expect(harnessDispatcherMocks.dispatchOne).not.toHaveBeenCalled()
      expect(msg.ack).toHaveBeenCalledOnce()
      expect(msg.retry).not.toHaveBeenCalled()
    })

    it('acks removed harness-dlq messages without calling RunCoordinator', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }
      const mockRunFetch = vi.fn(async (_request: Request) => new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      const env = createEnv({
        RUN_COORDINATOR: {
          idFromName: vi.fn(() => 'run-do-id'),
          get: vi.fn(() => ({ fetch: mockRunFetch })),
        },
      })
      const msg = createMockMessage({
        runId: 'run-dlq-001',
        stageName: 'PATCH',
      })
      const batch = {
        messages: [msg],
        queue: 'harness-dlq',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockRunFetch).not.toHaveBeenCalled()
      expect(msg.ack).toHaveBeenCalledOnce()
      expect(msg.retry).not.toHaveBeenCalled()
    })

    it('acks IMMEDIATELY after dispatching — does NOT await DO synthesis result', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
        executableSpecificationId: 'ES-TEST',
        executableSpecification: { _key: 'ES-TEST' },
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
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
          idFromName: vi.fn(() => 'do-synth-ES-TEST'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-123',
        executableSpecificationId: 'ES-TEST',
        executableSpecification: { _key: 'ES-TEST' },
        dryRun: false,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // Queue consumer should NOT call sendEvent — the DO callback does that
      expect(mockSendEvent).not.toHaveBeenCalled()
    })

    it('uses env.COORDINATOR.idFromName with synth-{executableSpecificationId} naming', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockIdFromName = vi.fn(() => 'do-synth-ES-CUSTOM')
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
        executableSpecificationId: 'ES-CUSTOM',
        executableSpecification: { _key: 'ES-CUSTOM' },
        dryRun: true,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockIdFromName).toHaveBeenCalledWith('synth-ES-CUSTOM')
    })

    it('passes dryRun: true through to DO when message specifies it', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
        executableSpecificationId: 'ES-DRY',
        executableSpecification: { _key: 'ES-DRY' },
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
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
        executableSpecificationId: 'ES-NODRY',
        executableSpecification: { _key: 'ES-NODRY' },
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
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockDoFetch = vi.fn(async () => { throw new Error('DO unavailable') })

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-err',
        executableSpecificationId: 'ES-ERR',
        executableSpecification: { _key: 'ES-ERR' },
        dryRun: false,
      }, 1) // first attempt

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.retry).toHaveBeenCalledOnce()
      expect(msg.ack).not.toHaveBeenCalled()
    })

    it('sends failure event and acks when max dispatch retries exhausted (attempts >= 3)', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
        executableSpecificationId: 'ES-MAXRETRY',
        executableSpecification: { _key: 'ES-MAXRETRY' },
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

  // ── C) Pipeline Gas City dispatch step tests ──

  describe('pipeline Gas City dispatch step', () => {

    it('runs build-skeleton → dispatch-formula → mark-function-dispatched and returns dispatched', async () => {
      const { FactoryPipeline } = await import('./pipeline')

      const env = createEnv()
      const { step, stepDoNames } = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      const result = await pipeline.run(
        {
          instanceId: 'wf-dispatch-test',
          payload: SIGNAL_PAYLOAD,
        },
        step,
      )

      expect(result.status).toBe('dispatched')
      expect(stepDoNames).toContain('build-skeleton')
      expect(stepDoNames).toContain('dispatch-formula')
      expect(stepDoNames).toContain('mark-function-dispatched')
      expect(stepDoNames).not.toContain('instruction-tuning')
      expect(stepDoNames).not.toContain('enqueue-synthesis')
    })

    it('does not write to ArangoDB synthesis_queue collection', async () => {
      mockDb.save.mockClear()

      const { FactoryPipeline } = await import('./pipeline')

      const env = createEnv()
      const { step } = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
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

      const arangoQueueSave = (mockDb.save.mock.calls as unknown[][]).find(
        (call) => call[0] === 'synthesis_queue',
      )
      expect(arangoQueueSave).toBeUndefined()
    })
  })

  // ── C) Dispatch failure event resilience ──

  describe('queue consumer dispatch failure event resilience', () => {

    it('logs the ACTUAL sendEvent error when failure event also fails at max retries', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
        executableSpecificationId: 'ES-LOGBUG',
        executableSpecification: { _key: 'ES-LOGBUG' },
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
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

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
        executableSpecificationId: 'ES-STATUSLOG',
        executableSpecification: { _key: 'ES-STATUSLOG' },
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

  // ── D) synthesis-results queue consumer (Queue fallback for DO callback) ──

  describe('synthesis-results queue consumer', () => {

    it('calls workflow.sendEvent with synthesis-complete on receiving result message', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-results-1',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-results-1',
        verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
        tokenUsage: 4200,
        repairCount: 0,
      })

      // Use synthesis-results queue name
      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockSendEvent).toHaveBeenCalledOnce()
      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'synthesis-complete',
          payload: {
            verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
            tokenUsage: 4200,
            repairCount: 0,
          },
        }),
      )

      expect(msg.ack).toHaveBeenCalledOnce()
    })

    it('acks after successful sendEvent', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-ack-test',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-ack-test',
        verdict: { decision: 'fail', confidence: 1.0, reason: 'Synthesis failed' },
        tokenUsage: 100,
        repairCount: 2,
      })

      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.ack).toHaveBeenCalledOnce()
      expect(msg.retry).not.toHaveBeenCalled()
    })

    it('retries on sendEvent failure', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockSendEvent = vi.fn(async () => {
        throw new Error('workflow not running')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-retry-test',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-retry-test',
        verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
        tokenUsage: 50,
        repairCount: 0,
      }, 1) // first attempt

      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.retry).toHaveBeenCalledOnce()
      expect(msg.ack).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('acks and logs when max retries exhausted (attempts >= 4)', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockSendEvent = vi.fn(async () => {
        throw new Error('workflow permanently broken')
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-maxretry-results',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      // max_retries: 3 = 4 total attempts
      const msg = createMockMessage({
        workflowId: 'wf-maxretry-results',
        verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
        tokenUsage: 50,
        repairCount: 0,
      }, 4)

      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.ack).toHaveBeenCalledOnce()
      expect(msg.retry).not.toHaveBeenCalled()

      // Should have logged errors
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('forwards interrupt verdict from DO alarm timeout', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-alarm-results',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-alarm-results',
        verdict: {
          decision: 'interrupt',
          confidence: 1.0,
          reason: 'DO alarm: synthesis exceeded wall-clock deadline',
        },
        tokenUsage: 0,
        repairCount: 0,
      })

      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'synthesis-complete',
          payload: expect.objectContaining({
            verdict: expect.objectContaining({
              decision: 'interrupt',
              reason: expect.stringContaining('wall-clock deadline'),
            }),
          }),
        }),
      )

      expect(msg.ack).toHaveBeenCalledOnce()
    })

    it('does NOT dispatch to Coordinator DO (only relays to Workflow)', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockDoFetch = vi.fn(async () => new Response('{}'))
      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-no-do',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-no-do',
        verdict: { decision: 'pass', confidence: 1.0, reason: 'ok' },
        tokenUsage: 0,
        repairCount: 0,
      })

      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // Should relay to workflow, NOT dispatch to DO
      expect(mockSendEvent).toHaveBeenCalledOnce()
      expect(mockDoFetch).not.toHaveBeenCalled()
    })
  })

  // ── E) Existing /trigger-synthesis route still works ──

  describe('/trigger-synthesis HTTP route preserved', () => {

    it('POST /trigger-synthesis still returns 202', async () => {
      // The /trigger-synthesis route body lives in ./trigger-synthesis-handler
      // (extracted from index.ts) so it can be exercised without importing the
      // worker barrel, which re-exports Flue DO/Workflow classes that statically
      // pull in cloudflare:* protocol modules (rejected by Node's ESM loader).
      const { handleTriggerSynthesis } = await import('./trigger-synthesis-handler')

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
          executableSpecificationId: 'ES-TEST',
          executableSpecification: { _key: 'ES-TEST' },
          trellisExecutionPacket: sampleTrellisExecutionPacket('ES-TEST'),
          dryRun: false,
        }),
      })

      const response = await handleTriggerSynthesis(request, env as never, ctx as never)
      expect(response.status).toBe(202)
    })
  })

  // ── F) v5.1: atom-execute queue messages ──

  describe('v5.1: atom-execute queue messages', () => {

    it('dispatches atom-execute messages to ThinkExecutor DO', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockDoFetch = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        THINK_EXECUTOR: {
          idFromName: vi.fn(() => 'think-do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        type: 'atom-execute',
        executableSpecificationId: 'ES-ATOM',
        workflowId: 'wf-atom-1',
        atomId: 'atom-001',
        atomSpec: { id: 'atom-001', description: 'Test atom' },
        sharedContext: { executableSpecificationId: 'ES-ATOM', specContent: null, briefingScript: {} },
        upstreamArtifacts: {},
        maxRetries: 3,
        dryRun: true,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      // ThinkExecutor DO was called
      expect(mockDoFetch).toHaveBeenCalledOnce()
      const calls = mockDoFetch.mock.calls as unknown[][]
      const fetchArg = calls[0]![0] as Request
      expect(new URL(fetchArg.url).pathname).toBe('/execute-atom')

      // Body is the atomSpec forwarded verbatim
      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      expect(fetchBody.id).toBe('atom-001')
      expect(fetchBody.description).toBe('Test atom')

      // Message acked
      expect(msg.ack).toHaveBeenCalledOnce()
    })

    it('uses idFromName with think-{executableSpecificationId}-{atomId}', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockIdFromName = vi.fn(() => 'think-do-id')
      const mockDoFetch = vi.fn(async () => new Response('{}'))

      const env = createEnv({
        THINK_EXECUTOR: {
          idFromName: mockIdFromName,
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        type: 'atom-execute',
        executableSpecificationId: 'ES-NAME',
        workflowId: 'wf-1',
        atomId: 'atom-xyz',
        atomSpec: {},
        sharedContext: {},
        upstreamArtifacts: {},
        maxRetries: 3,
        dryRun: false,
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockIdFromName).toHaveBeenCalledWith('think-ES-NAME-atom-xyz')
    })

    it('retries atom-execute on DO dispatch failure', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockDoFetch = vi.fn(async () => { throw new Error('DO unavailable') })

      const env = createEnv({
        THINK_EXECUTOR: {
          idFromName: vi.fn(() => 'think-do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        type: 'atom-execute',
        executableSpecificationId: 'ES-ERR',
        workflowId: 'wf-err',
        atomId: 'atom-err',
        atomSpec: {},
        sharedContext: {},
        upstreamArtifacts: {},
        maxRetries: 3,
        dryRun: false,
      }, 1)

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.retry).toHaveBeenCalledOnce()
      expect(msg.ack).not.toHaveBeenCalled()
    })

    it('publishes failure result to ATOM_RESULTS when atom-execute max retries exhausted', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockDoFetch = vi.fn(async () => { throw new Error('Permanent failure') })
      const mockAtomResultsSend = vi.fn(async () => {})

      const env = createEnv({
        THINK_EXECUTOR: {
          idFromName: vi.fn(() => 'think-do-id'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
        ATOM_RESULTS: { send: mockAtomResultsSend },
      })

      const msg = createMockMessage({
        type: 'atom-execute',
        executableSpecificationId: 'ES-MAXRETRY',
        workflowId: 'wf-maxretry',
        atomId: 'atom-dead',
        atomSpec: {},
        sharedContext: {},
        upstreamArtifacts: {},
        maxRetries: 3,
        dryRun: false,
      }, 6) // max retries exhausted (max_retries: 5 = 6 total attempts)

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.ack).toHaveBeenCalledOnce()
      expect(mockAtomResultsSend).toHaveBeenCalledOnce()

      const sentMsg = (mockAtomResultsSend.mock.calls[0] as unknown as [Record<string, unknown>])[0]
      expect(sentMsg.atomId).toBe('atom-dead')
      expect(sentMsg.executableSpecificationId).toBe('ES-MAXRETRY')
      const result = sentMsg.result as Record<string, unknown>
      const verdict = result.verdict as Record<string, unknown>
      expect(verdict.decision).toBe('fail')
    })
  })

  // ── G) v5.1: synthesis-results phase1-complete messages ──

  describe('v5.1: synthesis-results phase1-complete', () => {

    it('acks phase1-complete messages without relaying to workflow', async () => {
      const { queueHandler } = await import('./queue-handler')
      const worker = { queue: queueHandler }

      const mockSendEvent = vi.fn(async () => {})

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-p1',
            status: vi.fn(),
            sendEvent: mockSendEvent,
          })),
        },
      })

      const msg = createMockMessage({
        type: 'phase1-complete',
        workflowId: 'wf-p1',
        executableSpecificationId: 'ES-P1',
        atomCount: 3,
        layerCount: 2,
      })

      const batch = {
        messages: [msg],
        queue: 'synthesis-results',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn(),
      }

      const ctx = createMockCtx()
      await worker.queue(batch as never, env as never, ctx as never)

      expect(msg.ack).toHaveBeenCalledOnce()
      // Should NOT relay to workflow
      expect(mockSendEvent).not.toHaveBeenCalled()
    })
  })
})
