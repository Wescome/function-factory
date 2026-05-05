import { describe, expect, it, vi } from 'vitest'

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

const mockPing = vi.fn(async () => true)

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => ({
    ping: mockPing,
    query: vi.fn(async () => []),
  }),
}))

function createEnv(overrides?: Record<string, unknown>) {
  return {
    ARANGO_URL: 'https://arango.example.com:8529',
    ARANGO_DATABASE: 'function_factory_test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: { evaluateGate1: vi.fn() },
    FACTORY_PIPELINE: {
      create: vi.fn(),
      get: vi.fn(),
    },
    COORDINATOR: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
    ATOM_EXECUTOR: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
    SYNTHESIS_QUEUE: {
      send: vi.fn(),
    },
    SYNTHESIS_RESULTS: {
      send: vi.fn(),
    },
    ATOM_RESULTS: {
      send: vi.fn(),
    },
    ...overrides,
  }
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('ff-pipeline diagnostic routes', () => {
  it('GET /version returns service version metadata', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/version'),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      service: 'ff-pipeline',
      version: '0.1.0',
      environment: 'test',
    })
  })

  it('GET /debug/health reports Arango and AI binding status', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/health'),
      createEnv({ AI: { run: vi.fn() } }) as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      service: 'ff-pipeline',
      status: 'healthy',
      arango: true,
      aiBinding: true,
      environment: 'test',
    })
  })

  it('GET /debug/arango checks database connectivity without exposing credentials', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/arango'),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    const body = await jsonBody(response)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      status: 'healthy',
      database: 'function_factory_test',
    })
    expect(JSON.stringify(body)).not.toContain('test-jwt')
  })

  it('GET /debug/ai-test runs a small Workers AI binding probe', async () => {
    const { default: worker } = await import('./index')
    const run = vi.fn(async () => ({ response: '{"ok":true}' }))

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/ai-test'),
      createEnv({ AI: { run } }) as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledOnce()
    expect(await jsonBody(response)).toMatchObject({
      ok: true,
      aiBinding: true,
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      responseType: 'string',
      responseLength: 11,
    })
  })

  it('GET /debug/ai-test fails closed when the AI binding is unavailable', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/ai-test'),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(503)
    expect(await jsonBody(response)).toMatchObject({
      ok: false,
      aiBinding: false,
      error: 'Workers AI binding unavailable',
    })
  })
})
