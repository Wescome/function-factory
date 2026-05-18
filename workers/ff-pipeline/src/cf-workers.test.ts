/**
 * cf-workers.ts — unit tests for PiContainerAdapter (and siblings).
 *
 * Covers the artifacts-in-response contract: Container returns artifact
 * contents in the response body; the adapter calls artifacts.writeText()
 * for each entry. No r2Bucket in the request body.
 *
 * ADR-009 §8 / IS-HARNESS-DSL-v1 §5.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @factory/nlah ────────────────────────────────────────────────────────
vi.mock('@factory/nlah', () => ({
  WorkerRegistry: class {
    private map = new Map<string, unknown>()
    register(name: string, adapter: unknown) { this.map.set(name, adapter) }
    get(name: string) {
      const a = this.map.get(name)
      if (!a) throw new Error(`unknown worker: ${name}`)
      return a
    }
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeArtifacts(overrides: Record<string, unknown> = {}) {
  const prefix = 'runs/run-001/artifacts/'
  return {
    getStorageHandle: vi.fn(() => ({
      kind: 'r2',
      prefix,
      bucketBinding: 'WORKSPACE_BUCKET',
    })),
    writeText: vi.fn(async (name: string, _content: string) => `${prefix}${name}`),
    readText: vi.fn(async () => ''),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => []),
    status: vi.fn(async () => ({ name: '', path: '', exists: false })),
    validateContract: vi.fn(async () => ({ passed: true })),
    resolve: vi.fn((n: string) => n),
    ...overrides,
  }
}

function makeContainer(resp: Response) {
  return { fetch: vi.fn(async (_req: Request) => resp) }
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    stageName: 'CONTRACT',
    roleName: 'Cartographer',
    context: { taskText: 'Resolve issue #42' },
    declaredInputs: [] as string[],
    declaredOutputs: ['IssueContract'] as string[],
    state: {},
    ...overrides,
  }
}

function makeOkResponse(
  artifacts: string[],
  artifactContents: Record<string, string>,
  message?: string,
  observation?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ artifacts, artifactContents, ...(message ? { message } : {}), ...(observation ? { observation } : {}) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PiContainerAdapter', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('POSTs to /execute with stage fields — no r2Bucket in body', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      makeOkResponse(['IssueContract'], { IssueContract: '# Contract' }),
    )
    const adapter = new PiContainerAdapter(container as never)

    await adapter.execute(makeInput({ runId: 'run-42' }) as never, makeArtifacts() as never)

    const req = container.fetch.mock.calls[0]?.[0]
    if (!(req instanceof Request)) throw new Error('expected Container fetch Request')
    expect(req.method).toBe('POST')
    expect(new URL(req.url).protocol).toBe('http:')
    expect(new URL(req.url).pathname).toBe('/execute')

    const payload = await req.clone().json() as Record<string, unknown>
    expect(payload.runId).toBe('run-42')
    expect(payload.stageName).toBe('CONTRACT')
    expect(payload.roleName).toBe('Cartographer')
    expect(payload.context).toEqual({ taskText: 'Resolve issue #42' })
    expect(payload.declaredOutputs).toEqual(['IssueContract'])
    expect(payload).not.toHaveProperty('r2Bucket')
    expect(payload).not.toHaveProperty('artifactPrefix')
  })

  it('includes per-dispatch model route when provided and never includes secrets', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      makeOkResponse(['IssueContract'], { IssueContract: '# Contract' }),
    )
    const adapter = new PiContainerAdapter(container as never)

    await adapter.execute(
      makeInput({
        model: {
          id: 'anthropic/claude-sonnet-4.5',
          provider: 'anthropic',
          model: 'claude-sonnet-4.5',
          routeKind: 'planner',
          resolvedVia: 'config-default',
        },
        execution: {
          surface: 'rpc',
          requiredCapabilities: ['filesystem_tools'],
          resolvedVia: 'stage-contract',
        },
      }) as never,
      makeArtifacts() as never,
    )

    const req = container.fetch.mock.calls[0]?.[0]
    if (!(req instanceof Request)) throw new Error('expected Container fetch Request')
    const payload = await req.clone().json() as Record<string, unknown>
    expect(payload.model).toMatchObject({
      id: 'anthropic/claude-sonnet-4.5',
      routeKind: 'planner',
    })
    expect(payload.execution).toMatchObject({
      surface: 'rpc',
      requiredCapabilities: ['filesystem_tools'],
      resolvedVia: 'stage-contract',
    })
    expect(JSON.stringify(payload)).not.toContain('OFOX_API_KEY')
    expect(JSON.stringify(payload)).not.toContain('OPENROUTER_API_KEY')
  })

  it('calls artifacts.writeText for every entry in artifactContents', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      makeOkResponse(
        ['IssueContract', 'RepoMap'],
        { IssueContract: '# Contract\ncontent', RepoMap: '# Repo Map\ncontent' },
      ),
    )
    const artifacts = makeArtifacts()
    const adapter = new PiContainerAdapter(container as never)

    const result = await adapter.execute(
      makeInput({ declaredOutputs: ['IssueContract', 'RepoMap'] }) as never,
      artifacts as never,
    )

    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('IssueContract', '# Contract\ncontent')
    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('RepoMap', '# Repo Map\ncontent')
    expect(result.createdArtifacts).toEqual(['IssueContract', 'RepoMap'])
  })

  it('persists container observation as a synthetic artifact', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const observation = {
      stageName: 'CONTRACT',
      model: { id: 'anthropic/claude-sonnet-4.5' },
      stderrTail: 'safe stderr',
    }
    const container = makeContainer(
      makeOkResponse(['IssueContract'], { IssueContract: '# Contract' }, 'CONTRACT complete', observation),
    )
    const artifacts = makeArtifacts()
    const adapter = new PiContainerAdapter(container as never)

    const result = await adapter.execute(makeInput() as never, artifacts as never)

    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '__observability/CONTRACT.container-observation.json',
      JSON.stringify(observation, null, 2),
    )
    expect(result.message).toContain('observation=runs/run-001/artifacts/__observability/CONTRACT.container-observation.json')
  })

  it('persists non-2xx observation and throws compact error reference', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const artifacts = makeArtifacts()
    const container = makeContainer(
      new Response(
        JSON.stringify({
          error: { code: 'UNSUPPORTED_MODEL', message: 'unsupported pi model' },
          observation: { stageName: 'CONTRACT', stderrTail: 'redacted tail' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const adapter = new PiContainerAdapter(container as never)

    await expect(
      adapter.execute(makeInput() as never, artifacts as never),
    ).rejects.toThrow('runs/run-001/artifacts/__observability/CONTRACT.container-observation.json')

    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '__observability/CONTRACT.container-observation.json',
      expect.stringContaining('redacted tail'),
    )
  })

  it('persists contract evaluation diagnostics on non-2xx responses', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const artifacts = makeArtifacts()
    const observation = {
      runId: 'run-001',
      stageName: 'CONTRACT',
      contractEvaluation: {
        finalAttempt: 'repair-2',
        repairsUsed: 2,
        maxRepairRounds: 2,
        findings: [{ artifact: 'Report', status: 'fail', kind: 'json', failureCode: 'invalid_json' }],
        failedArtifacts: ['Report'],
      },
    }
    const container = makeContainer(
      new Response(
        JSON.stringify({
          error: { code: 'PI_EXECUTION_FAILED', message: 'contract failed' },
          observation,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const adapter = new PiContainerAdapter(container as never)

    await expect(
      adapter.execute(makeInput() as never, artifacts as never),
    ).rejects.toThrow('runs/run-001/artifacts/__observability/CONTRACT.contract-evaluation.json')

    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '__observability/CONTRACT.contract-evaluation.json',
      expect.stringContaining('"outcome": "fail"'),
    )
  })

  it('returns optional message from Container response', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      makeOkResponse(['IssueContract'], { IssueContract: 'x' }, 'CONTRACT complete'),
    )
    const adapter = new PiContainerAdapter(container as never)

    const result = await adapter.execute(makeInput() as never, makeArtifacts() as never)
    expect(result.message).toBe('CONTRACT complete')
  })

  it('includes rolePrompt in body when provided', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      makeOkResponse(['IssueContract'], { IssueContract: 'x' }),
    )
    const adapter = new PiContainerAdapter(container as never)

    await adapter.execute(
      makeInput({ rolePrompt: 'You are an expert mapper.' }) as never,
      makeArtifacts() as never,
    )

    const req = container.fetch.mock.calls[0]?.[0]
    if (!(req instanceof Request)) throw new Error('expected Container fetch Request')
    const payload = await req.clone().json() as Record<string, unknown>
    expect(payload.rolePrompt).toBe('You are an expert mapper.')
  })

  it('throws on non-2xx Container response with status in message', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(new Response('gateway error', { status: 502 }))
    const adapter = new PiContainerAdapter(container as never)

    await expect(
      adapter.execute(makeInput() as never, makeArtifacts() as never),
    ).rejects.toThrow('502')
  })

  it('throws when response body missing artifacts array', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      new Response(JSON.stringify({ message: 'done' }), { status: 200 }),
    )
    const adapter = new PiContainerAdapter(container as never)

    await expect(
      adapter.execute(makeInput() as never, makeArtifacts() as never),
    ).rejects.toThrow('artifacts')
  })

  it('does not call writeText when artifactContents is empty', async () => {
    const { PiContainerAdapter } = await import('./cf-workers.js')
    const container = makeContainer(
      makeOkResponse([], {}),
    )
    const artifacts = makeArtifacts()
    const adapter = new PiContainerAdapter(container as never)

    const result = await adapter.execute(makeInput() as never, artifacts as never)

    expect((artifacts.writeText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    expect(result.createdArtifacts).toEqual([])
  })
})

describe('buildCfWorkerRegistry', () => {
  it('registers preseed without a container binding', async () => {
    const { buildCfWorkerRegistry } = await import('./cf-workers.js')
    const env = {
      WORKSPACE_BUCKET: {},
      HARNESS_QUEUE: { send: vi.fn() },
      FACTORY_PIPELINE: { get: vi.fn(), create: vi.fn() },
    }

    const registry = buildCfWorkerRegistry(env as never)
    const adapter = registry.get('preseed')
    expect(adapter).toBeDefined()
    expect((adapter as unknown as { name: string }).name).toBe('preseed')
  })

  it('registers pi when PI_CONTAINER binding is present', async () => {
    const { buildCfWorkerRegistry } = await import('./cf-workers.js')
    const env = {
      // PI_CONTAINER is a DurableObjectNamespace in wrangler 4 (DO-backed containers)
      PI_CONTAINER: { idFromName: vi.fn(() => 'pi-id'), get: vi.fn(() => ({ fetch: vi.fn() })) },
      WORKSPACE_BUCKET: {},
      HARNESS_QUEUE: { send: vi.fn() },
      FACTORY_PIPELINE: { get: vi.fn(), create: vi.fn() },
    }

    const registry = buildCfWorkerRegistry(env as never)
    const adapter = registry.get('pi')
    expect(adapter).toBeDefined()
    expect((adapter as unknown as { name: string }).name).toBe('pi')
  })

  it('throws unknown worker when PI_CONTAINER not bound', async () => {
    const { buildCfWorkerRegistry } = await import('./cf-workers.js')
    const env = {
      WORKSPACE_BUCKET: {},
      HARNESS_QUEUE: { send: vi.fn() },
      FACTORY_PIPELINE: { get: vi.fn(), create: vi.fn() },
    }

    const registry = buildCfWorkerRegistry(env as never)
    expect(() => registry.get('pi')).toThrow('unknown worker: pi')
  })
})

describe('PreseedArtifactAdapter', () => {
  it('returns declared outputs that already exist in artifacts', async () => {
    const { PreseedArtifactAdapter } = await import('./cf-workers.js')
    const artifacts = makeArtifacts({
      status: vi.fn(async (name: string) => ({ name, path: name, exists: true, sizeBytes: 12 })),
    })
    const adapter = new PreseedArtifactAdapter()

    const result = await adapter.execute(
      makeInput({ declaredOutputs: ['SeedWorkspace'] }) as never,
      artifacts as never,
    )

    expect(result.createdArtifacts).toEqual(['SeedWorkspace'])
  })

  it('throws when a declared preseed output is missing', async () => {
    const { PreseedArtifactAdapter } = await import('./cf-workers.js')
    const adapter = new PreseedArtifactAdapter()

    await expect(adapter.execute(
      makeInput({ declaredOutputs: ['SeedWorkspace'] }) as never,
      makeArtifacts() as never,
    )).rejects.toThrow('preseed artifact missing or empty')
  })
})
