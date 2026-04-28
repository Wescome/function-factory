/**
 * atoms-complete wiring tests.
 *
 * Verifies the atom-results queue consumer sends 'atoms-complete' events
 * to the Workflow when Phase 3 determines all atoms are done.
 *
 * The completion-ledger module is mocked at file level so the dynamic
 * import inside index.ts's queue() handler picks up the mock.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mock cloudflare:workers runtime ───

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

// ─── Mock agents SDK ───

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

// ─── Mock @cloudflare/sandbox + containers ───

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))

// ─── Mock ArangoDB + validator ───

const mockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
  get: vi.fn(async () => null),
  update: vi.fn(async () => ({ _key: 'mock-key' })),
  setValidator: vi.fn(),
}

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => mockDb,
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

// ─── Mock completion-ledger at module level ───
// This is the key: index.ts does `await import('./coordinator/completion-ledger.js')`
// and vitest will resolve it against this mock.

const mockRecordAtomResult = vi.fn()
const mockGetReadyAtoms = vi.fn(() => [])
const mockIsComplete = vi.fn(() => false)

vi.mock('./coordinator/completion-ledger.js', () => ({
  recordAtomResult: (...args: unknown[]) => mockRecordAtomResult(...args),
  getReadyAtoms: (...args: unknown[]) => mockGetReadyAtoms(...args),
  isComplete: (...args: unknown[]) => mockIsComplete(...args),
}))

// ─── Stage stubs (unused but needed for module loading) ───

vi.mock('./stages/ingest-signal', () => ({
  ingestSignal: vi.fn(async () => ({ _key: 'SIG-001' })),
}))
vi.mock('./stages/synthesize-pressure', () => ({
  synthesizePressure: vi.fn(async () => ({ _key: 'PRS-001' })),
}))
vi.mock('./stages/map-capability', () => ({
  mapCapability: vi.fn(async () => ({ _key: 'BC-001' })),
}))
vi.mock('./stages/propose-function', () => ({
  proposeFunction: vi.fn(async () => ({ _key: 'FP-001', prd: {} })),
}))
vi.mock('./stages/semantic-review', () => ({
  semanticReview: vi.fn(async () => ({ alignment: 'aligned', confidence: 0.9, citations: [], rationale: '', timestamp: '' })),
}))
vi.mock('./stages/compile', () => ({
  PASS_NAMES: [],
  compilePRD: vi.fn(async (_p: string, s: Record<string, unknown>) => s),
}))

// ─── Helpers ───

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

function createMockCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

function createEnv(overrides?: Record<string, unknown>) {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: { evaluateGate1: vi.fn() },
    FACTORY_PIPELINE: {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: 'wf-123',
        status: vi.fn(),
        sendEvent: vi.fn(async () => {}),
      })),
    },
    COORDINATOR: {
      idFromName: vi.fn(() => 'do-id'),
      get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('{}')) })),
    },
    SYNTHESIS_QUEUE: { send: vi.fn(async () => ({})) },
    SYNTHESIS_RESULTS: { send: vi.fn(async () => ({})) },
    ATOM_RESULTS: { send: vi.fn(async () => ({})) },
    ...overrides,
  }
}

// ─── Tests ───

describe('atom-results queue consumer: atoms-complete event wiring', () => {

  beforeEach(() => {
    mockRecordAtomResult.mockReset()
    mockGetReadyAtoms.mockReset().mockReturnValue([])
    mockIsComplete.mockReset().mockReturnValue(false)
  })

  it('sends atoms-complete event to Workflow when all atoms complete (pass)', async () => {
    const { default: worker } = await import('./index')

    const ledger = {
      _key: 'WG-DONE',
      workflowId: 'wf-done',
      totalAtoms: 2,
      completedAtoms: 2,
      atomResults: {
        'atom-1': {
          atomId: 'atom-1',
          verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
          codeArtifact: { files: [{ path: 'a.ts', content: 'ok' }] },
          testReport: null,
          critiqueReport: null,
          retryCount: 0,
        },
        'atom-2': {
          atomId: 'atom-2',
          verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
          codeArtifact: { files: [{ path: 'b.ts', content: 'ok' }] },
          testReport: null,
          critiqueReport: null,
          retryCount: 1,
        },
      },
      layers: [],
      allAtomSpecs: {},
      sharedContext: { workGraphId: 'WG-DONE', specContent: null, briefingScript: {} },
      pendingAtoms: [],
      phase: 'complete',
    }

    mockRecordAtomResult.mockResolvedValue(ledger)
    mockIsComplete.mockReturnValue(true)

    const mockSendEvent = vi.fn(async () => {})
    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-done',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
    })

    const msg = createMockMessage({
      workGraphId: 'WG-DONE',
      atomId: 'atom-2',
      result: {
        atomId: 'atom-2',
        verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
        codeArtifact: { files: [{ path: 'b.ts', content: 'ok' }] },
        testReport: null,
        critiqueReport: null,
        retryCount: 1,
      },
      workflowId: 'wf-done',
    })

    const batch = {
      messages: [msg],
      queue: 'atom-results',
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    }

    await worker.queue(batch as never, env as never, createMockCtx() as never)

    // Should send atoms-complete (NOT synthesis-complete) to the Workflow
    expect(mockSendEvent).toHaveBeenCalledOnce()
    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'atoms-complete',
        payload: expect.objectContaining({
          verdict: expect.objectContaining({
            decision: 'pass',
            reason: expect.stringContaining('2 atoms passed'),
          }),
          repairCount: 1, // sum of retryCount across atoms
          atomResults: expect.any(Object),
        }),
      }),
    )
    expect(msg.ack).toHaveBeenCalledOnce()
  })

  it('sends atoms-complete with fail verdict when some atoms fail', async () => {
    const { default: worker } = await import('./index')

    const ledger = {
      _key: 'WG-FAIL',
      workflowId: 'wf-fail',
      totalAtoms: 2,
      completedAtoms: 2,
      atomResults: {
        'atom-1': {
          atomId: 'atom-1',
          verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
          codeArtifact: { files: [] },
          testReport: null,
          critiqueReport: null,
          retryCount: 0,
        },
        'atom-2': {
          atomId: 'atom-2',
          verdict: { decision: 'fail', confidence: 0.8, reason: 'tests broken' },
          codeArtifact: null,
          testReport: null,
          critiqueReport: null,
          retryCount: 3,
        },
      },
      layers: [],
      allAtomSpecs: {},
      sharedContext: { workGraphId: 'WG-FAIL', specContent: null, briefingScript: {} },
      pendingAtoms: [],
      phase: 'complete',
    }

    mockRecordAtomResult.mockResolvedValue(ledger)
    mockIsComplete.mockReturnValue(true)

    const mockSendEvent = vi.fn(async () => {})
    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-fail',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
    })

    const msg = createMockMessage({
      workGraphId: 'WG-FAIL',
      atomId: 'atom-2',
      result: {
        atomId: 'atom-2',
        verdict: { decision: 'fail', confidence: 0.8, reason: 'tests broken' },
        codeArtifact: null,
        testReport: null,
        critiqueReport: null,
        retryCount: 3,
      },
      workflowId: 'wf-fail',
    })

    const batch = {
      messages: [msg],
      queue: 'atom-results',
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    }

    await worker.queue(batch as never, env as never, createMockCtx() as never)

    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'atoms-complete',
        payload: expect.objectContaining({
          verdict: expect.objectContaining({
            decision: 'fail',
            reason: expect.stringContaining('atom-2'),
          }),
        }),
      }),
    )
  })

  it('falls back to SYNTHESIS_RESULTS queue when sendEvent fails', async () => {
    const { default: worker } = await import('./index')

    const ledger = {
      _key: 'WG-FALLBACK',
      workflowId: 'wf-fallback',
      totalAtoms: 1,
      completedAtoms: 1,
      atomResults: {
        'atom-1': {
          atomId: 'atom-1',
          verdict: { decision: 'pass', confidence: 1.0, reason: 'ok' },
          codeArtifact: { files: [] },
          testReport: null,
          critiqueReport: null,
          retryCount: 0,
        },
      },
      layers: [],
      allAtomSpecs: {},
      sharedContext: { workGraphId: 'WG-FALLBACK', specContent: null, briefingScript: {} },
      pendingAtoms: [],
      phase: 'complete',
    }

    mockRecordAtomResult.mockResolvedValue(ledger)
    mockIsComplete.mockReturnValue(true)

    const mockSendEvent = vi.fn(async () => { throw new Error('workflow not running') })
    const mockQueueSend = vi.fn(async () => {})
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-fallback',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
      SYNTHESIS_RESULTS: { send: mockQueueSend },
    })

    const msg = createMockMessage({
      workGraphId: 'WG-FALLBACK',
      atomId: 'atom-1',
      result: {
        atomId: 'atom-1',
        verdict: { decision: 'pass', confidence: 1.0, reason: 'ok' },
        codeArtifact: { files: [] },
        testReport: null,
        critiqueReport: null,
        retryCount: 0,
      },
      workflowId: 'wf-fallback',
    })

    const batch = {
      messages: [msg],
      queue: 'atom-results',
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    }

    await worker.queue(batch as never, env as never, createMockCtx() as never)

    // sendEvent failed, so it should fall back to SYNTHESIS_RESULTS queue
    expect(mockSendEvent).toHaveBeenCalledOnce()
    expect(mockQueueSend).toHaveBeenCalledOnce()

    // Queue fallback should include verdict
    const queueMsg = mockQueueSend.mock.calls[0]![0] as Record<string, unknown>
    expect(queueMsg.workflowId).toBe('wf-fallback')
    expect(queueMsg.verdict).toBeDefined()

    // Error was logged
    expect(consoleSpy).toHaveBeenCalled()
    const loggedMsg = consoleSpy.mock.calls[0]![0] as string
    expect(loggedMsg).toContain('wf-fallback')
    expect(loggedMsg).toContain('workflow not running')

    consoleSpy.mockRestore()
  })

  it('does NOT send atoms-complete when not all atoms are done', async () => {
    const { default: worker } = await import('./index')

    const ledger = {
      _key: 'WG-PARTIAL',
      workflowId: 'wf-partial',
      totalAtoms: 3,
      completedAtoms: 1,
      atomResults: {
        'atom-1': {
          atomId: 'atom-1',
          verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
          codeArtifact: { files: [] },
          testReport: null,
          critiqueReport: null,
          retryCount: 0,
        },
      },
      layers: [],
      allAtomSpecs: {},
      sharedContext: { workGraphId: 'WG-PARTIAL', specContent: null, briefingScript: {} },
      pendingAtoms: ['atom-2', 'atom-3'],
      phase: 'executing',
    }

    mockRecordAtomResult.mockResolvedValue(ledger)
    mockIsComplete.mockReturnValue(false) // NOT complete

    const mockSendEvent = vi.fn(async () => {})
    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-partial',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
    })

    const msg = createMockMessage({
      workGraphId: 'WG-PARTIAL',
      atomId: 'atom-1',
      result: {
        atomId: 'atom-1',
        verdict: { decision: 'pass', confidence: 0.9, reason: 'ok' },
        codeArtifact: { files: [] },
        testReport: null,
        critiqueReport: null,
        retryCount: 0,
      },
      workflowId: 'wf-partial',
    })

    const batch = {
      messages: [msg],
      queue: 'atom-results',
      metadata: { metrics: { backlogCount: 1, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    }

    await worker.queue(batch as never, env as never, createMockCtx() as never)

    // Should NOT have sent any event — atoms are still running
    expect(mockSendEvent).not.toHaveBeenCalled()
    expect(msg.ack).toHaveBeenCalledOnce()
  })
})
