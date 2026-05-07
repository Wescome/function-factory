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
const mockQueryOne = vi.fn(async (): Promise<Record<string, unknown> | null> => null)
const mockSave = vi.fn(async (_collection: string, doc: Record<string, unknown>) => doc)

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => ({
    ping: mockPing,
    query: mockQuery,
    queryOne: mockQueryOne,
    save: mockSave,
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
    mockQueryOne.mockReset()
    mockQueryOne.mockResolvedValue(null)
    mockSave.mockReset()
    mockSave.mockImplementation(async (_collection: string, doc: Record<string, unknown>) => doc)
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
    })
    expect(mockQueryOne.mock.calls[0]).toEqual([
      expect.stringContaining('specs_signals'),
      { key: 'SIG-MOTILTZ0-6DGK' },
    ])
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('POST /debug/mrp can return canonical MRP with Stage 8 derived functionId', async () => {
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
      error: expect.stringContaining('evidence.functionId must match the Stage 8 functionId'),
    })
    expect(mockSave).not.toHaveBeenCalled()
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
    gate1Passed: true,
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
      gate1ReportId: 'CR-MOTE4M1R-GATE1',
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
