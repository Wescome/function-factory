/**
 * harness-dispatcher.ts — unit tests for dispatchOne.
 *
 * dispatchOne is the exported pure function that drives one
 * HarnessQueueMessage end-to-end. Tests use mock HarnessDispatcherDeps
 * and mock DO stub — no CF runtime required.
 *
 * ADR-009 §8 gate 4: harness-path integration test coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GateFn } from '@factory/nlah'
import type { HarnessDispatcherDeps } from './harness-dispatcher.js'

// ── Mock @factory/nlah ────────────────────────────────────────────────────────
vi.mock('@factory/nlah', () => ({
  gateRegistry: {},
  normalizeGateContract: (expr: unknown, fallbackId: string) => {
    if (typeof expr === 'object' && expr !== null && 'exists' in (expr as Record<string, unknown>)) {
      return { uses: 'exists', args: { artifact: (expr as Record<string, unknown>)['exists'] } }
    }
    return { uses: String(expr), args: {} }
  },
}))

// ── Mock cf-artifact-manager ──────────────────────────────────────────────────
vi.mock('./cf-artifact-manager.js', () => ({
  CfArtifactManager: class {
    constructor(public bucket: unknown, public prefix: string) {}
  },
}))

// ── Mock cf-workers ───────────────────────────────────────────────────────────
vi.mock('./cf-workers.js', () => ({
  buildCfWorkerRegistry: vi.fn(() => ({ get: vi.fn() })),
  buildStageContextFromJob: vi.fn(async () => ({ taskText: '' })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompiledHarness(stages?: Record<string, unknown>) {
  return {
    spec: {
      harness: { name: 'TEST' },
      stages: stages ?? {
        PLAN: {
          from: 'TaskReceived',
          to: 'Planned',
          role: 'Planner',
          worker: 'pi',
          inputs: [],
          outputs: ['ExecutionPlan'],
          gate: { all: [{ exists: 'ExecutionPlan' }] },
        },
      },
      runtime: {},
    },
    stageOrder: ['PLAN'],
    artifactPaths: { ExecutionPlan: 'artifacts/execution_plan.md' },
  }
}

function makeHarnessState() {
  return {
    runId: 'run-dispatch-001',
    currentStage: 'PLAN',
    status: 'running',
    completedStages: [],
    stageAttempts: {},
    totalAttempts: 0,
  }
}

function makeGetCompiledResponse(compiled = makeCompiledHarness(), state = makeHarnessState(), taskText = 'Do the thing') {
  return new Response(JSON.stringify({ compiled, state, taskText }), { status: 200 })
}

function makeStageCompleteOkResponse() {
  return new Response(JSON.stringify({ ok: true, action: 'dispatch', nextStage: 'CODE' }), { status: 200 })
}

function makeDoStub(getCompiledResp: Response, stageCompleteResp: Response) {
  return {
    // dispatchOne calls stub.fetch(urlString, init) — not a Request object
    fetch: vi.fn(async (reqOrUrl: Request | string, _init?: RequestInit) => {
      const urlStr = typeof reqOrUrl === 'string' ? reqOrUrl : (reqOrUrl as Request).url
      const url = new URL(urlStr)
      if (url.pathname === '/get-compiled') return getCompiledResp
      if (url.pathname === '/stage-complete') return stageCompleteResp
      return new Response('not found', { status: 404 })
    }),
  }
}

function makeEnv(stub: { fetch: ReturnType<typeof vi.fn> }) {
  return {
    RUN_COORDINATOR: {
      idFromName: vi.fn(() => ({ toString: () => 'do-id' })),
      get: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace,
    WORKSPACE_BUCKET: {} as R2Bucket,
    HARNESS_QUEUE: { send: vi.fn() },
    FACTORY_PIPELINE: { get: vi.fn(), create: vi.fn() },
    PI_MODEL: 'anthropic/claude-sonnet-4.5',
  }
}

function makeMockAdapter(output = { createdArtifacts: ['ExecutionPlan'], message: 'done' }) {
  return { execute: vi.fn(async () => output) }
}

function makeDeps(overrides: Partial<HarnessDispatcherDeps> = {}): HarnessDispatcherDeps {
  const mockAdapter = makeMockAdapter()
  const mockArtifacts = {
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
  }
  const existsGate: GateFn = async (_state, _artifacts, args) => {
    const artifact = typeof args === 'object' && args !== null && 'artifact' in args
      ? String((args as { artifact?: unknown }).artifact)
      : 'exists'
    return {
      gate: artifact,
      passed: true,
    }
  }
  return {
    resolveWorkerAdapter: vi.fn(() => mockAdapter as never),
    buildArtifactManager: vi.fn(() => mockArtifacts as never),
    buildStageContextForRun: vi.fn(async () => ({ taskText: 'Do the thing' })),
    gateRegistry: {
      exists: vi.fn(existsGate),
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dispatchOne', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('happy path: fetches compiled, runs adapter, evaluates gates, posts stage-complete', async () => {
    const { dispatchOne } = await import('./harness-dispatcher.js')
    const stub = makeDoStub(makeGetCompiledResponse(), makeStageCompleteOkResponse())
    const env = makeEnv(stub)
    const deps = makeDeps()

    await dispatchOne({ runId: 'run-dispatch-001', stageName: 'PLAN' }, env as never, deps)

    // GET /get-compiled was called (stub.fetch is called as urlString, init)
    expect(stub.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/get-compiled'),
      expect.objectContaining({ method: 'GET' }),
    )
    const getCall = stub.fetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/get-compiled'))
    expect(getCall).toBeDefined()

    // Worker adapter was resolved and executed
    expect((deps.resolveWorkerAdapter as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('pi', env)
    const adapter = (deps.resolveWorkerAdapter as ReturnType<typeof vi.fn>).mock.results[0]!.value as { execute: ReturnType<typeof vi.fn> }
    expect(adapter.execute).toHaveBeenCalledOnce()
    const workerInput = adapter.execute.mock.calls[0]?.[0] as { runId?: string; model?: { id: string; routeKind: string; resolvedVia: string } }
    expect(workerInput.runId).toBe('run-dispatch-001')
    expect(workerInput.model).toMatchObject({
      id: 'anthropic/claude-sonnet-4.5',
      routeKind: 'planner',
      resolvedVia: 'config-default',
    })

    // POST /stage-complete was called
    const completeCall = stub.fetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/stage-complete'))
    expect(completeCall).toBeDefined()
    const completeOpts = completeCall![1] as RequestInit
    const payload = JSON.parse(completeOpts.body as string) as Record<string, unknown>
    expect(payload.stageName).toBe('PLAN')
    expect((payload.workerOutput as { createdArtifacts: string[] }).createdArtifacts).toContain('ExecutionPlan')
  })

  it('worker throw: surfaces as workerThrew in stage-complete payload (no gateResults)', async () => {
    const { dispatchOne } = await import('./harness-dispatcher.js')
    const stub = makeDoStub(makeGetCompiledResponse(), makeStageCompleteOkResponse())
    const env = makeEnv(stub)
    const deps = makeDeps({
      resolveWorkerAdapter: vi.fn(() => ({
        execute: vi.fn(async () => { throw new Error('container exploded') }),
      }) as never),
    })

    await dispatchOne({ runId: 'run-dispatch-001', stageName: 'PLAN' }, env as never, deps)

    const completeCall = stub.fetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/stage-complete'))
    const completeOpts = completeCall![1] as RequestInit
    const payload = JSON.parse(completeOpts.body as string) as Record<string, unknown>
    expect(payload.workerThrew).toBeDefined()
    expect((payload.workerThrew as { message: string }).message).toContain('container exploded')
    // Gates are skipped when worker threw
    expect((payload.gateResults as unknown[]).length).toBe(0)
  })

  it('throws when stage not found in compiled harness', async () => {
    const { dispatchOne } = await import('./harness-dispatcher.js')
    const stub = makeDoStub(makeGetCompiledResponse(), makeStageCompleteOkResponse())
    const env = makeEnv(stub)
    const deps = makeDeps()

    await expect(
      dispatchOne({ runId: 'run-dispatch-001', stageName: 'NONEXISTENT' }, env as never, deps),
    ).rejects.toThrow('unknown stage in compiled harness: NONEXISTENT')
  })

  it('throws when /get-compiled returns non-2xx', async () => {
    const { dispatchOne } = await import('./harness-dispatcher.js')
    const errorResp = new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    const stub = makeDoStub(errorResp, makeStageCompleteOkResponse())
    const env = makeEnv(stub)
    const deps = makeDeps()

    await expect(
      dispatchOne({ runId: 'run-dispatch-001', stageName: 'PLAN' }, env as never, deps),
    ).rejects.toThrow('RunCoordinator /get-compiled failed (404)')
  })

  it('failureClass propagated from gate record into stage-complete payload', async () => {
    const { dispatchOne } = await import('./harness-dispatcher.js')
    const stub = makeDoStub(makeGetCompiledResponse(), makeStageCompleteOkResponse())
    const env = makeEnv(stub)
    const deps = makeDeps({
      gateRegistry: {
        exists: vi.fn(async () => ({
          gate: 'ExecutionPlan',
          passed: false,
          failureClass: 'missing_artifact',
          message: 'artifact not found',
        })),
      },
    })

    await dispatchOne({ runId: 'run-dispatch-001', stageName: 'PLAN' }, env as never, deps)

    const completeCall = stub.fetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/stage-complete'))
    const completeOpts = completeCall![1] as RequestInit
    const payload = JSON.parse(completeOpts.body as string) as Record<string, unknown>
    const gateResults = payload.gateResults as Array<{ failureClass?: string; passed: boolean }>
    const failedGate = gateResults.find((g) => !g.passed)
    expect(failedGate?.failureClass).toBe('missing_artifact')
  })
})
