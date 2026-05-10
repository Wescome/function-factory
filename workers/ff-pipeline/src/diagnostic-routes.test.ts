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
const mockEnsureCollection = vi.fn(async (_collection: string): Promise<void> => undefined)
const mockQuery = vi.fn(async (): Promise<Record<string, unknown>[]> => [])
const mockQueryOne = vi.fn(async (): Promise<Record<string, unknown> | null> => null)
const mockSave = vi.fn(async (_collection: string, doc: Record<string, unknown>) => doc)
const mockGet = vi.fn(async (_collection: string, _key: string): Promise<Record<string, unknown> | null> => null)
const mockUpdate = vi.fn(async (_collection: string, _key: string, patch: Record<string, unknown>) => patch)
const mockSaveEdge = vi.fn(async (
  _collection: string,
  _from: string,
  _to: string,
  edge: Record<string, unknown>,
) => edge)

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => ({
    ping: mockPing,
    ensureCollection: mockEnsureCollection,
    query: mockQuery,
    queryOne: mockQueryOne,
    save: mockSave,
    get: mockGet,
    update: mockUpdate,
    saveEdge: mockSaveEdge,
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
    mockEnsureCollection.mockReset()
    mockEnsureCollection.mockResolvedValue(undefined)
    mockQueryOne.mockReset()
    mockQueryOne.mockResolvedValue(null)
    mockSave.mockReset()
    mockSave.mockImplementation(async (_collection: string, doc: Record<string, unknown>) => doc)
    mockGet.mockReset()
    mockGet.mockResolvedValue(null)
    mockUpdate.mockReset()
    mockUpdate.mockImplementation(async (_collection: string, _key: string, patch: Record<string, unknown>) => patch)
    mockSaveEdge.mockReset()
    mockSaveEdge.mockImplementation(async (
      _collection: string,
      _from: string,
      _to: string,
      edge: Record<string, unknown>,
    ) => edge)
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

  it('POST /debug/pr-outcome can process a supplied PR outcome immediately', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/pr-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processNow: true,
          outcome: {
            lineage: {
              pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
              signalId: 'SIG-MOTDWPYM-LTW5',
              pressureId: 'PRS-MOTDWQ0T-S55Y',
              capabilityId: 'BC-MOTDWSVY-PQOO',
              proposalId: 'FP-MOTDWVR2-W7UN',
              workGraphId: 'WG-MOTE4M1R-G7I0',
            },
            pullRequest: {
              number: 71,
              url: 'https://github.com/Wescome/function-factory/pull/71',
              title: '[Factory] Materialize WG-MOTE4M1R-G7I0 synthesis artifact',
              state: 'OPEN',
              draft: true,
              merged: false,
              headRefName: 'factory/fp-motdwvr2-w7un',
              baseRefName: 'main',
              headSha: '2409e98586b99b9d3517d4d8b4f18daf9508e658',
            },
            checks: [
              { name: 'Factory PR Gate', state: 'SUCCESS' },
              { name: 'Test', state: 'SUCCESS' },
              { name: 'Typecheck', state: 'SUCCESS' },
            ],
            observedAt: '2026-05-07T21:20:00Z',
          },
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      accepted: true,
      processed: true,
      pullNumber: 71,
      workGraphId: 'WG-MOTE4M1R-G7I0',
      records: [
        {
          subtype: 'synthesis:pr-ci-passed',
          raw: {
            pr: {
              headSha: '2409e98586b99b9d3517d4d8b4f18daf9508e658',
            },
          },
        },
      ],
    })
    expect(mockSave).toHaveBeenCalledWith(
      'specs_signals',
      expect.objectContaining({
        source: 'factory:pr-outcome',
        description: 'Factory PR #71 passed all observed CI checks at head 2409e98',
        raw: expect.objectContaining({
          pr: expect.objectContaining({
            headSha: '2409e98586b99b9d3517d4d8b4f18daf9508e658',
          }),
        }),
      }),
    )
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

  it('POST /debug/mrp builds and persists a merge-readiness pack from supplied evidence', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          prOutcomeSignal: makePROutcomeSignal(),
          createdAt: '2026-05-06T21:30:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      id: 'MRP-MOTE4M1R-G7I0-71',
      readinessVerdict: 'ready',
      verdict: 'merge-ready',
      pack: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        functionId: 'FN-MOTDWVR2-W7UN',
        workGraphId: 'WG-MOTE4M1R-G7I0',
        ciEvidence: {
          status: 'passed',
          checksPassed: ['Factory PR Gate', 'Typecheck', 'Test'],
        },
      },
    })
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('merge_readiness_packs'),
      { id: 'MRP-MOTE4M1R-G7I0-71' },
    )
    expect(mockSave).toHaveBeenCalledWith(
      'merge_readiness_packs',
      expect.objectContaining({
        _key: 'MRP-MOTE4M1R-G7I0-71',
        id: 'MRP-MOTE4M1R-G7I0-71',
        functionId: 'FN-MOTDWVR2-W7UN',
        verdict: 'merge-ready',
      }),
    )
  })

  it('POST /debug/mrp can resolve the PR outcome signal by key before persisting', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne
      .mockResolvedValueOnce(makePROutcomeSignal())
      .mockResolvedValueOnce(null)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          prOutcomeSignalKey: 'SIG-MOTILTZ0-6DGK',
          createdAt: '2026-05-06T21:30:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      id: 'MRP-MOTE4M1R-G7I0-71',
      pack: {
        functionId: 'FN-MOTDWVR2-W7UN',
      },
    })
    expect(mockQueryOne.mock.calls[0]).toEqual([
      expect.stringContaining('specs_signals'),
      { key: 'SIG-MOTILTZ0-6DGK' },
    ])
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('POST /debug/mrp can return canonical MRP with Merge Readiness derived functionId', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          prOutcomeSignal: makePROutcomeSignal(),
          canonicalEvidence: makeCanonicalMRPEvidence(),
          createdAt: '2026-05-06T21:30:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      canonical: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        functionId: 'FN-MOTDWVR2-W7UN',
        verdict: 'merge-ready',
        auditability: {
          workGraphId: 'WG-MOTE4M1R-G7I0',
        },
      },
    })
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('POST /debug/mrp can rebuild canonical MRP from persisted Fidelity Verification evidence', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne
      .mockResolvedValueOnce({
        _key: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        type: 'gate-2',
        passed: true,
        report: {
          gate: 2,
          overall: 'pass',
        },
      })
      .mockResolvedValueOnce(null)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          prOutcomeSignal: makePROutcomeSignal(),
          canonicalEvidence: makeCanonicalMRPEvidence(),
          fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
          createdAt: '2026-05-06T21:30:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      gate2ReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      canonical: {
        soundVerification: {
          fidelityVerificationReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
          gate2ReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        },
        auditability: {
          fidelityVerificationReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
          gate2ReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        },
      },
    })
    expect(mockQueryOne.mock.calls[0]).toEqual([
      expect.stringContaining('specs_coverage_reports'),
      { key: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z' },
    ])
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('POST /debug/mrp can source canonical evidence by key before canonical validation', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne
      .mockResolvedValueOnce({
        _key: 'MRP-EVIDENCE-MOTE4M1R',
        canonicalEvidence: makeCanonicalMRPEvidence(),
      })
      .mockResolvedValueOnce(null)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          prOutcomeSignal: makePROutcomeSignal(),
          canonicalEvidenceKey: 'MRP-EVIDENCE-MOTE4M1R',
          createdAt: '2026-05-06T21:30:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      canonical: {
        functionId: 'FN-MOTDWVR2-W7UN',
        verdict: 'merge-ready',
      },
    })
    expect(mockQueryOne.mock.calls[0]).toEqual([
      expect.stringContaining('merge_readiness_evidence'),
      { key: 'MRP-EVIDENCE-MOTE4M1R' },
    ])
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('POST /debug/mrp-evidence persists a canonical evidence record for sourced MRP assembly', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'MRP-EVIDENCE-MOTE4M1R',
          canonicalEvidence: makeCanonicalMRPEvidence(),
          sourceRefs: ['MRP-MOTE4M1R-G7I0-71', 'SIG-MOTILTZ0-6DGK'],
          createdAt: '2026-05-06T21:29:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      key: 'MRP-EVIDENCE-MOTE4M1R',
    })
    expect(mockEnsureCollection).toHaveBeenCalledWith('merge_readiness_evidence')
    expect(mockSave).toHaveBeenCalledWith(
      'merge_readiness_evidence',
      expect.objectContaining({
        _key: 'MRP-EVIDENCE-MOTE4M1R',
        id: 'MRP-EVIDENCE-MOTE4M1R',
        canonicalEvidence: expect.objectContaining({
          auditability: expect.objectContaining({
            gate2ReportId: 'CR-MOTE4M1R-GATE2',
          }),
        }),
        sourceRefs: ['MRP-MOTE4M1R-G7I0-71', 'SIG-MOTILTZ0-6DGK'],
        createdAt: '2026-05-06T21:29:00Z',
      }),
    )
  })

  it('POST /debug/mrp validates canonical evidence before persisting runtime MRP', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          prOutcomeSignal: makePROutcomeSignal(),
          canonicalEvidence: {
            ...makeCanonicalMRPEvidence(),
            functionId: 'FN-DIFFERENT',
          },
          createdAt: '2026-05-06T21:30:00Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(400)
    expect(await jsonBody(response)).toMatchObject({
      error: expect.stringContaining('evidence.functionId must match the Merge Readiness functionId'),
    })
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('POST /debug/mrp-auto assembles MRP from the latest persisted PR outcome signal', async () => {
    const { default: worker } = await import('./index')
    mockQuery.mockResolvedValueOnce([
      {
        ...makePROutcomeSignal(),
        _key: 'SIG-LATEST',
        raw: {
          ...makePROutcomeSignal().raw as Record<string, unknown>,
          pr: {
            ...((makePROutcomeSignal().raw as Record<string, unknown>).pr as Record<string, unknown>),
            headSha: 'b44ae7d085e1d8c763b162d805767e04b22f7c89',
          },
          observedAt: '2026-05-07T21:18:02.047Z',
        },
        createdAt: '2026-05-07T21:18:02.105Z',
      },
    ])
    mockQueryOne
      .mockResolvedValueOnce({
        _key: 'MRP-EVIDENCE-MOTE4M1R-b44ae7d',
        canonicalEvidence: makeCanonicalMRPEvidence(),
      })
      .mockResolvedValueOnce(null)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          pullNumber: 71,
          canonicalEvidenceKey: 'MRP-EVIDENCE-MOTE4M1R-b44ae7d',
          createdAt: '2026-05-07T21:18:10Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      id: 'MRP-MOTE4M1R-G7I0-71',
      prOutcomeSignalKey: 'SIG-LATEST',
      canonicalEvidenceKey: 'MRP-EVIDENCE-MOTE4M1R-b44ae7d',
      canonical: {
        functionId: 'FN-MOTDWVR2-W7UN',
        ciEvidence: {
          commitSha: 'b44ae7d085e1d8c763b162d805767e04b22f7c89',
        },
      },
      pack: {
        functionId: 'FN-MOTDWVR2-W7UN',
        prEvidence: {
          signalId: 'SIG-LATEST',
          headSha: 'b44ae7d085e1d8c763b162d805767e04b22f7c89',
        },
      },
    })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('factory:pr-outcome'),
      { pullNumber: 71, workGraphId: 'WG-MOTE4M1R-G7I0' },
    )
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('merge_readiness_evidence'),
      { key: 'MRP-EVIDENCE-MOTE4M1R-b44ae7d' },
    )
  })

  it('POST /debug/mrp-auto can overlay persisted Fidelity Verification evidence during Merge Readiness assembly', async () => {
    const { default: worker } = await import('./index')
    mockQuery.mockResolvedValueOnce([
      {
        ...makePROutcomeSignal(),
        _key: 'SIG-LATEST',
      },
    ])
    mockQueryOne
      .mockResolvedValueOnce({
        _key: 'MRP-EVIDENCE-MOTE4M1R-b44ae7d',
        canonicalEvidence: makeCanonicalMRPEvidence(),
      })
      .mockResolvedValueOnce({
        _key: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        type: 'gate-2',
        passed: true,
      })
      .mockResolvedValueOnce(null)

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
          pullNumber: 71,
          canonicalEvidenceKey: 'MRP-EVIDENCE-MOTE4M1R-b44ae7d',
          fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
          createdAt: '2026-05-07T21:18:10Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      gate2ReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      canonical: {
        soundVerification: {
          fidelityVerificationReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
          gate2ReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        },
        auditability: {
          fidelityVerificationReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
          gate2ReportId: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        },
      },
    })
    expect(mockQueryOne.mock.calls[1]).toEqual([
      expect.stringContaining('specs_coverage_reports'),
      { key: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z' },
    ])
  })

  it('POST /debug/gate2-simulate returns a Fidelity Verification report and verdict', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/gate2-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeGate2SimulationInput()),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      report: {
        gate: 2,
        function_id: 'FN-MOTDWVR2-W7UN',
        overall: 'pass',
      },
      verdict: {
        verdict: 'accepted',
        scenario_coverage_score: 1,
        invariant_exercise_rate: 1,
      },
    })
  })

  it('POST /debug/gate2-simulate accepts normalized Gate2Input evidence', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/gate2-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gate2Input: makeGate2ContractInput(),
          prdId: 'PRD-META-FUNCTION-SYNTHESIS',
          sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      report: {
        id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        gate: 2,
        function_id: 'FN-MOTDWVR2-W7UN',
        overall: 'pass',
        source_refs: expect.arrayContaining([
          'FN-MOTDWVR2-W7UN',
          'PRD-META-FUNCTION-SYNTHESIS',
          'WG-META-FUNCTION-SYNTHESIS',
          'AC-META-ARCHITECTURE-CANDIDATE-EXECUTION',
          'MRP-MOTE4M1R-G7I0-71',
        ]),
      },
      verdict: {
        verdict: 'accepted',
        scenario_coverage_score: 1,
        invariant_exercise_rate: 1,
      },
    })
  })

  it('POST /debug/fidelity-verification accepts FidelityVerificationInput evidence', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/fidelity-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fidelityVerificationInput: makeGate2ContractInput(),
          prdId: 'PRD-META-FUNCTION-SYNTHESIS',
          sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      report: {
        id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        gate: 2,
        function_id: 'FN-MOTDWVR2-W7UN',
        overall: 'pass',
      },
      verdict: {
        verdict: 'accepted',
      },
    })
  })

  it('POST /debug/fidelity-verification can persist the emitted Fidelity Verification report', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/fidelity-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fidelityVerificationInput: makeGate2ContractInput(),
          prdId: 'PRD-META-FUNCTION-SYNTHESIS',
          sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
          persist: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      coverageReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      report: {
        overall: 'pass',
      },
    })
    expect(mockEnsureCollection).toHaveBeenCalledWith('specs_coverage_reports')
    expect(mockSave).toHaveBeenCalledWith(
      'specs_coverage_reports',
      expect.objectContaining({
        _key: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
        type: 'gate-2',
        passed: true,
        source_refs: expect.arrayContaining([
          'FN-MOTDWVR2-W7UN',
          'PRD-META-FUNCTION-SYNTHESIS',
          'WG-META-FUNCTION-SYNTHESIS',
        ]),
        report: expect.objectContaining({
          gate: 2,
          overall: 'pass',
        }),
        verdict: expect.objectContaining({
          verdict: 'accepted',
        }),
      }),
    )
  })

  it('POST /debug/gate2-simulate can dry-run Fidelity Verification lifecycle acceptance without mutation', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/gate2-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gate2Input: makeGate2ContractInput(),
          prdId: 'PRD-META-FUNCTION-SYNTHESIS',
          sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
          lifecycleDryRun: {
            currentState: 'produced',
          },
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      lifecycleDryRun: {
        from: 'produced',
        to: 'accepted',
        gate: 'gate-2',
        wouldTransition: true,
        mutationApplied: false,
        gateReport: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      },
    })
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('POST /debug/gate3-register persists a minimal Persistence Verification blocker report', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/gate3-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...makeGate3RegistrationInput(),
          persist: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      coverageReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE3-2026-05-07T22-00-00-000Z',
      report: {
        gate: 3,
        function_id: 'FN-MOTDWVR2-W7UN',
        overall: 'fail',
      },
    })
    expect(mockEnsureCollection).toHaveBeenCalledWith('specs_coverage_reports')
    expect(mockSave).toHaveBeenCalledWith(
      'specs_coverage_reports',
      expect.objectContaining({
        _key: 'CR-FN-MOTDWVR2-W7UN-GATE3-2026-05-07T22-00-00-000Z',
        type: 'gate-3',
        passed: false,
        report: expect.objectContaining({
          gate: 3,
          overall: 'fail',
        }),
      }),
    )
  })

  it('POST /debug/persistence-verification persists a minimal Persistence Verification blocker report', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/persistence-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...makeGate3RegistrationInput(),
          persist: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(201)
    expect(await jsonBody(response)).toMatchObject({
      persisted: true,
      persistenceVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE3-2026-05-07T22-00-00-000Z',
      report: {
        gate: 3,
        function_id: 'FN-MOTDWVR2-W7UN',
        overall: 'fail',
      },
    })
  })

  it('POST /debug/lifecycle-acceptance dry-runs produced to accepted from persisted Fidelity Verification evidence', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne.mockResolvedValueOnce(makeGate2CoverageReportRecord())
    mockGet.mockResolvedValueOnce({
      _key: 'FN-MOTDWVR2-W7UN',
      lifecycleState: 'produced',
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/lifecycle-acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionKey: 'FN-MOTDWVR2-W7UN',
          fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      applied: false,
      fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      gate2ReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      lifecycleDryRun: {
        from: 'produced',
        to: 'accepted',
        gate: 'gate-2',
        wouldTransition: true,
        mutationApplied: false,
      },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSaveEdge).not.toHaveBeenCalled()
  })

  it('POST /debug/lifecycle-acceptance can apply produced to accepted from persisted Fidelity Verification evidence', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne
      .mockResolvedValueOnce(makeGate2CoverageReportRecord())
      .mockResolvedValueOnce({ passed: true })
    mockGet
      .mockResolvedValueOnce({
        _key: 'FN-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      })
      .mockResolvedValueOnce({
        _key: 'FN-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/lifecycle-acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionKey: 'FN-MOTDWVR2-W7UN',
          fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
          apply: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      applied: true,
      functionKey: 'FN-MOTDWVR2-W7UN',
      to: 'accepted',
      fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      gate2ReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
    })
    expect(mockUpdate).toHaveBeenCalledWith(
      'specs_functions',
      'FN-MOTDWVR2-W7UN',
      expect.objectContaining({ lifecycleState: 'accepted' }),
    )
    expect(mockSaveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      'specs_functions/FN-MOTDWVR2-W7UN',
      'specs_functions/FN-MOTDWVR2-W7UN',
      expect.objectContaining({
        from: 'produced',
        to: 'accepted',
        gateReport: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      }),
    )
  })

  it('POST /debug/lifecycle-acceptance can repair a missing produced to accepted transition edge', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne.mockResolvedValueOnce(makeGate2CoverageReportRecord())
    mockGet.mockResolvedValueOnce({
      _key: 'FN-MOTDWVR2-W7UN',
      lifecycleState: 'accepted',
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/lifecycle-acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionKey: 'FN-MOTDWVR2-W7UN',
          fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
          repairAcceptedTransitionEdge: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      applied: true,
      repaired: true,
      functionKey: 'FN-MOTDWVR2-W7UN',
      from: 'produced',
      to: 'accepted',
      fidelityVerificationReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      gate2ReportKey: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      transition: {
        from: 'produced',
        to: 'accepted',
        gateReport: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
        responsible_context: 'ff-pipeline:debug-lifecycle-acceptance-repair',
      },
    })
    expect(mockEnsureCollection).toHaveBeenCalledWith('lifecycle_transitions')
    expect(mockSaveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      'specs_functions/FN-MOTDWVR2-W7UN',
      'specs_functions/FN-MOTDWVR2-W7UN',
      expect.objectContaining({
        from: 'produced',
        to: 'accepted',
        gateReport: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      }),
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('POST /debug/function-identity reports FP lifecycle and FN materialization without mutation', async () => {
    const { default: worker } = await import('./index')
    mockGet
      .mockResolvedValueOnce({
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      })
      .mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({
      id: 'MRP-MOTE4M1R-G7I0-71',
      proposalId: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      verdict: 'merge-ready',
      prEvidence: {
        signalId: 'SIG-MOW36LRI-I3NG',
        headSha: '99d78b7c609c3c3a2005e5ef10c68521f2cf69b6',
      },
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/function-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalKey: 'FP-MOTDWVR2-W7UN',
          functionId: 'FN-MOTDWVR2-W7UN',
          mergeReadinessPackId: 'MRP-MOTE4M1R-G7I0-71',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      proposalKey: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      derivedFunctionId: 'FN-MOTDWVR2-W7UN',
      identityConsistent: true,
      resolution: 'mapped_not_migrated',
      mutationApplied: false,
      runtime: {
        proposalDocumentFound: true,
        proposalLifecycleState: 'produced',
        functionDocumentFound: false,
      },
      mergeReadiness: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        proposalId: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
        consistent: true,
      },
      migrationPlan: {
        required: true,
        safeToApply: true,
        operations: [
          {
            action: 'create_function_document',
            targetKey: 'FN-MOTDWVR2-W7UN',
            sourceKey: 'FP-MOTDWVR2-W7UN',
            fields: {
              _key: 'FN-MOTDWVR2-W7UN',
              proposal_ref: 'FP-MOTDWVR2-W7UN',
              functionId: 'FN-MOTDWVR2-W7UN',
              lifecycleState: 'produced',
            },
          },
          {
            action: 'preserve_proposal_document',
            targetKey: 'FP-MOTDWVR2-W7UN',
          },
          {
            action: 'block_monitored_promotion',
            targetKey: 'FN-MOTDWVR2-W7UN',
          },
        ],
      },
    })
    expect(mockGet).toHaveBeenCalledWith('specs_functions', 'FP-MOTDWVR2-W7UN')
    expect(mockGet).toHaveBeenCalledWith('specs_functions', 'FN-MOTDWVR2-W7UN')
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('merge_readiness_packs'),
      { id: 'MRP-MOTE4M1R-G7I0-71' },
    )
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSaveEdge).not.toHaveBeenCalled()
  })

  it('POST /debug/function-identity-migration dry-runs the materialization plan without mutation', async () => {
    const { default: worker } = await import('./index')
    mockGet
      .mockResolvedValueOnce({
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      })
      .mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({
      id: 'MRP-MOTE4M1R-G7I0-71',
      proposalId: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      verdict: 'merge-ready',
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/function-identity-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalKey: 'FP-MOTDWVR2-W7UN',
          functionId: 'FN-MOTDWVR2-W7UN',
          mergeReadinessPackId: 'MRP-MOTE4M1R-G7I0-71',
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      applied: false,
      report: {
        proposalKey: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
        identityConsistent: true,
        resolution: 'mapped_not_migrated',
        mutationApplied: false,
        migrationPlan: {
          required: true,
          safeToApply: true,
          operations: [
            {
              action: 'create_function_document',
              targetKey: 'FN-MOTDWVR2-W7UN',
              sourceKey: 'FP-MOTDWVR2-W7UN',
            },
            {
              action: 'preserve_proposal_document',
              targetKey: 'FP-MOTDWVR2-W7UN',
            },
            {
              action: 'block_monitored_promotion',
              targetKey: 'FN-MOTDWVR2-W7UN',
            },
          ],
        },
      },
    })
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSaveEdge).not.toHaveBeenCalled()
  })

  it('POST /debug/function-identity-migration applies only the FN materialization and lineage edge when requested', async () => {
    const { default: worker } = await import('./index')
    mockGet
      .mockResolvedValueOnce({
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      })
      .mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({
      id: 'MRP-MOTE4M1R-G7I0-71',
      proposalId: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      verdict: 'merge-ready',
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/function-identity-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalKey: 'FP-MOTDWVR2-W7UN',
          functionId: 'FN-MOTDWVR2-W7UN',
          mergeReadinessPackId: 'MRP-MOTE4M1R-G7I0-71',
          apply: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      applied: true,
      functionRecord: {
        _key: 'FN-MOTDWVR2-W7UN',
        id: 'FN-MOTDWVR2-W7UN',
        proposal_ref: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
        lifecycleStateSource: 'FP-MOTDWVR2-W7UN',
        source_refs: ['FP-MOTDWVR2-W7UN'],
        materializedFrom: 'FP-MOTDWVR2-W7UN',
        migrationAppliedBy: 'ff-pipeline:debug-function-identity-migration',
      },
      lineageEdge: {
        type: 'materialized-from',
        operation: 'create_function_document',
        responsible_context: 'ff-pipeline:debug-function-identity-migration',
      },
    })
    expect(mockEnsureCollection).toHaveBeenCalledWith('specs_functions')
    expect(mockSave).toHaveBeenCalledWith(
      'specs_functions',
      expect.objectContaining({
        _key: 'FN-MOTDWVR2-W7UN',
        id: 'FN-MOTDWVR2-W7UN',
        proposal_ref: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
        source_refs: ['FP-MOTDWVR2-W7UN'],
      }),
    )
    expect(mockSaveEdge).toHaveBeenCalledWith(
      'lineage_edges',
      'specs_functions/FN-MOTDWVR2-W7UN',
      'specs_functions/FP-MOTDWVR2-W7UN',
      expect.objectContaining({
        type: 'materialized-from',
        operation: 'create_function_document',
      }),
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('POST /debug/function-identity-migration fails closed for inconsistent identity evidence', async () => {
    const { default: worker } = await import('./index')
    mockGet
      .mockResolvedValueOnce({
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      })
      .mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({
      id: 'MRP-MOTE4M1R-G7I0-71',
      proposalId: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-DIFFERENT',
      verdict: 'merge-ready',
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/function-identity-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalKey: 'FP-MOTDWVR2-W7UN',
          functionId: 'FN-MOTDWVR2-W7UN',
          mergeReadinessPackId: 'MRP-MOTE4M1R-G7I0-71',
          apply: true,
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(400)
    expect(await jsonBody(response)).toMatchObject({
      error: 'Function identity migration is not safe to apply',
      applied: false,
      report: {
        identityConsistent: false,
        resolution: 'inconsistent',
        migrationPlan: {
          safeToApply: false,
        },
      },
    })
    expect(mockSave).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSaveEdge).not.toHaveBeenCalled()
  })

  it('POST /debug/mrp fails closed when PR outcome evidence is missing', async () => {
    const { default: worker } = await import('./index')

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audit: makeMaterializationAudit(),
        }),
      }),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(400)
    expect(await jsonBody(response)).toMatchObject({
      error: 'Missing required field: prOutcomeSignal or prOutcomeSignalKey',
    })
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('GET /debug/mrp returns a persisted merge-readiness pack by id', async () => {
    const { default: worker } = await import('./index')
    mockQueryOne.mockResolvedValueOnce({
      _key: 'MRP-MOTE4M1R-G7I0-71',
      id: 'MRP-MOTE4M1R-G7I0-71',
      readinessVerdict: 'ready',
      verdict: 'merge-ready',
    })

    const response = await worker.fetch(
      new Request('https://ff-pipeline.example.com/debug/mrp?id=MRP-MOTE4M1R-G7I0-71'),
      createEnv() as never,
      { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never,
    )

    expect(response.status).toBe(200)
    expect(await jsonBody(response)).toMatchObject({
      found: true,
      pack: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        verdict: 'merge-ready',
      },
    })
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('merge_readiness_packs'),
      { id: 'MRP-MOTE4M1R-G7I0-71' },
    )
  })
})

function makeMaterializationAudit(): Record<string, unknown> {
  return {
    type: 'synthesis_artifact_materialization',
    timestamp: '2026-05-06T02:59:30Z',
    pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
    runtimeStatus: 'synthesis-passed',
    signalId: 'SIG-MOTDWPYM-LTW5',
    pressureId: 'PRS-MOTDWQ0T-S55Y',
    capabilityId: 'BC-MOTDWSVY-PQOO',
    proposalId: 'FP-MOTDWVR2-W7UN',
    workGraphId: 'WG-MOTE4M1R-G7I0',
    coherenceVerificationPassed: true,
    atomResults: [
      { atomId: 'atom-001', decision: 'pass', confidence: 0.95, tests: '14/14' },
    ],
    materializedFiles: [
      {
        atomId: 'atom-001',
        path: 'workers/ff-pipeline/src/runtime-verification.ts',
        action: 'create',
        sha256: '16ae4de2b48f6956246c2c6876151ee5690fbccde493e70ebe38bae4042d9b43',
      },
    ],
    localVerification: [
      'pnpm --filter @factory/ff-pipeline typecheck passed',
      'pnpm --filter @factory/ff-pipeline test passed 65 files / 964 tests',
    ],
    notes: 'Dogfood MRP route test.',
  }
}

function makePROutcomeSignal(): Record<string, unknown> {
  return {
    _key: 'SIG-MOTILTZ0-6DGK',
    signalType: 'internal',
    source: 'factory:pr-outcome',
    subtype: 'synthesis:pr-ci-passed',
    sourceRefs: [
      'SIG:SIG-MOTDWPYM-LTW5',
      'PRS:PRS-MOTDWQ0T-S55Y',
      'BC:BC-MOTDWSVY-PQOO',
      'FN:FP-MOTDWVR2-W7UN',
      'WG:WG-MOTE4M1R-G7I0',
    ],
    createdAt: '2026-05-06T03:09:14Z',
    raw: {
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      proposalId: 'FP-MOTDWVR2-W7UN',
      workGraphId: 'WG-MOTE4M1R-G7I0',
      pr: {
        number: 71,
        url: 'https://github.com/Wescome/function-factory/pull/71',
        title: '[Factory] Materialize WG-MOTE4M1R-G7I0 synthesis artifact',
        state: 'OPEN',
        draft: true,
        merged: false,
        headRefName: 'factory/fp-motdwvr2-w7un',
        baseRefName: 'main',
        headSha: 'f4fc4d6ed7613161e1d117335f3ce5f0f0c84a9d',
      },
      outcome: {
        prState: 'draft',
        ciState: 'passed',
        reviewState: 'none',
      },
      checks: {
        passed: ['Factory PR Gate', 'Typecheck', 'Test'],
        failed: [],
        pending: [],
      },
      observedAt: '2026-05-06T21:07:12Z',
    },
  }
}

function makeCanonicalMRPEvidence(): Record<string, unknown> {
  return {
    functionalCompleteness: {
      acceptanceCriteria: [
        {
          criterion: 'Runtime verification artifact is materialized with tests',
          met: true,
          evidence: 'workers/ff-pipeline/src/runtime-verification.test.ts',
        },
      ],
    },
    soundVerification: {
      testPlan: 'Runtime verification test harness plus ff-pipeline suite',
      newTestCases: [
        {
          name: 'records a validated synthesis smoke result',
          type: 'unit',
          result: 'pass',
        },
      ],
      gate2ReportId: 'CR-MOTE4M1R-GATE2',
    },
    seHygiene: {
      mentorRuleCompliance: [
        {
          ruleId: 'MR-STRICT-TYPESCRIPT',
          rule: 'Use strict TypeScript and colocated tests',
          compliant: true,
          evidence: 'pnpm --filter @factory/ff-pipeline typecheck passed',
        },
      ],
    },
    rationale: {
      approach: 'Materialize the runtime verification artifact generated by synthesis',
      tradeoffsConsidered: 'Kept runtime MRP persistence separate from canonical adapter validation',
      prDescription: 'Factory dogfood materialization for WG-MOTE4M1R-G7I0',
    },
    auditability: {
      prdId: 'PRD-MOTE4M1R-G7I0',
      semanticReviewId: 'SRR-MOTE4M1R-G7I0',
      coherenceVerificationReportId: 'CR-MOTE4M1R-GATE1',
      gate2ReportId: 'CR-MOTE4M1R-GATE2',
      modelBindings: {
        planner: { provider: 'factory-runtime', model: 'observed' },
      },
      totalTokenUsage: 0,
      totalCost: 0,
      executionDurationMs: 1,
    },
  }
}

function makeGate2SimulationInput(): Record<string, unknown> {
  return {
    functionId: 'FN-MOTDWVR2-W7UN',
    prdId: 'PRD-META-FUNCTION-SYNTHESIS',
    workGraphId: 'WG-META-FUNCTION-SYNTHESIS',
    candidateId: 'AC-META-ARCHITECTURE-CANDIDATE-EXECUTION',
    timestamp: '2026-05-07T21:30:00.000Z',
    sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
    branches: [
      { workgraphNode: 'atom-001', edge: 'success' },
    ],
    invariants: [
      {
        id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
        workgraphNode: 'atom-001',
      },
    ],
    scenarios: [
      {
        id: 'SCN-RUNTIME-VERIFICATION-PASS',
        kind: 'positive',
        passed: true,
        coversBranches: [{ workgraphNode: 'atom-001', edge: 'success' }],
        coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
      },
      {
        id: 'SCN-RUNTIME-VERIFICATION-NEGATIVE',
        kind: 'negative',
        passed: true,
        coversBranches: [],
        coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
      },
    ],
    validationOutcomes: [
      {
        id: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
        priority: 'required',
        status: 'pass',
        invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
      },
    ],
  }
}

function makeGate2ContractInput(): Record<string, unknown> {
  return {
    synthesisRunId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
    functionId: 'FN-MOTDWVR2-W7UN',
    workGraphId: 'WG-META-FUNCTION-SYNTHESIS',
    architectureCandidateId: 'AC-META-ARCHITECTURE-CANDIDATE-EXECUTION',
    artifactPaths: ['workers/ff-pipeline/src/runtime-verification.ts'],
    validationOutcomes: [
      {
        validationId: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
        passed: true,
        summary: 'Runtime verification smoke scenario passed',
        details: {
          priority: 'required',
          invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
          branches: [
            { workgraphNode: 'atom-001', edge: 'success' },
          ],
          invariants: [
            {
              id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
              workgraphNode: 'atom-001',
            },
          ],
          scenarios: [
            {
              id: 'SCN-RUNTIME-VERIFICATION-PASS',
              kind: 'positive',
              passed: true,
              coversBranches: [{ workgraphNode: 'atom-001', edge: 'success' }],
              coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
            },
            {
              id: 'SCN-RUNTIME-VERIFICATION-NEGATIVE',
              kind: 'negative',
              passed: true,
              coversBranches: [],
              coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
            },
          ],
        },
      },
    ],
    compileSummary: 'pass',
    testSummary: 'pass',
    scopeViolation: false,
    constraintViolation: false,
    repairLoopCount: 0,
    resampleSummary: 'none',
    provenance: {
      bindingModeName: 'factory-runtime',
      promptPackVersion: 'observed',
      toolPolicyHash: 'observed',
      modelBindingHash: 'observed',
      startedAt: '2026-05-07T21:33:00.000Z',
      completedAt: '2026-05-07T21:33:20.000Z',
    },
  }
}

function makeGate3RegistrationInput(): Record<string, unknown> {
  return {
    functionId: 'FN-MOTDWVR2-W7UN',
    timestamp: '2026-05-07T22:00:00.000Z',
    sourceRefs: [
      'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      'MRP-MOTE4M1R-G7I0-71',
    ],
    detectors: [
      {
        invariantId: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
        detector: 'runtime-verification-smoke',
        lastReport: null,
        threshold: 'PT5M',
        stale: true,
      },
    ],
    evidenceSources: [
      {
        source: 'factory:runtime-verification',
        lastEmission: null,
        expectedCadence: 'on every monitored execution',
        quiet: true,
      },
    ],
    auditPipeline: {
      expected: 1,
      observed: 0,
    },
  }
}

function makeGate2CoverageReportRecord(): Record<string, unknown> {
  return {
    _key: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
    id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
    type: 'gate-2',
    passed: true,
    report: {
      id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      gate: 2,
      function_id: 'FN-MOTDWVR2-W7UN',
      timestamp: '2026-05-07T22:34:30.000Z',
      overall: 'pass',
    },
    verdict: {
      verdict: 'accepted',
      evidence_reviewed: [
        'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T22-34-30-000Z',
      ],
      scenario_coverage_score: 1,
      invariant_exercise_rate: 1,
      remediation_notes: [],
    },
  }
}
