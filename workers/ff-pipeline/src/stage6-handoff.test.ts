/**
 * Stage 6 event-driven handoff tests.
 *
 * Tests the two halves of the synthesis bridge:
 *   A) /trigger-synthesis HTTP route (index.ts) — validates input,
 *      calls DO via fetch, sends workflow events on success/failure.
 *   B) Pipeline workflow (pipeline.ts) — queues synthesis to ArangoDB
 *      after Gate 1 pass, waits for event, returns PipelineResult
 *      with synthesisResult.
 *
 * Mock targets: ArangoDB client, DO stub, Workflow instance.
 * No implementation files are modified.
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

// ─── Shared ArangoDB mock ───

const mockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
}

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => mockDb,
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
  const step = {
    do: vi.fn(async (_name: string, optsOrFn: unknown, maybeFn?: unknown) => {
      const fn = typeof optsOrFn === 'function'
        ? optsOrFn as () => Promise<unknown>
        : maybeFn as () => Promise<unknown>
      return fn()
    }),
    waitForEvent: vi.fn((_name: string, _opts?: unknown) => {
      return Promise.resolve({ payload: {} })
    }),
  }
  return step
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

/** Run the pipeline with architect-approval auto-approved and a given synthesis result. */
async function runPipelineWithSynthesis(
  synthPayload: { verdict: { decision: string; confidence: number; reason: string }; tokenUsage: number; repairCount: number },
  envOverrides?: Record<string, unknown>,
) {
  const { FactoryPipeline } = await import('./pipeline')
  const env = createEnv(envOverrides)
  const step = createMockStep()

  step.waitForEvent = vi.fn((name: string) => {
    if (name === 'architect-approval') {
      return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
    }
    if (name === 'synthesis-complete') {
      return Promise.resolve({ payload: synthPayload })
    }
    return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
  })

  const pipeline = Object.create(FactoryPipeline.prototype)
  pipeline.env = env

  const result = await pipeline.run({ payload: SIGNAL_PAYLOAD }, step)
  return { result, step, env }
}

// ─── Global fetch mock (needed for fire-synthesis-trigger step in pipeline) ───

const originalFetch = globalThis.fetch
const mockGlobalFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
  headers: { 'Content-Type': 'application/json' },
}))

// ─── Tests ───

describe('Stage 6: event-driven synthesis handoff', () => {
  beforeEach(() => {
    mockDb.save.mockClear()
    mockDb.saveEdge.mockClear()
    globalThis.fetch = mockGlobalFetch as unknown as typeof fetch
    mockGlobalFetch.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ── Test 1: /trigger-synthesis returns 400 if missing required fields ──

  describe('/trigger-synthesis validation', () => {
    it('returns 400 when workflowId is missing', async () => {
      const { default: worker } = await import('./index')
      const env = createEnv()
      const ctx = createMockCtx()

      const request = new Request('https://host/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workGraphId: 'WG-TEST',
          workGraph: { _key: 'WG-TEST' },
        }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      expect(response.status).toBe(400)

      const body = await response.json() as { error: string }
      expect(body.error).toContain('Missing required fields')
    })

    it('returns 400 when workGraphId is missing', async () => {
      const { default: worker } = await import('./index')
      const env = createEnv()
      const ctx = createMockCtx()

      const request = new Request('https://host/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraph: { _key: 'WG-TEST' },
        }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      expect(response.status).toBe(400)
    })

    it('returns 400 when workGraph is missing', async () => {
      const { default: worker } = await import('./index')
      const env = createEnv()
      const ctx = createMockCtx()

      const request = new Request('https://host/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraphId: 'WG-TEST',
        }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      expect(response.status).toBe(400)
    })

    it('returns 400 when all three required fields are missing', async () => {
      const { default: worker } = await import('./index')
      const env = createEnv()
      const ctx = createMockCtx()

      const request = new Request('https://host/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      expect(response.status).toBe(400)
    })
  })

  // ── Test 2: /trigger-synthesis calls DO via fetch and sends workflow event ──

  describe('/trigger-synthesis success path', () => {
    it('returns 202 accepted immediately and calls waitUntil for background work', async () => {
      const { default: worker } = await import('./index')

      const doResult = {
        verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
        tokenUsage: 4200,
        repairCount: 0,
      }

      const mockSendEvent = vi.fn(async () => {})
      const mockDoFetch = vi.fn(async () => new Response(JSON.stringify(doResult), {
        headers: { 'Content-Type': 'application/json' },
      }))

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

      const ctx = createMockCtx()

      const request = new Request('https://host/trigger-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'wf-123',
          workGraphId: 'WG-TEST',
          workGraph: { _key: 'WG-TEST', title: 'Test' },
          dryRun: false,
        }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      expect(response.status).toBe(202)

      const body = await response.json() as { accepted: boolean }
      expect(body.accepted).toBe(true)

      // waitUntil must have been called with a promise
      expect(ctx.waitUntil).toHaveBeenCalledOnce()
      const backgroundPromise = ctx.waitUntil.mock.calls[0]![0] as Promise<void>
      expect(backgroundPromise).toBeInstanceOf(Promise)

      // Await the background work to verify it runs correctly
      await backgroundPromise

      // DO was called via fetch with correct URL and payload
      expect(mockDoFetch).toHaveBeenCalledOnce()
      const doFetchCalls = mockDoFetch.mock.calls as unknown as unknown[][]
      const fetchCall = doFetchCalls[0]![0] as Request
      expect(new URL(fetchCall.url).pathname).toBe('/synthesize')

      // Workflow received the synthesis-complete event with DO result
      expect(mockSendEvent).toHaveBeenCalledWith(
        'synthesis-complete',
        expect.objectContaining({
          verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
          tokenUsage: 4200,
          repairCount: 0,
        }),
      )
    })
  })

  // ── Test 3: /trigger-synthesis sends failure event if DO throws ──

  describe('/trigger-synthesis failure path', () => {
    it('returns 202 immediately and sends failure event in background when DO throws', async () => {
      const { default: worker } = await import('./index')

      const mockSendEvent = vi.fn(async () => {})
      const mockDoFetch = vi.fn(async () => { throw new Error('DO isolate crashed') })

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
          get: vi.fn(() => ({ fetch: mockDoFetch })),
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
        }),
      })

      const response = await worker.fetch(request, env as never, ctx as never)
      // Fire-and-forget: always returns 202 regardless of background outcome
      expect(response.status).toBe(202)

      const body = await response.json() as { accepted: boolean }
      expect(body.accepted).toBe(true)

      // Await the background work
      expect(ctx.waitUntil).toHaveBeenCalledOnce()
      const backgroundPromise = ctx.waitUntil.mock.calls[0]![0] as Promise<void>
      await backgroundPromise

      // The critical behavior: workflow still gets an event so it does not hang
      expect(mockSendEvent).toHaveBeenCalledOnce()
      expect(mockSendEvent).toHaveBeenCalledWith(
        'synthesis-complete',
        expect.objectContaining({
          verdict: expect.objectContaining({
            decision: 'fail',
            reason: expect.stringContaining('DO isolate crashed'),
          }),
          tokenUsage: 0,
          repairCount: 0,
        }),
      )
    })
  })

  // ── Test 4: Pipeline queues synthesis after Gate 1 pass ──

  describe('pipeline synthesis queueing', () => {
    it('enqueues to CF Queue with workGraphId and workGraph after Gate 1 pass', async () => {
      const mockQueueSend = vi.fn(async () => ({}))
      const { result } = await runPipelineWithSynthesis(
        {
          verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
          tokenUsage: 100,
          repairCount: 0,
        },
        { SYNTHESIS_QUEUE: { send: mockQueueSend } },
      )

      // Pipeline completed past Gate 1
      expect(result.status).not.toBe('gate-1-failed')

      // Verify CF Queue send was called with correct payload
      expect(mockQueueSend).toHaveBeenCalledOnce()
      const calls = mockQueueSend.mock.calls as unknown[][]
      const sentMessage = calls[0]![0] as Record<string, unknown>
      expect(sentMessage.workGraphId).toBe('WG-TEST')
      expect(sentMessage.workGraph).toBeDefined()
      expect((sentMessage.workGraph as Record<string, unknown>)._key).toBe('WG-TEST')
      expect(sentMessage.dryRun).toBe(false)
    })

    it('does not queue synthesis when Gate 1 fails', async () => {
      const { FactoryPipeline } = await import('./pipeline')
      const step = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
        if (name === 'architect-approval') {
          return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
        }
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const env = createEnv({
        GATES: {
          evaluateGate1: vi.fn(async () => ({
            gate: 1,
            passed: false,
            timestamp: '2026-04-25T00:00:00Z',
            workGraphId: 'WG-TEST',
            checks: [{ name: 'lineage', passed: false, detail: 'broken' }],
            summary: 'Failed',
          })),
        },
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      const result = await pipeline.run({ payload: SIGNAL_PAYLOAD }, step)
      expect(result.status).toBe('gate-1-failed')

      // synthesis_queue should NOT have been written
      const queueSave = mockDb.save.mock.calls.find(
        (call: unknown[]) => call[0] === 'synthesis_queue',
      )
      expect(queueSave).toBeUndefined()
    })
  })

  // ── Test 5: PipelineResult includes synthesisResult when synthesis completes ──

  describe('PipelineResult shape', () => {
    it('includes synthesisResult with verdict, tokenUsage, repairCount on pass', async () => {
      const { result } = await runPipelineWithSynthesis({
        verdict: { decision: 'pass', confidence: 0.92, reason: 'Critic and tester approved' },
        tokenUsage: 8500,
        repairCount: 1,
      })

      expect(result.status).toBe('synthesis-passed')
      expect(result.synthesisResult).toBeDefined()
      expect(result.synthesisResult).toEqual({
        verdict: { decision: 'pass', confidence: 0.92, reason: 'Critic and tester approved' },
        tokenUsage: 8500,
        repairCount: 1,
      })
    })

    it('includes synthesisResult with verdict on fail', async () => {
      const { result } = await runPipelineWithSynthesis({
        verdict: { decision: 'fail', confidence: 1.0, reason: 'Max repairs exceeded' },
        tokenUsage: 15000,
        repairCount: 5,
      })

      expect(result.status).toBe('synthesis-fail')
      expect(result.synthesisResult).toBeDefined()
      expect(result.synthesisResult!.verdict.decision).toBe('fail')
      expect(result.synthesisResult!.tokenUsage).toBe(15000)
      expect(result.synthesisResult!.repairCount).toBe(5)
    })

    it('includes all upstream IDs alongside synthesisResult', async () => {
      const { result } = await runPipelineWithSynthesis({
        verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
        tokenUsage: 4200,
        repairCount: 0,
      })

      expect(result.signalId).toBe('SIG-001')
      expect(result.pressureId).toBe('PRS-001')
      expect(result.capabilityId).toBe('BC-001')
      expect(result.proposalId).toBe('FP-001')
      expect(result.workGraphId).toBe('WG-TEST')
      expect(result.gate1Report).toBeDefined()
      expect(result.gate1Report!.passed).toBe(true)
      expect(result.synthesisResult).toBeDefined()
    })

    it('maps interrupt verdict to synthesis-interrupt status', async () => {
      const { result } = await runPipelineWithSynthesis({
        verdict: { decision: 'interrupt', confidence: 1.0, reason: 'Timeout exceeded' },
        tokenUsage: 3000,
        repairCount: 2,
      })

      expect(result.status).toBe('synthesis-interrupt')
      expect(result.synthesisResult!.verdict.decision).toBe('interrupt')
    })
  })
})
