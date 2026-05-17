/**
 * harness-bridge.ts — unit tests for startHarnessRun.
 *
 * Verifies the six-step call sequence:
 *   1. Load YAML from R2
 *   2. Parse + compile via NLAH
 *   3. Completeness verification (Factory governance gate)
 *   4. initHarness (pure)
 *   5. POST /init to RunCoordinator DO
 *   6. Return { runId }
 *
 * CF bindings (WORKSPACE_BUCKET, RUN_COORDINATOR) are mocked with plain
 * objects. NLAH functions are mocked so tests don't require a compiled
 * harness YAML on disk.
 *
 * ADR-009 §8 gate 4: harness-path integration test coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @factory/nlah ────────────────────────────────────────────────────────
const mockLoadHarness = vi.fn()
const mockCompileHarness = vi.fn()
const mockInitHarness = vi.fn()

vi.mock('@factory/nlah', () => ({
  loadHarness: (...args: unknown[]) => mockLoadHarness(...args),
  compileHarness: (...args: unknown[]) => mockCompileHarness(...args),
  initHarness: (...args: unknown[]) => mockInitHarness(...args),
  gateRegistry: {},
}))

// ── Mock @factory/verification ────────────────────────────────────────────────
const mockRunVerification = vi.fn()

vi.mock('@factory/verification', () => ({
  runHarnessCompletenessVerification: (...args: unknown[]) => mockRunVerification(...args),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompiledHarness() {
  return {
    spec: { harness: { name: 'SYNTHESIS' }, stages: {}, runtime: {} },
    stageOrder: ['PLAN'],
    artifactPaths: {},
  }
}

function makeHarnessState() {
  return {
    runId: 'run-bridge-001',
    currentStage: 'PLAN',
    status: 'running',
    completedStages: [],
    stageAttempts: {},
    totalAttempts: 0,
  }
}

function makeR2Object(yaml: string) {
  return { text: async () => yaml }
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  const doFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, runId: 'run-bridge-001', firstStage: 'PLAN' }), { status: 200 }))
  const stub = { fetch: doFetch }
  const doNamespace = {
    idFromName: vi.fn(() => ({ toString: () => 'do-id' })),
    get: vi.fn(() => stub),
  }
  return {
    WORKSPACE_BUCKET: { get: vi.fn(async () => makeR2Object('nlahspec: "0.2"')) } as unknown as R2Bucket,
    RUN_COORDINATOR: doNamespace as unknown as DurableObjectNamespace,
    HARNESS_QUEUE: { send: vi.fn(async () => {}) },
    FACTORY_PIPELINE: { get: vi.fn(), create: vi.fn() },
    _doFetch: doFetch,
    ...overrides,
  }
}

function makeJob() {
  return {
    functionRunId: 'run-bridge-001',
    objective: 'Build the feature',
    harnessKey: 'harnesses/synthesis.harness.yaml',
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startHarnessRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadHarness.mockResolvedValue({ harness: { name: 'SYNTHESIS' } })
    mockCompileHarness.mockReturnValue(makeCompiledHarness())
    mockInitHarness.mockReturnValue(makeHarnessState())
    mockRunVerification.mockResolvedValue({ overall: 'pass', details: [], failure_code: undefined })
  })

  it('throws when R2 returns null (harness YAML missing)', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const env = makeEnv({
      WORKSPACE_BUCKET: { get: vi.fn(async () => null) } as unknown as R2Bucket,
    })

    await expect(
      startHarnessRun('harnesses/missing.yaml', env as never, makeJob()),
    ).rejects.toThrow('Harness YAML not found in R2')
  })

  it('throws when completeness verification fails', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const env = makeEnv()
    mockRunVerification.mockResolvedValue({
      overall: 'fail',
      details: ['MISSING_WORKER_BINDING: pi not registered'],
      failure_code: 'MISSING_WORKER_BINDING',
    })

    await expect(
      startHarnessRun('harnesses/synthesis.harness.yaml', env as never, makeJob()),
    ).rejects.toThrow('Harness completeness check failed: MISSING_WORKER_BINDING')
  })

  it('calls WORKSPACE_BUCKET.get with the harness key', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const env = makeEnv()
    await startHarnessRun('harnesses/synthesis.harness.yaml', env as never, makeJob())

    expect((env.WORKSPACE_BUCKET.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'harnesses/synthesis.harness.yaml',
    )
  })

  it('POSTs /init to the RunCoordinator DO with compiled, initialState, workflowId, taskText', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const env = makeEnv()
    const job = makeJob()

    await startHarnessRun('harnesses/synthesis.harness.yaml', env as never, job)

    // DO stub was fetched at the /init path
    expect(env._doFetch).toHaveBeenCalledOnce()
    // stub.fetch is called as (urlString, init) — not a Request object
    const [initUrl, initOpts] = env._doFetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(initUrl).pathname).toBe('/init')
    expect(initOpts.method).toBe('POST')

    const payload = JSON.parse(initOpts.body as string) as Record<string, unknown>
    expect(payload.compiled).toEqual(makeCompiledHarness())
    expect(payload.initialState).toEqual(makeHarnessState())
    expect(payload.workflowId).toBe('run-bridge-001') // defaults to functionRunId
    expect(payload.taskText).toBe(job.objective)
  })

  it('uses workflowInstanceId when provided', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const env = makeEnv()
    const job = { ...makeJob(), workflowInstanceId: 'wf-external-99' }

    await startHarnessRun('harnesses/synthesis.harness.yaml', env as never, job)

    const [, initOpts] = env._doFetch.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(initOpts.body as string) as Record<string, unknown>
    expect(payload.workflowId).toBe('wf-external-99')
  })

  it('returns { runId } on success', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const env = makeEnv()

    const result = await startHarnessRun('harnesses/synthesis.harness.yaml', env as never, makeJob())
    expect(result).toEqual({ runId: 'run-bridge-001' })
  })

  it('throws when DO /init returns non-2xx', async () => {
    const { startHarnessRun } = await import('./harness-bridge.js')
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }))
    const stub = { fetch: doFetch }
    const env = makeEnv({
      RUN_COORDINATOR: {
        idFromName: vi.fn(() => ({ toString: () => 'do-id' })),
        get: vi.fn(() => stub),
      } as unknown as DurableObjectNamespace,
    })

    await expect(
      startHarnessRun('harnesses/synthesis.harness.yaml', env as never, makeJob()),
    ).rejects.toThrow('RunCoordinator /init failed (409)')
  })
})
