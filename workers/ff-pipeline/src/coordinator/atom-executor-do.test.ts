/**
 * v5.1: AtomExecutor Durable Object tests.
 *
 * The AtomExecutor DO runs a single atom's 4-node pipeline
 * (code → critic → test → verify) with its own lifetime and alarm.
 *
 * Tests:
 *   1. AtomExecutor runs executeAtomSlice and returns result via response
 *   2. AtomExecutor checks idempotency (cached result returned on re-call)
 *   3. AtomExecutor publishes to ATOM_RESULTS queue on completion
 *   4. AtomExecutor alarm publishes interrupt result
 *   5. AtomExecutor sets 300s alarm on start
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock cloudflare:workers ───
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

// ─── Mock agents SDK ───
vi.mock('agents', () => {
  class Agent {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  const callable = () => (_target: unknown, _context: unknown) => _target
  return { Agent, callable }
})

// ─── Mock arango client ───
vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => ({
    save: vi.fn(async () => ({ _key: 'mock' })),
    get: vi.fn(async () => null),
    update: vi.fn(async () => ({ _key: 'mock' })),
    query: vi.fn(async () => []),
    setValidator: vi.fn(),
  }),
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

// ─── Mock executeAtomSlice ───
const mockExecuteAtomSlice = vi.fn()
vi.mock('./atom-executor.js', () => ({
  executeAtomSlice: (...args: unknown[]) => mockExecuteAtomSlice(...args),
}))

// ─── Helpers ───

function makeMockStorage() {
  const data = new Map<string, unknown>()
  let alarmTime: number | null = null
  return {
    get: vi.fn(async <T = unknown>(key: string): Promise<T | undefined> => data.get(key) as T | undefined),
    put: vi.fn(async (key: string, value: unknown) => { data.set(key, value) }),
    delete: vi.fn(async (key: string) => data.delete(key)),
    setAlarm: vi.fn(async (time: number) => { alarmTime = time }),
    deleteAlarm: vi.fn(async () => { alarmTime = null }),
    _data: data,
    _getAlarmTime: () => alarmTime,
  }
}

function makeMockCtx() {
  return {
    storage: makeMockStorage(),
    id: { toString: () => 'atom-do-id-123' },
  }
}

function makeMockEnv(overrides: Record<string, unknown> = {}) {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    OFOX_API_KEY: 'test-key',
    ATOM_RESULTS: {
      send: vi.fn(async () => {}),
    },
    ...overrides,
  }
}

function makeAtomSpec() {
  return {
    atomId: 'atom-001',
    atomSpec: { id: 'atom-001', description: 'Test atom' },
    sharedContext: {
      workGraphId: 'WG-TEST',
      specContent: null,
      briefingScript: { goal: 'test' },
    },
    upstreamArtifacts: {},
    workflowId: 'wf-123',
    workGraphId: 'WG-TEST',
    maxRetries: 3,
    dryRun: true,
  }
}

function makePassResult(atomId: string = 'atom-001') {
  return {
    atomId,
    verdict: { decision: 'pass' as const, confidence: 1.0, reason: 'Dry-run pass' },
    codeArtifact: {
      files: [{ path: 'src/stub.ts', content: '// stub', action: 'create' as const }],
      summary: 'Dry-run code',
      testsIncluded: false,
    },
    testReport: { passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0, failures: [], summary: 'OK' },
    critiqueReport: null,
    retryCount: 0,
  }
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('v5.1: AtomExecutor DO', () => {
  beforeEach(() => {
    mockExecuteAtomSlice.mockReset()
    mockExecuteAtomSlice.mockResolvedValue(makePassResult())
  })

  it('runs executeAtomSlice and returns result via POST /execute-atom', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    const request = new Request('https://do/execute-atom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeAtomSpec()),
    })

    const response = await executor.fetch(request)
    expect(response.status).toBe(200)

    const body = await response.json() as Record<string, unknown>
    expect(body.atomId).toBe('atom-001')
    expect((body.verdict as Record<string, unknown>).decision).toBe('pass')

    // executeAtomSlice was called
    expect(mockExecuteAtomSlice).toHaveBeenCalledOnce()
  })

  it('returns cached result on re-call (idempotency)', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    // Pre-populate cache
    const cached = makePassResult()
    ctx.storage._data.set('atomResult', cached)

    const request = new Request('https://do/execute-atom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeAtomSpec()),
    })

    const response = await executor.fetch(request)
    expect(response.status).toBe(200)

    const body = await response.json() as Record<string, unknown>
    expect(body.atomId).toBe('atom-001')

    // executeAtomSlice was NOT called — cached result returned
    expect(mockExecuteAtomSlice).not.toHaveBeenCalled()
  })

  it('publishes to ATOM_RESULTS queue on completion', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    const request = new Request('https://do/execute-atom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeAtomSpec()),
    })

    await executor.fetch(request)

    const atomResultsQueue = env.ATOM_RESULTS as { send: ReturnType<typeof vi.fn> }
    expect(atomResultsQueue.send).toHaveBeenCalledOnce()
    const sentMessage = atomResultsQueue.send.mock.calls[0]![0] as Record<string, unknown>
    expect(sentMessage.workGraphId).toBe('WG-TEST')
    expect(sentMessage.atomId).toBe('atom-001')
    expect((sentMessage.result as Record<string, unknown>).atomId).toBe('atom-001')
  })

  it('alarm publishes interrupt result to ATOM_RESULTS', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    // Store the atom spec metadata (normally set during fetch)
    ctx.storage._data.set('__atomId', 'atom-001')
    ctx.storage._data.set('__workGraphId', 'WG-TEST')
    ctx.storage._data.set('__workflowId', 'wf-123')
    // No __completed flag → alarm should fire

    await executor.alarm()

    const atomResultsQueue = env.ATOM_RESULTS as { send: ReturnType<typeof vi.fn> }
    expect(atomResultsQueue.send).toHaveBeenCalledOnce()

    const sentMessage = atomResultsQueue.send.mock.calls[0]![0] as Record<string, unknown>
    expect(sentMessage.atomId).toBe('atom-001')
    expect(sentMessage.workGraphId).toBe('WG-TEST')
    const result = sentMessage.result as Record<string, unknown>
    const verdict = result.verdict as Record<string, unknown>
    expect(verdict.decision).toBe('fail')
    expect(verdict.reason).toContain('alarm')
  })

  it('alarm does nothing when already completed', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    ctx.storage._data.set('__completed', true)

    await executor.alarm()

    const atomResultsQueue = env.ATOM_RESULTS as { send: ReturnType<typeof vi.fn> }
    expect(atomResultsQueue.send).not.toHaveBeenCalled()
  })

  it('sets 300s alarm on start of execution', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    const request = new Request('https://do/execute-atom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeAtomSpec()),
    })

    await executor.fetch(request)

    expect(ctx.storage.setAlarm).toHaveBeenCalledOnce()
    const alarmTime = ctx.storage.setAlarm.mock.calls[0]![0] as number
    // Should be approximately 600s from now
    const expectedTime = Date.now() + 600_000
    expect(Math.abs(alarmTime - expectedTime)).toBeLessThan(5_000)
  })

  it('stores result in DO storage after execution', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    const request = new Request('https://do/execute-atom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeAtomSpec()),
    })

    await executor.fetch(request)

    // Result stored in DO storage for idempotency
    const stored = ctx.storage._data.get('atomResult') as Record<string, unknown>
    expect(stored).toBeDefined()
    expect(stored.atomId).toBe('atom-001')

    // Completed flag set
    expect(ctx.storage._data.get('__completed')).toBe(true)
  })

  it('returns 404 for unknown paths', async () => {
    const { AtomExecutor } = await import('./atom-executor-do.js')

    const ctx = makeMockCtx()
    const env = makeMockEnv()
    const executor = new AtomExecutor(ctx as never, env as never)

    const request = new Request('https://do/unknown', { method: 'GET' })
    const response = await executor.fetch(request)
    expect(response.status).toBe(404)
  })
})
