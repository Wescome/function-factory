import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const mockQuery = vi.fn(async (): Promise<Record<string, unknown>[]> => [])

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => ({
    ping: mockPing,
    query: mockQuery,
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
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockResolvedValue([])
  })

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

  it('POST /debug/pr-outcome enqueues a PR outcome observation', async () => {
    const { default: worker } = await import('./index')
    const send = vi.fn(async () => undefined)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/pr-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pullNumber: 71,
          lineage: {
            pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
            signalId: 'SIG-MOTDWPYM-LTW5',
            pressureId: 'PRS-MOTDWQ0T-S55Y',
            capabilityId: 'BC-MOTDWSVY-PQOO',
            proposalId: 'FP-MOTDWVR2-W7UN',
            workGraphId: 'WG-MOTE4M1R-G7I0',
          },
        }),
      }),
      createEnv({ FEEDBACK_QUEUE: { send } }) as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(202)
    expect(await jsonBody(response)).toMatchObject({
      accepted: true,
      pullNumber: 71,
      workGraphId: 'WG-MOTE4M1R-G7I0',
    })
    expect(send).toHaveBeenCalledWith({
      type: 'pr-outcome',
      pullNumber: 71,
      lineage: {
        pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
        signalId: 'SIG-MOTDWPYM-LTW5',
        pressureId: 'PRS-MOTDWQ0T-S55Y',
        capabilityId: 'BC-MOTDWSVY-PQOO',
        proposalId: 'FP-MOTDWVR2-W7UN',
        workGraphId: 'WG-MOTE4M1R-G7I0',
      },
    })
  })

  it('POST /debug/pr-outcome fails closed when lineage is incomplete', async () => {
    const { default: worker } = await import('./index')
    const send = vi.fn(async () => undefined)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/pr-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pullNumber: 71,
          lineage: {
            pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
            proposalId: 'FP-MOTDWVR2-W7UN',
          },
        }),
      }),
      createEnv({ FEEDBACK_QUEUE: { send } }) as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(400)
    expect(await jsonBody(response)).toMatchObject({
      error: 'Missing required fields: pullNumber, lineage.pipelineId, lineage.proposalId, lineage.workGraphId',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('GET /debug/pr-outcome returns the latest persisted PR outcome signal', async () => {
    const { default: worker } = await import('./index')
    mockQuery.mockResolvedValueOnce([
      {
        _key: 'SIG-PR-OUTCOME',
        subtype: 'synthesis:pr-ci-passed',
        sourceRefs: ['WG:WG-MOTE4M1R-G7I0'],
        createdAt: '2026-05-06T03:45:00Z',
        raw: {
          pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
          proposalId: 'FP-MOTDWVR2-W7UN',
          workGraphId: 'WG-MOTE4M1R-G7I0',
          pr: {
            number: 71,
            url: 'https://github.com/Wescome/function-factory/pull/71',
            headSha: 'ff6187ac67c945a4fe007f666f32d337ecafcfd8',
          },
          outcome: {
            ciState: 'passed',
            prState: 'ready',
            reviewState: 'none',
          },
          checks: {
            passed: ['Test', 'Typecheck', 'Factory PR Gate'],
            failed: [],
            pending: [],
          },
        },
      },
    ])

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/pr-outcome?pullNumber=71&workGraphId=WG-MOTE4M1R-G7I0'),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      found: true,
      signal: {
        _key: 'SIG-PR-OUTCOME',
        subtype: 'synthesis:pr-ci-passed',
        raw: {
          pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
          workGraphId: 'WG-MOTE4M1R-G7I0',
          pr: {
            number: 71,
            url: 'https://github.com/Wescome/function-factory/pull/71',
            headSha: 'ff6187ac67c945a4fe007f666f32d337ecafcfd8',
          },
          checks: {
            passed: ['Test', 'Typecheck', 'Factory PR Gate'],
          },
        },
      },
    })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('synthesis:pr-'),
      { pullNumber: 71, workGraphId: 'WG-MOTE4M1R-G7I0' },
    )
  })

  it('POST /debug/pr-outcome-scan enqueues observations for known Factory PRs', async () => {
    const { default: worker } = await import('./index')
    const send = vi.fn(async () => undefined)
    mockQuery.mockResolvedValueOnce([
      {
        _key: 'SIG-MOTILTZ0-6DGK',
        sourceRefs: [
          'SIG:SIG-MOTDWPYM-LTW5',
          'PRS:PRS-MOTDWQ0T-S55Y',
          'BC:BC-MOTDWSVY-PQOO',
          'FN:FP-MOTDWVR2-W7UN',
          'WG:WG-MOTE4M1R-G7I0',
        ],
        raw: {
          pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
          proposalId: 'FP-MOTDWVR2-W7UN',
          workGraphId: 'WG-MOTE4M1R-G7I0',
          pr: {
            number: 71,
            state: 'OPEN',
            merged: false,
            headSha: 'ff6187ac67c945a4fe007f666f32d337ecafcfd8',
          },
        },
      },
    ])

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/pr-outcome-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      }),
      createEnv({ FEEDBACK_QUEUE: { send } }) as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(202)
    expect(await jsonBody(response)).toMatchObject({
      accepted: true,
      scanned: 1,
      enqueued: 1,
      candidates: [
        {
          pullNumber: 71,
          workGraphId: 'WG-MOTE4M1R-G7I0',
          lastSignalKey: 'SIG-MOTILTZ0-6DGK',
        },
      ],
    })
    expect(send).toHaveBeenCalledWith({
      type: 'pr-outcome',
      pullNumber: 71,
      lineage: {
        pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
        signalId: 'SIG-MOTDWPYM-LTW5',
        pressureId: 'PRS-MOTDWQ0T-S55Y',
        capabilityId: 'BC-MOTDWSVY-PQOO',
        proposalId: 'FP-MOTDWVR2-W7UN',
        workGraphId: 'WG-MOTE4M1R-G7I0',
      },
    })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("factory:pr-outcome"),
      { limit: 10 },
    )
  })

  it('POST /debug/pr-outcome-scan skips malformed persisted candidates', async () => {
    const { default: worker } = await import('./index')
    const send = vi.fn(async () => undefined)
    mockQuery.mockResolvedValueOnce([
      {
        _key: 'SIG-BAD',
        sourceRefs: [],
        raw: {
          pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
          proposalId: 'FP-MOTDWVR2-W7UN',
          pr: { number: 71 },
        },
      },
    ])

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/pr-outcome-scan', { method: 'POST' }),
      createEnv({ FEEDBACK_QUEUE: { send } }) as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(202)
    expect(await jsonBody(response)).toMatchObject({
      accepted: true,
      scanned: 1,
      enqueued: 0,
      skipped: [
        {
          lastSignalKey: 'SIG-BAD',
          reason: 'missing required lineage or pullNumber',
        },
      ],
    })
    expect(send).not.toHaveBeenCalled()
  })
})
