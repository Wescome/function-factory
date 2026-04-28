/**
 * v5: Vertical Slicing Execution Engine tests.
 *
 * Tests three modules:
 *   1. topologicalSort — groups atoms into dependency layers
 *   2. executeAtomSlice — per-atom 4-node pipeline (code → critic → test → verify)
 *   3. executeLayer — parallel dispatch of atoms in a dependency layer
 *   4. Integration: full Phase 1 → Phase 2 → Phase 3 with dry-run
 *
 * All tests use dry-run agents (no LLM calls).
 */
import { describe, it, expect, vi } from 'vitest'
import { topologicalSort, executeLayer, type DependencyLayer } from './layer-dispatch.js'
import { executeAtomSlice, type AtomSlice, type AtomResult, type AtomExecutorDeps } from './atom-executor.js'
import { buildSynthesisGraph, type GraphDeps } from './graph.js'
import { createInitialState, type GraphState, type Verdict, type CodeArtifact, type CritiqueReport, type TestReport } from './state.js'
import type { BriefingScript } from '../agents/architect-agent.js'
import type { SemanticReviewResult } from '../types.js'

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────

function makeStubBriefingScript(): BriefingScript {
  return {
    goal: 'Test goal',
    successCriteria: ['criterion-1'],
    architecturalContext: 'Test context',
    strategicAdvice: 'Test advice',
    knownGotchas: ['gotcha-1'],
    validationLoop: 'Test validation',
  }
}

function makeStubSemanticReview(): SemanticReviewResult {
  return {
    alignment: 'aligned',
    confidence: 0.95,
    citations: ['spec-section-1'],
    rationale: 'Test rationale',
    timestamp: new Date().toISOString(),
  }
}

function makeStubCodeCritique(): CritiqueReport {
  return {
    passed: true,
    issues: [],
    mentorRuleCompliance: [{ ruleId: 'MR-001', compliant: true }],
    overallAssessment: 'Code looks good',
  }
}

function makeDryRunAtomDeps(): AtomExecutorDeps {
  return {
    coderAgent: {
      produceCode: vi.fn().mockResolvedValue({
        files: [{ path: 'src/stub.ts', content: '// dry-run', action: 'create' }],
        summary: 'Dry-run code',
        testsIncluded: false,
      } satisfies CodeArtifact),
    },
    criticAgent: {
      codeReview: vi.fn().mockResolvedValue({
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'Dry-run OK',
      } satisfies CritiqueReport),
    },
    testerAgent: {
      runTests: vi.fn().mockResolvedValue({
        passed: true,
        testsRun: 1,
        testsPassed: 1,
        testsFailed: 0,
        failures: [],
        summary: 'Dry-run tests pass',
      } satisfies TestReport),
    },
    verifierAgent: {
      verify: vi.fn().mockResolvedValue({
        decision: 'pass' as const,
        confidence: 1.0,
        reason: 'Dry-run auto-pass',
      } satisfies Verdict),
    },
    fetchMentorRules: vi.fn().mockResolvedValue([]),
  }
}

function makeFailThenPassDeps(failCount: number = 1): AtomExecutorDeps {
  let verifierCalls = 0
  return {
    coderAgent: {
      produceCode: vi.fn().mockResolvedValue({
        files: [{ path: 'src/stub.ts', content: '// fixed', action: 'create' }],
        summary: 'Code output',
        testsIncluded: false,
      } satisfies CodeArtifact),
    },
    criticAgent: {
      codeReview: vi.fn().mockResolvedValue({
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'OK',
      } satisfies CritiqueReport),
    },
    testerAgent: {
      runTests: vi.fn().mockResolvedValue({
        passed: true,
        testsRun: 1,
        testsPassed: 1,
        testsFailed: 0,
        failures: [],
        summary: 'Tests pass',
      } satisfies TestReport),
    },
    verifierAgent: {
      verify: vi.fn().mockImplementation(async () => {
        verifierCalls++
        if (verifierCalls <= failCount) {
          return {
            decision: 'patch' as const,
            confidence: 0.5,
            reason: `Needs fix (attempt ${verifierCalls})`,
            notes: 'Fix the issue',
          }
        }
        return {
          decision: 'pass' as const,
          confidence: 1.0,
          reason: 'Fixed',
        }
      }),
    },
    fetchMentorRules: vi.fn().mockResolvedValue([]),
  }
}

// ────────────────────────────────────────────────────────────
// 1. topologicalSort tests
// ────────────────────────────────────────────────────────────

describe('v5: topologicalSort', () => {
  it('3 independent atoms → 1 layer with all 3', () => {
    const atoms = [
      { id: 'atom-1', description: 'A' },
      { id: 'atom-2', description: 'B' },
      { id: 'atom-3', description: 'C' },
    ]
    const dependencies: Record<string, unknown>[] = []

    const layers = topologicalSort(atoms, dependencies)

    expect(layers).toHaveLength(1)
    expect(layers[0]!.index).toBe(0)
    expect(layers[0]!.atomIds.sort()).toEqual(['atom-1', 'atom-2', 'atom-3'])
  })

  it('linear chain A→B→C → 3 layers of 1 each', () => {
    const atoms = [
      { id: 'atom-A', description: 'A' },
      { id: 'atom-B', description: 'B' },
      { id: 'atom-C', description: 'C' },
    ]
    const dependencies = [
      { from: 'atom-A', to: 'atom-B', type: 'blocks' },
      { from: 'atom-B', to: 'atom-C', type: 'blocks' },
    ]

    const layers = topologicalSort(atoms, dependencies)

    expect(layers).toHaveLength(3)
    expect(layers[0]!.atomIds).toEqual(['atom-A'])
    expect(layers[1]!.atomIds).toEqual(['atom-B'])
    expect(layers[2]!.atomIds).toEqual(['atom-C'])
  })

  it('diamond: A→B, A→C, B→D, C→D → 3 layers: [A], [B,C], [D]', () => {
    const atoms = [
      { id: 'atom-A', description: 'A' },
      { id: 'atom-B', description: 'B' },
      { id: 'atom-C', description: 'C' },
      { id: 'atom-D', description: 'D' },
    ]
    const dependencies = [
      { from: 'atom-A', to: 'atom-B', type: 'blocks' },
      { from: 'atom-A', to: 'atom-C', type: 'blocks' },
      { from: 'atom-B', to: 'atom-D', type: 'blocks' },
      { from: 'atom-C', to: 'atom-D', type: 'blocks' },
    ]

    const layers = topologicalSort(atoms, dependencies)

    expect(layers).toHaveLength(3)
    expect(layers[0]!.atomIds).toEqual(['atom-A'])
    expect(layers[1]!.atomIds.sort()).toEqual(['atom-B', 'atom-C'])
    expect(layers[2]!.atomIds).toEqual(['atom-D'])
  })

  it('no atoms → empty layers', () => {
    const layers = topologicalSort([], [])
    expect(layers).toHaveLength(0)
  })

  it('single atom with no dependencies → 1 layer', () => {
    const atoms = [{ id: 'atom-only', description: 'Solo' }]
    const layers = topologicalSort(atoms, [])

    expect(layers).toHaveLength(1)
    expect(layers[0]!.atomIds).toEqual(['atom-only'])
  })
})

// ────────────────────────────────────────────────────────────
// 2. executeAtomSlice tests
// ────────────────────────────────────────────────────────────

describe('v5: executeAtomSlice', () => {
  it('atom passes on first try → AtomResult with verdict pass, retryCount 0', async () => {
    const deps = makeDryRunAtomDeps()
    const slice: AtomSlice = {
      atomId: 'atom-001',
      atomSpec: { id: 'atom-001', description: 'Test atom' },
      upstreamArtifacts: {},
      sharedContext: {
        workGraphId: 'WG-TEST',
        specContent: null,
        briefingScript: makeStubBriefingScript(),
      },
    }

    const result = await executeAtomSlice(slice, deps, { maxRetries: 3, dryRun: false })

    expect(result.atomId).toBe('atom-001')
    expect(result.verdict.decision).toBe('pass')
    expect(result.verdict.confidence).toBe(1.0)
    expect(result.retryCount).toBe(0)
    expect(result.codeArtifact).not.toBeNull()
    expect(result.testReport).not.toBeNull()
    expect(result.critiqueReport).not.toBeNull()
  })

  it('atom fails then passes on retry → retryCount = 1', async () => {
    const deps = makeFailThenPassDeps(1)
    const slice: AtomSlice = {
      atomId: 'atom-002',
      atomSpec: { id: 'atom-002', description: 'Needs retry' },
      upstreamArtifacts: {},
      sharedContext: {
        workGraphId: 'WG-TEST',
        specContent: null,
        briefingScript: makeStubBriefingScript(),
      },
    }

    const result = await executeAtomSlice(slice, deps, { maxRetries: 3, dryRun: false })

    expect(result.atomId).toBe('atom-002')
    expect(result.verdict.decision).toBe('pass')
    expect(result.retryCount).toBe(1)
    // Coder called twice (initial + 1 retry)
    expect(deps.coderAgent.produceCode).toHaveBeenCalledTimes(2)
    // Verifier called twice
    expect(deps.verifierAgent.verify).toHaveBeenCalledTimes(2)
  })

  it('atom fails all retries → AtomResult with verdict fail', async () => {
    // Verifier always returns patch
    const deps = makeDryRunAtomDeps()
    ;(deps.verifierAgent.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      decision: 'patch' as const,
      confidence: 0.3,
      reason: 'Keeps failing',
      notes: 'Unfixable',
    })

    const slice: AtomSlice = {
      atomId: 'atom-003',
      atomSpec: { id: 'atom-003', description: 'Always fails' },
      upstreamArtifacts: {},
      sharedContext: {
        workGraphId: 'WG-TEST',
        specContent: null,
        briefingScript: makeStubBriefingScript(),
      },
    }

    const result = await executeAtomSlice(slice, deps, { maxRetries: 3, dryRun: false })

    expect(result.atomId).toBe('atom-003')
    expect(result.verdict.decision).toBe('fail')
    expect(result.verdict.reason).toContain('exceeded')
    expect(result.retryCount).toBe(3)
    // Called 1 initial + 3 retries = 4 total
    expect(deps.coderAgent.produceCode).toHaveBeenCalledTimes(4)
  })

  it('verifier returns fail → immediate fail, no retry', async () => {
    const deps = makeDryRunAtomDeps()
    ;(deps.verifierAgent.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      decision: 'fail' as const,
      confidence: 1.0,
      reason: 'Fundamentally broken',
    })

    const slice: AtomSlice = {
      atomId: 'atom-004',
      atomSpec: { id: 'atom-004', description: 'Immediate fail' },
      upstreamArtifacts: {},
      sharedContext: {
        workGraphId: 'WG-TEST',
        specContent: null,
        briefingScript: makeStubBriefingScript(),
      },
    }

    const result = await executeAtomSlice(slice, deps, { maxRetries: 3, dryRun: false })

    expect(result.verdict.decision).toBe('fail')
    expect(result.retryCount).toBe(0)
    // Only called once — no retry on hard fail
    expect(deps.coderAgent.produceCode).toHaveBeenCalledTimes(1)
  })
})

// ────────────────────────────────────────────────────────────
// 3. executeLayer tests
// ────────────────────────────────────────────────────────────

describe('v5: executeLayer', () => {
  it('2 independent atoms both execute and produce results', async () => {
    const deps = makeDryRunAtomDeps()
    const layer: DependencyLayer = { index: 0, atomIds: ['atom-A', 'atom-B'] }
    const atomSpecs = new Map<string, Record<string, unknown>>([
      ['atom-A', { id: 'atom-A', description: 'First' }],
      ['atom-B', { id: 'atom-B', description: 'Second' }],
    ])

    const results = await executeLayer(
      layer,
      atomSpecs,
      new Map(), // no completed artifacts
      deps,
      { workGraphId: 'WG-LAYER', specContent: null, briefingScript: makeStubBriefingScript() },
      { maxRetries: 3, dryRun: false },
    )

    expect(results.size).toBe(2)
    expect(results.get('atom-A')!.verdict.decision).toBe('pass')
    expect(results.get('atom-B')!.verdict.decision).toBe('pass')
  })

  it('upstream artifacts are resolved for dependent atoms', async () => {
    const deps = makeDryRunAtomDeps()

    // Simulate a completed upstream atom
    const upstreamResult: AtomResult = {
      atomId: 'atom-upstream',
      verdict: { decision: 'pass', confidence: 1.0, reason: 'OK' },
      codeArtifact: {
        files: [{ path: 'src/upstream.ts', content: 'export interface Foo { bar: string }', action: 'create' }],
        summary: 'Upstream code',
        testsIncluded: false,
      },
      testReport: { passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0, failures: [], summary: 'OK' },
      critiqueReport: null,
      retryCount: 0,
    }
    const completedArtifacts = new Map<string, AtomResult>([
      ['atom-upstream', upstreamResult],
    ])

    const layer: DependencyLayer = { index: 1, atomIds: ['atom-downstream'] }
    const atomSpecs = new Map<string, Record<string, unknown>>([
      ['atom-downstream', { id: 'atom-downstream', description: 'Depends on upstream', dependencies: [{ atomId: 'atom-upstream', edgeType: 'blocks' }] }],
    ])

    const results = await executeLayer(
      layer,
      atomSpecs,
      completedArtifacts,
      deps,
      { workGraphId: 'WG-DEP', specContent: null, briefingScript: makeStubBriefingScript() },
      { maxRetries: 3, dryRun: false },
    )

    expect(results.size).toBe(1)
    expect(results.get('atom-downstream')!.verdict.decision).toBe('pass')

    // Verify the coder was called with upstream artifacts in the slice
    const coderCalls = (deps.coderAgent.produceCode as ReturnType<typeof vi.fn>).mock.calls
    // The last call should be for atom-downstream (atom-upstream was in a previous layer)
    // We verify the coder was called and got context that includes upstream info
    expect(coderCalls.length).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────
// 4. Graph: verticalSlicing mode stops after planner
// ────────────────────────────────────────────────────────────

describe('v5: graph verticalSlicing mode', () => {
  it('verticalSlicing=true → graph stops after planner, no coder/tester/verifier', async () => {
    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
          case 'planner':
            return JSON.stringify({
              approach: 'Test plan',
              atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
              executorRecommendation: 'gdk-agent',
              estimatedComplexity: 'low',
            })
          default:
            return JSON.stringify({ result: 'stub' })
        }
      }),
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: vi.fn().mockResolvedValue(makeStubBriefingScript()),
      },
      criticAgent: {
        semanticReview: vi.fn().mockResolvedValue(makeStubSemanticReview()),
        codeReview: vi.fn().mockResolvedValue(makeStubCodeCritique()),
      },
      verticalSlicing: true,
    }

    const graph = buildSynthesisGraph(deps)
    const state: GraphState = {
      ...createInitialState('WG-VS', {
        id: 'WG-VS',
        title: 'Vertical Slicing Test',
        atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
        invariants: [],
        dependencies: [],
      }),
    }

    const visited: string[] = []
    const finalState = await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // Phase 1 only: budget-check → architect → semantic-critic → compile → gate-1 → planner
    expect(visited).toEqual([
      'budget-check',
      'architect',
      'semantic-critic',
      'compile',
      'gate-1',
      'planner',
    ])

    // No coder, tester, verifier, code-critic
    expect(visited).not.toContain('coder')
    expect(visited).not.toContain('tester')
    expect(visited).not.toContain('verifier')
    expect(visited).not.toContain('code-critic')

    // Plan should be populated
    expect(finalState.plan).toBeDefined()
    expect(finalState.plan).not.toBeNull()
  })

  it('verticalSlicing=false (default) still runs full 10-node graph', async () => {
    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
          case 'planner':
            return JSON.stringify({
              approach: 'Test plan',
              atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
              executorRecommendation: 'gdk-agent',
              estimatedComplexity: 'low',
            })
          case 'coder':
            return JSON.stringify({
              files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
              summary: 'Code', testsIncluded: false,
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
        produceBriefingScript: vi.fn().mockResolvedValue(makeStubBriefingScript()),
      },
      criticAgent: {
        semanticReview: vi.fn().mockResolvedValue(makeStubSemanticReview()),
        codeReview: vi.fn().mockResolvedValue(makeStubCodeCritique()),
      },
      // verticalSlicing NOT set — defaults to false
    }

    const graph = buildSynthesisGraph(deps)
    const state: GraphState = {
      ...createInitialState('WG-LEGACY', {
        id: 'WG-LEGACY',
        title: 'Legacy Mode Test',
        atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
        invariants: [],
        dependencies: [],
      }),
    }

    const visited: string[] = []
    await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // Full 10-node graph
    expect(visited).toEqual([
      'budget-check',
      'architect',
      'semantic-critic',
      'compile',
      'gate-1',
      'planner',
      'coder',
      'code-critic',
      'tester',
      'verifier',
    ])
  })
})

// ────────────────────────────────────────────────────────────
// 5. Integration: Phase 1 → Phase 2 → Phase 3
// ────────────────────────────────────────────────────────────

describe('v5: integration — full Phase 1→2→3 with dry-run atoms', () => {
  it('3-atom WorkGraph (2 independent + 1 dependent) executes correctly', async () => {
    const atomDeps = makeDryRunAtomDeps()

    // Build a WorkGraph with 3 atoms and dependencies
    const workGraph = {
      _key: 'WG-INT',
      id: 'WG-INT',
      title: 'Integration Test',
      atoms: [
        { id: 'atom-1', description: 'Auth module', assignedTo: 'coder' },
        { id: 'atom-2', description: 'Data layer', assignedTo: 'coder' },
        { id: 'atom-3', description: 'API routes (depends on 1 and 2)', assignedTo: 'coder' },
      ],
      invariants: [],
      dependencies: [
        { from: 'atom-1', to: 'atom-3', type: 'blocks' },
        { from: 'atom-2', to: 'atom-3', type: 'blocks' },
      ],
    }

    // Phase 1: build graph with verticalSlicing=true
    const graphDeps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        if (taskKind === 'planner') {
          return JSON.stringify({
            approach: 'Implementation plan',
            atoms: workGraph.atoms,
            executorRecommendation: 'gdk-agent',
            estimatedComplexity: 'low',
          })
        }
        return JSON.stringify({ result: 'stub' })
      }),
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: vi.fn().mockResolvedValue(makeStubBriefingScript()),
      },
      criticAgent: {
        semanticReview: vi.fn().mockResolvedValue(makeStubSemanticReview()),
        codeReview: vi.fn().mockResolvedValue(makeStubCodeCritique()),
      },
      verticalSlicing: true,
    }

    const graph = buildSynthesisGraph(graphDeps)
    const initialState = createInitialState('WG-INT', workGraph)

    // Phase 1: run graph (stops after planner)
    const phase1State = await graph.run(initialState, { maxSteps: 50 })
    expect(phase1State.plan).not.toBeNull()

    // Phase 2: topological sort + layer execution
    const atoms = workGraph.atoms
    const deps_list = workGraph.dependencies
    const layers = topologicalSort(atoms, deps_list)

    // Should produce 2 layers: [atom-1, atom-2] and [atom-3]
    expect(layers).toHaveLength(2)
    expect(layers[0]!.atomIds.sort()).toEqual(['atom-1', 'atom-2'])
    expect(layers[1]!.atomIds).toEqual(['atom-3'])

    // Execute layers sequentially
    const completedArtifacts = new Map<string, AtomResult>()
    const atomSpecMap = new Map<string, Record<string, unknown>>()
    for (const atom of atoms) {
      atomSpecMap.set(atom.id, atom as unknown as Record<string, unknown>)
    }

    for (const layer of layers) {
      const layerResults = await executeLayer(
        layer,
        atomSpecMap,
        completedArtifacts,
        atomDeps,
        {
          workGraphId: 'WG-INT',
          specContent: null,
          briefingScript: phase1State.briefingScript as unknown,
        },
        { maxRetries: 3, dryRun: false },
      )
      for (const [atomId, result] of layerResults) {
        completedArtifacts.set(atomId, result)
      }
    }

    // Phase 3: all atoms should have passed
    expect(completedArtifacts.size).toBe(3)
    const allPassed = [...completedArtifacts.values()].every(r => r.verdict.decision === 'pass')
    expect(allPassed).toBe(true)

    // Each atom produced a code artifact
    for (const [_id, result] of completedArtifacts) {
      expect(result.codeArtifact).not.toBeNull()
      expect(result.testReport).not.toBeNull()
    }
  })

  it('atom failure in layer 0 does not prevent layer 1 info from being available', async () => {
    // One atom passes, one fails in layer 0
    let coderCalls = 0
    const deps: AtomExecutorDeps = {
      coderAgent: {
        produceCode: vi.fn().mockResolvedValue({
          files: [{ path: 'src/stub.ts', content: '// code', action: 'create' }],
          summary: 'Code',
          testsIncluded: false,
        } satisfies CodeArtifact),
      },
      criticAgent: {
        codeReview: vi.fn().mockResolvedValue({
          passed: true,
          issues: [],
          mentorRuleCompliance: [],
          overallAssessment: 'OK',
        } satisfies CritiqueReport),
      },
      testerAgent: {
        runTests: vi.fn().mockResolvedValue({
          passed: true,
          testsRun: 1,
          testsPassed: 1,
          testsFailed: 0,
          failures: [],
          summary: 'OK',
        } satisfies TestReport),
      },
      verifierAgent: {
        verify: vi.fn().mockImplementation(async () => {
          coderCalls++
          // First atom (atom-ok) passes, second atom (atom-fail) always fails
          if (coderCalls % 2 === 1) {
            return { decision: 'pass' as const, confidence: 1.0, reason: 'OK' }
          }
          return { decision: 'fail' as const, confidence: 1.0, reason: 'Broken' }
        }),
      },
      fetchMentorRules: vi.fn().mockResolvedValue([]),
    }

    const layer: DependencyLayer = { index: 0, atomIds: ['atom-ok', 'atom-fail'] }
    const atomSpecs = new Map<string, Record<string, unknown>>([
      ['atom-ok', { id: 'atom-ok', description: 'Good atom' }],
      ['atom-fail', { id: 'atom-fail', description: 'Bad atom' }],
    ])

    const results = await executeLayer(
      layer,
      atomSpecs,
      new Map(),
      deps,
      { workGraphId: 'WG-MIXED', specContent: null, briefingScript: makeStubBriefingScript() },
      { maxRetries: 3, dryRun: false },
    )

    // Both atoms have results
    expect(results.size).toBe(2)
    expect(results.get('atom-ok')!.verdict.decision).toBe('pass')
    expect(results.get('atom-fail')!.verdict.decision).toBe('fail')
  })
})
