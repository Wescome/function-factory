/**
 * Tests for the /synthesis-callback route (ADR-005 v4.1).
 *
 * The callback route receives POST requests from the SynthesisCoordinator DO
 * after synthesis completes (success, failure, or alarm timeout) and forwards
 * the result to the Workflow via sendEvent('synthesis-complete').
 *
 * This decouples the queue consumer from the DO synthesis lifecycle:
 *   Queue consumer -> fire-and-forget dispatch -> DO runs synthesis ->
 *   DO calls /synthesis-callback -> Workflow resumes
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

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => ({
    save: vi.fn(async () => ({ _key: 'mock-key' })),
    saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
    query: vi.fn(async () => []),
    setValidator: vi.fn(),
  }),
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

// ─── Test helpers ───

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
        id: 'wf-default',
        status: vi.fn(),
        sendEvent: vi.fn(async () => {}),
      })),
    },
    COORDINATOR: {
      idFromName: vi.fn(() => 'do-id'),
      get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('{}')) })),
    },
    SYNTHESIS_QUEUE: { send: vi.fn() },
    ...overrides,
  }
}

// ─── Tests ───

describe('/synthesis-callback route (ADR-005 v4.1)', () => {
  const originalFetch = globalThis.fetch
  const mockGlobalFetch = vi.fn(async () => new Response('{}'))

  beforeEach(() => {
    globalThis.fetch = mockGlobalFetch as unknown as typeof fetch
    mockGlobalFetch.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('calls workflow.sendEvent with synthesis-complete event from callback body', async () => {
    const { default: worker } = await import('./index')

    const mockSendEvent = vi.fn(async () => {})

    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-callback-1',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
    })

    const ctx = createMockCtx()

    const request = new Request('https://host/synthesis-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-callback-1',
        verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
        tokenUsage: 4200,
        repairCount: 0,
      }),
    })

    const response = await worker.fetch(request, env as never, ctx as never)

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.received).toBe(true)

    // Verify sendEvent was called with correct payload
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
  })

  it('returns 200 with { received: true }', async () => {
    const { default: worker } = await import('./index')

    const env = createEnv()
    const ctx = createMockCtx()

    const request = new Request('https://host/synthesis-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-200',
        verdict: { decision: 'fail', confidence: 1.0, reason: 'Synthesis failed' },
        tokenUsage: 100,
        repairCount: 2,
      }),
    })

    const response = await worker.fetch(request, env as never, ctx as never)
    expect(response.status).toBe(200)

    const body = await response.json() as Record<string, unknown>
    expect(body.received).toBe(true)
  })

  it('returns 400 when workflowId is missing', async () => {
    const { default: worker } = await import('./index')

    const env = createEnv()
    const ctx = createMockCtx()

    const request = new Request('https://host/synthesis-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // workflowId intentionally omitted
        verdict: { decision: 'pass', confidence: 1.0, reason: 'ok' },
        tokenUsage: 0,
        repairCount: 0,
      }),
    })

    const response = await worker.fetch(request, env as never, ctx as never)
    expect(response.status).toBe(400)

    const body = await response.json() as Record<string, unknown>
    expect(body.error).toContain('Missing workflowId')
  })

  it('returns 500 when sendEvent throws', async () => {
    const { default: worker } = await import('./index')

    const mockSendEvent = vi.fn(async () => {
      throw new Error('workflow not running')
    })

    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-err',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
    })

    const ctx = createMockCtx()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const request = new Request('https://host/synthesis-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-err',
        verdict: { decision: 'pass', confidence: 1.0, reason: 'ok' },
        tokenUsage: 0,
        repairCount: 0,
      }),
    })

    const response = await worker.fetch(request, env as never, ctx as never)
    expect(response.status).toBe(500)

    const body = await response.json() as Record<string, unknown>
    expect(body.error).toContain('workflow not running')

    consoleSpy.mockRestore()
  })

  it('forwards interrupt verdict from DO alarm timeout', async () => {
    const { default: worker } = await import('./index')

    const mockSendEvent = vi.fn(async () => {})

    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: vi.fn(async () => ({
          id: 'wf-alarm',
          status: vi.fn(),
          sendEvent: mockSendEvent,
        })),
      },
    })

    const ctx = createMockCtx()

    const request = new Request('https://host/synthesis-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-alarm',
        verdict: {
          decision: 'interrupt',
          confidence: 1.0,
          reason: 'DO alarm: synthesis exceeded wall-clock deadline',
        },
        tokenUsage: 0,
        repairCount: 0,
      }),
    })

    const response = await worker.fetch(request, env as never, ctx as never)
    expect(response.status).toBe(200)

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
  })

  it('resolves workflow by workflowId from request body', async () => {
    const { default: worker } = await import('./index')

    const mockGet = vi.fn(async () => ({
      id: 'wf-resolve-test',
      status: vi.fn(),
      sendEvent: vi.fn(async () => {}),
    }))

    const env = createEnv({
      FACTORY_PIPELINE: {
        create: vi.fn(),
        get: mockGet,
      },
    })

    const ctx = createMockCtx()

    const request = new Request('https://host/synthesis-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-resolve-test',
        verdict: { decision: 'pass', confidence: 1.0, reason: 'ok' },
        tokenUsage: 0,
        repairCount: 0,
      }),
    })

    await worker.fetch(request, env as never, ctx as never)

    expect(mockGet).toHaveBeenCalledWith('wf-resolve-test')
  })

  it('only matches POST method', async () => {
    const { default: worker } = await import('./index')

    const env = createEnv()
    const ctx = createMockCtx()

    const request = new Request('https://host/synthesis-callback', {
      method: 'GET',
    })

    const response = await worker.fetch(request, env as never, ctx as never)
    // GET should fall through to 404
    expect(response.status).toBe(404)
  })
})
