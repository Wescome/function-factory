/**
 * specContent threading tests.
 *
 * Verifies that specContent flows from the pipeline Queue message
 * through to GraphState and into the semantic-critic and architect nodes.
 *
 * Touch points:
 *   1. pipeline.ts — enqueue-synthesis includes specContent from proposal
 *   2. index.ts — queue() handler extracts specContent from message body
 *   3. state.ts — GraphState includes specContent, createInitialState defaults it to null
 *   4. coordinator.ts — synthesize() passes specContent to createInitialState
 *   5. graph.ts — semantic-critic passes specContent to criticAgent.semanticReview()
 *   6. graph.ts — architect passes specContent to architectAgent.produceBriefingScript()
 *   7. Backward compat — absent specContent works unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock cloudflare:workers ───

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

// ─── Mock @cloudflare/sandbox + containers ───

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))

// ─── Shared ArangoDB mock ───

const mockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
  setValidator: vi.fn(),
}

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => mockDb,
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

// ─── Stage stubs ───

vi.mock('../stages/ingest-signal', () => ({
  ingestSignal: vi.fn(async () => ({ _key: 'SIG-001', signalType: 'internal', title: 'test' })),
}))

vi.mock('../stages/synthesize-pressure', () => ({
  synthesizePressure: vi.fn(async () => ({ _key: 'PRS-001', title: 'test pressure' })),
}))

vi.mock('../stages/map-capability', () => ({
  mapCapability: vi.fn(async () => ({ _key: 'BC-001', title: 'test capability' })),
}))

vi.mock('../stages/propose-function', () => ({
  proposeFunction: vi.fn(async () => ({
    _key: 'FP-001',
    title: 'test proposal',
    prd: { title: 'Test PRD', atoms: [], invariants: [] },
    specContent: '# Section 1\nThe system SHALL validate all inputs.\n# Section 2\nThe system SHALL log all events.',
  })),
}))

vi.mock('../stages/semantic-review', () => ({
  semanticReview: vi.fn(async () => ({
    alignment: 'aligned',
    confidence: 0.9,
    citations: [],
    rationale: 'Aligned',
    timestamp: '2026-04-26T00:00:00Z',
  })),
}))

vi.mock('../stages/compile', () => ({
  PASS_NAMES: ['atoms', 'contracts', 'invariants', 'validations', 'dependencies', 'schedule', 'budget', 'workgraph'],
  compilePRD: vi.fn(async (_pass: string, state: Record<string, unknown>) => ({
    ...state,
    workGraph: {
      _key: 'WG-SPEC',
      title: 'Test WorkGraph',
      atoms: [{ id: 'a1', description: 'test atom' }],
      invariants: [],
      dependencies: [],
    },
  })),
}))

// ─── Helpers ───

function createMockStep() {
  const stepDoNames: string[] = []
  const step = {
    do: vi.fn(async (name: string, optsOrFn: unknown, maybeFn?: unknown) => {
      const fn = typeof optsOrFn === 'function'
        ? optsOrFn as () => Promise<unknown>
        : maybeFn as () => Promise<unknown>
      stepDoNames.push(name)
      return fn()
    }),
    waitForEvent: vi.fn((_name: string, _opts?: unknown) => {
      return Promise.resolve({ payload: {} })
    }),
  }
  return { step, stepDoNames }
}

function createEnv(overrides?: Record<string, unknown>) {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: {
      evaluateGate1: vi.fn(async () => ({
        gate: 1,
        passed: true,
        timestamp: '2026-04-26T00:00:00Z',
        workGraphId: 'WG-SPEC',
        checks: [{ name: 'lineage', passed: true, detail: 'ok' }],
        summary: 'All checks passed',
      })),
    },
    FACTORY_PIPELINE: {
      create: vi.fn(async () => ({ id: 'wf-spec' })),
      get: vi.fn(async () => ({
        id: 'wf-spec',
        status: vi.fn(async () => ({ status: 'running' })),
        sendEvent: vi.fn(async () => {}),
      })),
    },
    COORDINATOR: {
      idFromName: vi.fn(() => 'do-id-spec'),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        })),
      })),
    },
    SYNTHESIS_QUEUE: {
      send: vi.fn(async () => ({})),
    },
    ...overrides,
  }
}

function createMockMessage(body: unknown, attempts = 1) {
  return {
    id: `msg-${Date.now()}`,
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function createMockBatch(messages: ReturnType<typeof createMockMessage>[]) {
  return {
    messages,
    queue: 'synthesis-queue',
    metadata: {
      metrics: {
        backlogCount: messages.length,
        backlogBytes: 0,
      },
    },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  }
}

function createMockCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

// ─── Tests ───

describe('specContent threading: pipeline -> queue -> DO -> graph nodes', () => {

  beforeEach(() => {
    mockDb.save.mockClear()
    mockDb.saveEdge.mockClear()
  })

  // ── Test 1: Pipeline enqueue-synthesis includes specContent ──

  describe('pipeline.ts: enqueue-synthesis includes specContent', () => {

    it('includes specContent from proposal in Queue message when present', async () => {
      const { FactoryPipeline } = await import('../pipeline')

      const mockQueueSend = vi.fn(async () => ({}))
      const env = createEnv({
        SYNTHESIS_QUEUE: { send: mockQueueSend },
      })

      const { step } = createMockStep()

      step.waitForEvent = vi.fn((name: string) => {
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
        return Promise.reject(new Error(`Unexpected: ${name}`))
      })

      const pipeline = Object.create(FactoryPipeline.prototype)
      pipeline.env = env

      await pipeline.run(
        {
          instanceId: 'wf-spec-test',
          payload: {
            signal: { signalType: 'internal' as const, source: 'test', title: 'Test', description: 'Test signal' },
          },
        },
        step,
      )

      expect(mockQueueSend).toHaveBeenCalledOnce()
      const sentMessage = (mockQueueSend.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
      expect(sentMessage.specContent).toBe(
        '# Section 1\nThe system SHALL validate all inputs.\n# Section 2\nThe system SHALL log all events.',
      )
    })
  })

  // ── Test 2: GraphState initializes with specContent ──

  describe('state.ts: GraphState includes specContent', () => {

    it('createInitialState defaults specContent to null', async () => {
      const { createInitialState } = await import('./state')
      const state = createInitialState('WG-001', { id: 'WG-001' })
      expect(state.specContent).toBeNull()
    })

    it('createInitialState accepts specContent via opts', async () => {
      const { createInitialState } = await import('./state')
      const state = createInitialState('WG-001', { id: 'WG-001' }, { specContent: 'The spec text' })
      expect(state.specContent).toBe('The spec text')
    })

    it('specContent survives spread-merge cycle', async () => {
      const { createInitialState } = await import('./state')
      const base = createInitialState('WG-001', { id: 'WG-001' }, { specContent: 'Original spec' })
      const merged = { ...base, plan: { approach: 'test', atoms: [], executorRecommendation: 'gdk-agent' as const, estimatedComplexity: 'low' as const } }
      expect(merged.specContent).toBe('Original spec')
    })
  })

  // ── Test 3: semantic-critic passes specContent to criticAgent ──

  describe('graph.ts: semantic-critic passes specContent to criticAgent', () => {

    it('passes specContent to criticAgent.semanticReview when state has specContent', async () => {
      const { buildSynthesisGraph } = await import('./graph')
      const { createInitialState } = await import('./state')

      const semanticReviewMock = vi.fn().mockResolvedValue({
        alignment: 'aligned',
        confidence: 0.95,
        citations: ['spec-section-1'],
        rationale: 'Test rationale',
        timestamp: new Date().toISOString(),
      })

      const deps = {
        callModel: vi.fn().mockImplementation(async (taskKind: string) => {
          switch (taskKind) {
            case 'planner':
              return JSON.stringify({
                approach: 'Test plan',
                atoms: [{ id: 'a1', description: 'Stub', assignedTo: 'coder' }],
                executorRecommendation: 'gdk-agent',
                estimatedComplexity: 'low',
              })
            case 'coder':
              return JSON.stringify({
                files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
                summary: 'Code output',
                testsIncluded: false,
              })
            case 'tester':
              return JSON.stringify({
                passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
                failures: [], summary: 'OK',
              })
            case 'verifier':
              return JSON.stringify({
                decision: 'pass', confidence: 1.0, reason: 'OK',
              })
            default:
              return JSON.stringify({ result: 'stub' })
          }
        }),
        persistState: vi.fn().mockResolvedValue(undefined),
        fetchMentorRules: vi.fn().mockResolvedValue([]),
        architectAgent: {
          produceBriefingScript: vi.fn().mockResolvedValue({
            goal: 'Test goal',
            successCriteria: ['criterion-1'],
            architecturalContext: 'Test context',
            strategicAdvice: 'Test advice',
            knownGotchas: [],
            validationLoop: 'Test validation',
          }),
        },
        criticAgent: {
          semanticReview: semanticReviewMock,
          codeReview: vi.fn().mockResolvedValue({
            passed: true,
            issues: [],
            mentorRuleCompliance: [],
            overallAssessment: 'OK',
          }),
        },
      }

      const graph = buildSynthesisGraph(deps)
      const state = {
        ...createInitialState('WG-SPEC', {
          id: 'WG-SPEC',
          title: 'Spec Test',
          atoms: [],
          invariants: [],
          dependencies: [],
        }, { specContent: 'The system SHALL do X.' }),
      }

      await graph.run(state, { maxSteps: 50 })

      expect(semanticReviewMock).toHaveBeenCalledTimes(1)
      const callArg = (semanticReviewMock.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
      expect(callArg.specContent).toBe('The system SHALL do X.')
    })

    it('does not pass specContent when state.specContent is null', async () => {
      const { buildSynthesisGraph } = await import('./graph')
      const { createInitialState } = await import('./state')

      const semanticReviewMock = vi.fn().mockResolvedValue({
        alignment: 'aligned',
        confidence: 0.95,
        citations: [],
        rationale: 'Test rationale',
        timestamp: new Date().toISOString(),
      })

      const deps = {
        callModel: vi.fn().mockImplementation(async (taskKind: string) => {
          switch (taskKind) {
            case 'planner':
              return JSON.stringify({
                approach: 'Plan', atoms: [{ id: 'a1', description: 'Stub', assignedTo: 'coder' }],
                executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
              })
            case 'coder':
              return JSON.stringify({
                files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
                summary: 'Code', testsIncluded: false,
              })
            case 'tester':
              return JSON.stringify({ passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0, failures: [], summary: 'OK' })
            case 'verifier':
              return JSON.stringify({ decision: 'pass', confidence: 1.0, reason: 'OK' })
            default:
              return JSON.stringify({ result: 'stub' })
          }
        }),
        persistState: vi.fn().mockResolvedValue(undefined),
        fetchMentorRules: vi.fn().mockResolvedValue([]),
        architectAgent: {
          produceBriefingScript: vi.fn().mockResolvedValue({
            goal: 'g', successCriteria: ['c'], architecturalContext: 'c',
            strategicAdvice: 'a', knownGotchas: [], validationLoop: 'v',
          }),
        },
        criticAgent: {
          semanticReview: semanticReviewMock,
          codeReview: vi.fn().mockResolvedValue({
            passed: true, issues: [], mentorRuleCompliance: [], overallAssessment: 'OK',
          }),
        },
      }

      const graph = buildSynthesisGraph(deps)
      const state = createInitialState('WG-NOSPEC', {
        id: 'WG-NOSPEC', title: 'No Spec', atoms: [], invariants: [], dependencies: [],
      })

      await graph.run(state, { maxSteps: 50 })

      expect(semanticReviewMock).toHaveBeenCalledTimes(1)
      const callArg = (semanticReviewMock.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
      // specContent should be undefined (not null) — omitted from call
      expect(callArg.specContent).toBeUndefined()
    })
  })

  // ── Test 4: architect passes specContent to architectAgent ──

  describe('graph.ts: architect passes specContent to architectAgent', () => {

    it('passes specContent to produceBriefingScript when state has specContent', async () => {
      const { buildSynthesisGraph } = await import('./graph')
      const { createInitialState } = await import('./state')

      const produceBriefingScriptMock = vi.fn().mockResolvedValue({
        goal: 'Test goal',
        successCriteria: ['criterion-1'],
        architecturalContext: 'Test context',
        strategicAdvice: 'Test advice',
        knownGotchas: [],
        validationLoop: 'Test validation',
      })

      const deps = {
        callModel: vi.fn().mockImplementation(async (taskKind: string) => {
          switch (taskKind) {
            case 'planner':
              return JSON.stringify({
                approach: 'Plan', atoms: [{ id: 'a1', description: 'Stub', assignedTo: 'coder' }],
                executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
              })
            case 'coder':
              return JSON.stringify({
                files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
                summary: 'Code', testsIncluded: false,
              })
            case 'tester':
              return JSON.stringify({ passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0, failures: [], summary: 'OK' })
            case 'verifier':
              return JSON.stringify({ decision: 'pass', confidence: 1.0, reason: 'OK' })
            default:
              return JSON.stringify({ result: 'stub' })
          }
        }),
        persistState: vi.fn().mockResolvedValue(undefined),
        fetchMentorRules: vi.fn().mockResolvedValue([]),
        architectAgent: {
          produceBriefingScript: produceBriefingScriptMock,
        },
        criticAgent: {
          semanticReview: vi.fn().mockResolvedValue({
            alignment: 'aligned', confidence: 0.95, citations: [],
            rationale: 'OK', timestamp: new Date().toISOString(),
          }),
          codeReview: vi.fn().mockResolvedValue({
            passed: true, issues: [], mentorRuleCompliance: [], overallAssessment: 'OK',
          }),
        },
      }

      const graph = buildSynthesisGraph(deps)
      const state = createInitialState('WG-ARCH', {
        id: 'WG-ARCH', title: 'Arch Test', atoms: [], invariants: [], dependencies: [],
      }, { specContent: 'The architect SHALL see this spec.' })

      await graph.run(state, { maxSteps: 50 })

      expect(produceBriefingScriptMock).toHaveBeenCalledTimes(1)
      const callArg = (produceBriefingScriptMock.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
      expect(callArg.specContent).toBe('The architect SHALL see this spec.')
    })

    it('does not pass specContent to produceBriefingScript when absent', async () => {
      const { buildSynthesisGraph } = await import('./graph')
      const { createInitialState } = await import('./state')

      const produceBriefingScriptMock = vi.fn().mockResolvedValue({
        goal: 'g', successCriteria: ['c'], architecturalContext: 'c',
        strategicAdvice: 'a', knownGotchas: [], validationLoop: 'v',
      })

      const deps = {
        callModel: vi.fn().mockImplementation(async (taskKind: string) => {
          switch (taskKind) {
            case 'planner':
              return JSON.stringify({
                approach: 'Plan', atoms: [{ id: 'a1', description: 'Stub', assignedTo: 'coder' }],
                executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
              })
            case 'coder':
              return JSON.stringify({
                files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
                summary: 'Code', testsIncluded: false,
              })
            case 'tester':
              return JSON.stringify({ passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0, failures: [], summary: 'OK' })
            case 'verifier':
              return JSON.stringify({ decision: 'pass', confidence: 1.0, reason: 'OK' })
            default:
              return JSON.stringify({ result: 'stub' })
          }
        }),
        persistState: vi.fn().mockResolvedValue(undefined),
        fetchMentorRules: vi.fn().mockResolvedValue([]),
        architectAgent: {
          produceBriefingScript: produceBriefingScriptMock,
        },
        criticAgent: {
          semanticReview: vi.fn().mockResolvedValue({
            alignment: 'aligned', confidence: 0.95, citations: [],
            rationale: 'OK', timestamp: new Date().toISOString(),
          }),
          codeReview: vi.fn().mockResolvedValue({
            passed: true, issues: [], mentorRuleCompliance: [], overallAssessment: 'OK',
          }),
        },
      }

      const graph = buildSynthesisGraph(deps)
      const state = createInitialState('WG-NOARCH', {
        id: 'WG-NOARCH', title: 'No Spec Arch', atoms: [], invariants: [], dependencies: [],
      })

      await graph.run(state, { maxSteps: 50 })

      expect(produceBriefingScriptMock).toHaveBeenCalledTimes(1)
      const callArg = (produceBriefingScriptMock.mock.calls as unknown[][])[0]![0] as Record<string, unknown>
      expect(callArg.specContent).toBeUndefined()
    })
  })

  // ── Test 5: Queue consumer passes specContent to DO ──

  describe('index.ts: queue() handler threads specContent to DO', () => {

    it('passes specContent in DO fetch body when present in queue message', async () => {
      const { default: worker } = await import('../index')

      const doResult = {
        verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
        tokenUsage: 100,
        repairCount: 0,
      }

      const mockDoFetch = vi.fn(async () => new Response(JSON.stringify(doResult), {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-spec-q',
            status: vi.fn(),
            sendEvent: vi.fn(async () => {}),
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-synth-WG-SPECQ'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-spec-q',
        workGraphId: 'WG-SPECQ',
        workGraph: { _key: 'WG-SPECQ', title: 'Test' },
        dryRun: false,
        specContent: 'The system SHALL thread specContent through the queue.',
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockDoFetch).toHaveBeenCalledOnce()
      const fetchArg = (mockDoFetch.mock.calls as unknown[][])[0]![0] as Request
      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      expect(fetchBody.specContent).toBe('The system SHALL thread specContent through the queue.')
    })

    it('omits specContent from DO fetch body when absent in queue message', async () => {
      const { default: worker } = await import('../index')

      const doResult = {
        verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
        tokenUsage: 100,
        repairCount: 0,
      }

      const mockDoFetch = vi.fn(async () => new Response(JSON.stringify(doResult), {
        headers: { 'Content-Type': 'application/json' },
      }))

      const env = createEnv({
        FACTORY_PIPELINE: {
          create: vi.fn(),
          get: vi.fn(async () => ({
            id: 'wf-nospec-q',
            status: vi.fn(),
            sendEvent: vi.fn(async () => {}),
          })),
        },
        COORDINATOR: {
          idFromName: vi.fn(() => 'do-synth-WG-NOSPECQ'),
          get: vi.fn(() => ({ fetch: mockDoFetch })),
        },
      })

      const msg = createMockMessage({
        workflowId: 'wf-nospec-q',
        workGraphId: 'WG-NOSPECQ',
        workGraph: { _key: 'WG-NOSPECQ', title: 'Test' },
        dryRun: false,
        // specContent intentionally omitted
      })

      const batch = createMockBatch([msg])
      const ctx = createMockCtx()

      await worker.queue(batch as never, env as never, ctx as never)

      expect(mockDoFetch).toHaveBeenCalledOnce()
      const fetchArg = (mockDoFetch.mock.calls as unknown[][])[0]![0] as Request
      const fetchBody = await new Request(fetchArg).json() as Record<string, unknown>
      // specContent should be absent/undefined in the body — backward compat
      expect(fetchBody.specContent).toBeUndefined()
    })
  })

  // ── Test 6: Backward compat — absent specContent works unchanged ──

  describe('backward compatibility: absent specContent', () => {

    it('9-node graph runs to completion without specContent in state', async () => {
      const { buildSynthesisGraph } = await import('./graph')
      const { createInitialState } = await import('./state')

      const deps = {
        callModel: vi.fn().mockImplementation(async (taskKind: string) => {
          switch (taskKind) {
            case 'planner':
              return JSON.stringify({
                approach: 'Plan', atoms: [{ id: 'a1', description: 'Stub', assignedTo: 'coder' }],
                executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
              })
            case 'coder':
              return JSON.stringify({
                files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
                summary: 'Code', testsIncluded: false,
              })
            case 'tester':
              return JSON.stringify({ passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0, failures: [], summary: 'OK' })
            case 'verifier':
              return JSON.stringify({ decision: 'pass', confidence: 1.0, reason: 'OK' })
            default:
              return JSON.stringify({ result: 'stub' })
          }
        }),
        persistState: vi.fn().mockResolvedValue(undefined),
        fetchMentorRules: vi.fn().mockResolvedValue([]),
        architectAgent: {
          produceBriefingScript: vi.fn().mockResolvedValue({
            goal: 'g', successCriteria: ['c'], architecturalContext: 'c',
            strategicAdvice: 'a', knownGotchas: [], validationLoop: 'v',
          }),
        },
        criticAgent: {
          semanticReview: vi.fn().mockResolvedValue({
            alignment: 'aligned', confidence: 0.95, citations: [],
            rationale: 'OK', timestamp: new Date().toISOString(),
          }),
          codeReview: vi.fn().mockResolvedValue({
            passed: true, issues: [], mentorRuleCompliance: [], overallAssessment: 'OK',
          }),
        },
      }

      const graph = buildSynthesisGraph(deps)
      // No specContent passed — default null
      const state = createInitialState('WG-BC', {
        id: 'WG-BC', title: 'BackCompat', atoms: [], invariants: [], dependencies: [],
      })

      const visited: string[] = []
      const finalState = await graph.run(state, {
        maxSteps: 50,
        onNodeStart: (name) => visited.push(name),
      })

      expect(visited).toEqual([
        'budget-check', 'architect', 'semantic-critic', 'compile',
        'gate-1', 'planner', 'coder', 'code-critic', 'tester', 'verifier',
      ])
      expect(finalState.verdict?.decision).toBe('pass')
      expect(finalState.specContent).toBeNull()
    })
  })
})
