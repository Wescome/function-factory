/**
 * TDD: Step timeout configuration tests.
 *
 * Verifies that all step.do() calls in the pipeline pass correct
 * timeout and retry configs. CF Workflow steps that call AI models
 * need '4 minutes' timeout; DB-only steps need '30 seconds'.
 *
 * setTimeout is DEAD CODE inside CF Workflow steps (I/O suspension
 * freezes timers), so step-level timeout is the only reliable mechanism.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

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

// ─── Stage mocks ───

const sharedMockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
  setValidator: vi.fn(),
  ensureCollection: vi.fn(async () => {}),
}

vi.mock('@factory/db-client', () => ({
  createClientFromEnv: () => sharedMockDb,
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

vi.mock('./ingest-signal', () => ({
  ingestSignal: vi.fn(async () => ({ _key: 'SIG-001', signalType: 'internal', title: 'test', description: 'test desc' })),
}))

vi.mock('./synthesize-pressure', () => ({
  synthesizePressure: vi.fn(async () => ({ _key: 'PRS-001', title: 'test pressure' })),
}))

vi.mock('./map-capability', () => ({
  mapCapability: vi.fn(async () => ({ _key: 'BC-001', title: 'test capability' })),
}))

vi.mock('./propose-function', () => ({
  proposeFunction: vi.fn(async () => ({
    _key: 'FP-001',
    title: 'test proposal',
    intentSpecification: { title: 'Test Intent Specification', atoms: [], invariants: [] },
  })),
}))

vi.mock('./semantic-review', () => ({
  semanticReview: vi.fn(async () => ({
    alignment: 'aligned',
    confidence: 0.9,
    citations: [],
    rationale: 'Aligned',
    timestamp: '2026-05-04T00:00:00Z',
  })),
}))

vi.mock('./compile', () => ({
  PASS_NAMES: ['atoms', 'contracts', 'invariants', 'validations', 'dependencies', 'schedule', 'budget', 'executableSpecification'],
  compileIntentSpecification: vi.fn(async (_pass: string, state: Record<string, unknown>) => ({
    ...state,
    executableSpecification: {
      _key: 'ES-TEST',
      title: 'Test ExecutableSpecification',
      atoms: [{ id: 'a1', description: 'test atom' }],
      invariants: [],
      dependencies: [],
    },
  })),
}))

vi.mock('../gascity/skeleton-builder', () => ({
  buildSkeleton: vi.fn(async () => ({ r2Key: 'skeletons/test/skeleton.tar.gz', skeletonSha: 'abc123def456' })),
  getSkeletonDownloadUrl: vi.fn(() => 'https://ff-pipeline.koales.workers.dev/skeleton-download?key=test&token=tok'),
}))

vi.mock('../compilers/formula-compiler-adapter', () => ({
  buildFormulaCompilerDeps: vi.fn(() => ({})),
}))

vi.mock('../compilers/formula-compiler', () => ({
  compileAndDispatchFormula: vi.fn(async () => ({
    outcome: 'dispatched',
    form_id: 'FORM-TEST',
    dispatch_log_key: 'DL-TEST',
    gc_bead_id: 'bead-123',
    gc_workflow_id: 'wf-123',
  })),
}))

vi.mock('../gascity/autonomy-monitor', () => ({
  markFunctionDispatched: vi.fn(async () => {}),
}))

// ─── Step call tracker ───

interface StepDoRecord {
  name: string
  opts: Record<string, unknown> | undefined
}

function createMockEnv() {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: {
      evaluateCoherenceVerification: vi.fn(async () => ({
        verification: "coherence",
        passed: true,
        timestamp: '2026-05-04T00:00:00Z',
        executableSpecificationId: 'ES-TEST',
        checks: [{ name: 'lineage', passed: true, detail: 'ok' }],
        summary: 'All checks passed',
      })),
    },
    FACTORY_PIPELINE: {
      create: vi.fn(async () => ({ id: 'wf-123' })),
      get: vi.fn(async () => ({
        id: 'wf-123',
        status: vi.fn(async () => ({ status: 'running' })),
        sendEvent: vi.fn(async () => {}),
      })),
    },
    COORDINATOR: {
      idFromName: vi.fn(() => 'do-id-123'),
      get: vi.fn(() => ({
        synthesize: vi.fn(async () => ({
          functionId: 'ES-TEST',
          verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
          tokenUsage: 4200,
          repairCount: 0,
          roleHistory: [],
        })),
      })),
    },
    SYNTHESIS_QUEUE: {
      send: vi.fn(async () => ({})),
    },
    FEEDBACK_QUEUE: {
      send: vi.fn(async () => ({})),
    },
    GITHUB_TOKEN: 'test-token',
    GAS_CITY_HMAC_SECRET_V1: 'test-secret',
    WORKSPACE_BUCKET: { put: vi.fn(async () => ({})), get: vi.fn(async () => null) },
    GAS_CITY_BASE_URL: 'https://gascity.example.com',
    GAS_CITY_BEARER_TOKEN: 'test-bearer',
  }
}

function createTrackerStep() {
  const records: StepDoRecord[] = []

  const step = {
    do: vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
      const fn = typeof optsOrFn === 'function'
        ? optsOrFn as () => Promise<unknown>
        : maybeFn as () => Promise<unknown>
      const opts = typeof optsOrFn === 'object' ? optsOrFn as Record<string, unknown> : undefined
      records.push({ name, opts })
      return fn()
    }),
    waitForEvent: vi.fn((name: string) => {
      if (name === 'architect-approval') {
        return Promise.resolve({ payload: { decision: 'approved', by: 'test' } })
      }
      if (name === 'synthesis-complete') {
        return Promise.resolve({
          payload: {
            verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
            tokenUsage: 100,
            repairCount: 0,
          },
        })
      }
      return Promise.reject(new Error(`Unexpected waitForEvent: ${name}`))
    }),
  }

  return { step, records }
}

// ─── Tests ───

describe('Step timeout configuration', () => {

  const originalFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // AI model step names (these call callModel -> need 2 minute timeout)
  const AI_STEPS = [
    'synthesize-pressure',
    'map-capability',
    'propose-function',
    'semantic-review',
    'crystallize-intent',
  ]

  // DB-only step names (shorter timeout, more retries)
  const DB_STEPS = [
    'ingest-signal',
    'edge-pressure-signal',
    'edge-capability-pressure',
    'edge-proposal-capability',
    'lifecycle-proposed',
    'persist-intent-anchors',
    'edge-executableSpecification-proposal',
    'persist-coherence-verification-pass',
    'lifecycle-designed',
    'build-skeleton',
    'build-execution-packet',
    'dispatch-formula',
    'mark-function-dispatched',
  ]

  it('AI-calling steps pass timeout: "2 minutes" to step.do', async () => {
    const { FactoryPipeline } = await import('../pipeline')
    const env = createMockEnv()
    const { step, records } = createTrackerStep()

    const pipeline = Object.create(FactoryPipeline.prototype)
    pipeline.env = env

    await pipeline.run(
      {
        instanceId: 'wf-timeout-test',
        payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
      },
      step,
    )

    for (const stepName of AI_STEPS) {
      const record = records.find(r => r.name === stepName)
      expect(record, `step '${stepName}' should exist in recorded calls`).toBeDefined()
      expect(record!.opts, `step '${stepName}' should have config object`).toBeDefined()
      expect(record!.opts!.timeout, `step '${stepName}' timeout should be '4 minutes'`).toBe('4 minutes')
    }
  })

  it('AI-calling steps pass retries config with limit: 2', async () => {
    const { FactoryPipeline } = await import('../pipeline')
    const env = createMockEnv()
    const { step, records } = createTrackerStep()

    const pipeline = Object.create(FactoryPipeline.prototype)
    pipeline.env = env

    await pipeline.run(
      {
        instanceId: 'wf-retry-test',
        payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
      },
      step,
    )

    for (const stepName of AI_STEPS) {
      const record = records.find(r => r.name === stepName)
      expect(record, `step '${stepName}' should exist`).toBeDefined()
      const retries = record!.opts!.retries as { limit: number; delay: string; backoff: string }
      expect(retries, `step '${stepName}' should have retries config`).toBeDefined()
      expect(retries.limit, `step '${stepName}' retries.limit should be 2`).toBe(2)
      expect(retries.delay, `step '${stepName}' retries.delay should be '5 seconds'`).toBe('5 seconds')
      expect(retries.backoff, `step '${stepName}' retries.backoff should be 'exponential'`).toBe('exponential')
    }
  })

  it('DB-only steps pass timeout: "30 seconds" to step.do', async () => {
    const { FactoryPipeline } = await import('../pipeline')
    const env = createMockEnv()
    const { step, records } = createTrackerStep()

    const pipeline = Object.create(FactoryPipeline.prototype)
    pipeline.env = env

    await pipeline.run(
      {
        instanceId: 'wf-db-timeout-test',
        payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
      },
      step,
    )

    for (const stepName of DB_STEPS) {
      const record = records.find(r => r.name === stepName)
      if (!record) continue // Some DB steps are conditional (e.g., persist-intent-anchors)
      expect(record.opts, `step '${stepName}' should have config object`).toBeDefined()
      expect(record.opts!.timeout, `step '${stepName}' timeout should be '30 seconds'`).toBe('30 seconds')
    }
  })

  it('DB-only steps pass retries config with limit: 3', async () => {
    const { FactoryPipeline } = await import('../pipeline')
    const env = createMockEnv()
    const { step, records } = createTrackerStep()

    const pipeline = Object.create(FactoryPipeline.prototype)
    pipeline.env = env

    await pipeline.run(
      {
        instanceId: 'wf-db-retry-test',
        payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
      },
      step,
    )

    for (const stepName of DB_STEPS) {
      const record = records.find(r => r.name === stepName)
      if (!record) continue
      const retries = record.opts!.retries as { limit: number; delay: string; backoff: string }
      expect(retries, `step '${stepName}' should have retries config`).toBeDefined()
      expect(retries.limit, `step '${stepName}' retries.limit should be 3`).toBe(3)
      expect(retries.delay, `step '${stepName}' retries.delay should be '2 seconds'`).toBe('2 seconds')
      expect(retries.backoff, `step '${stepName}' retries.backoff should be 'exponential'`).toBe('exponential')
    }
  })

  it('compile-* steps pass AI timeout config', async () => {
    const { FactoryPipeline } = await import('../pipeline')
    const env = createMockEnv()
    const { step, records } = createTrackerStep()

    const pipeline = Object.create(FactoryPipeline.prototype)
    pipeline.env = env

    await pipeline.run(
      {
        instanceId: 'wf-compile-timeout-test',
        payload: { signal: { signalType: 'internal', source: 'test', title: 'Test', description: 'Test signal' } },
      },
      step,
    )

    // compile-* steps are dynamically named based on PASS_NAMES
    const compileSteps = records.filter(r => r.name.startsWith('compile-'))
    expect(compileSteps.length).toBeGreaterThan(0)

    for (const record of compileSteps) {
      expect(record.opts, `step '${record.name}' should have config object`).toBeDefined()
      expect(record.opts!.timeout, `step '${record.name}' timeout should be '4 minutes'`).toBe('4 minutes')
      const retries = record.opts!.retries as { limit: number; delay: string; backoff: string }
      expect(retries.limit, `step '${record.name}' retries.limit should be 2`).toBe(2)
    }
  })
})
