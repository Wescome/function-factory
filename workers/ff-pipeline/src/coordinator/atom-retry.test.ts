/**
 * v4.1 Commit 2: Per-atom retry isolation tests.
 *
 * The monolithic 10-node graph stays the same, but when the Verifier
 * returns `patch` with `failedAtomIds`, only those atoms are re-planned
 * and re-coded on the next iteration.
 *
 * Tests:
 *   1. Verdict with failedAtomIds passes them through to state
 *   2. Budget-check preserves failedAtomIds in state
 *   3. Planner receives failedAtomIds when present
 *   4. Full graph run: first pass all atoms, verifier patches with 1 atom,
 *      second pass only re-plans that atom
 */
import { describe, it, expect, vi } from 'vitest'
import { buildSynthesisGraph, type GraphDeps } from './graph.js'
import { createInitialState, type GraphState, type Verdict } from './state.js'
import type { BriefingScript } from '../agents/architect-agent.js'
import type { SemanticReviewResult } from '../types.js'
import type { CritiqueReport, Plan, CodeArtifact, TestReport } from './state.js'
import type { PlannerInput } from '../agents/planner-agent.js'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    ...createInitialState('WG-RETRY', {
      id: 'WG-RETRY',
      title: 'Atom Retry Test',
      atoms: [
        { id: 'atom-001', description: 'Auth module', assignedTo: 'coder' },
        { id: 'atom-002', description: 'Data layer', assignedTo: 'coder' },
        { id: 'atom-003', description: 'API routes', assignedTo: 'coder' },
      ],
      invariants: [],
      dependencies: [],
    }),
    ...overrides,
  }
}

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

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('v4.1 Commit 2: Per-atom retry isolation', () => {

  // ──────────────────────────────────────────────────────────
  // Test 1: Verdict with failedAtomIds passes through to state
  // ──────────────────────────────────────────────────────────

  it('verdict with failedAtomIds is stored in GraphState', async () => {
    const verifierAgent = {
      verify: vi.fn().mockResolvedValue({
        decision: 'patch' as const,
        confidence: 0.6,
        reason: 'atom-002 has broken tests',
        notes: 'Fix the data layer',
        failedAtomIds: ['atom-002'],
      } satisfies Verdict),
    }

    // Use a plannerAgent so we can track calls
    const plannerAgent = {
      producePlan: vi.fn().mockResolvedValue({
        approach: 'Test plan',
        atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      } as Plan),
    }

    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
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
      plannerAgent,
      verifierAgent,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    // Run the graph — the verifier returns patch with failedAtomIds,
    // then budget-check routes back to planner. On second iteration
    // we need the verifier to pass to avoid infinite loop.
    let verifierCalls = 0
    verifierAgent.verify.mockImplementation(async () => {
      verifierCalls++
      if (verifierCalls === 1) {
        return {
          decision: 'patch' as const,
          confidence: 0.6,
          reason: 'atom-002 has broken tests',
          notes: 'Fix the data layer',
          failedAtomIds: ['atom-002'],
        }
      }
      return {
        decision: 'pass' as const,
        confidence: 1.0,
        reason: 'All good',
      }
    })

    const finalState = await graph.run(state, { maxSteps: 50 })

    // After verifier returns patch with failedAtomIds, the state
    // should have failedAtomIds set
    expect(finalState.verdict?.decision).toBe('pass')
    // The persist calls should show failedAtomIds was in state at some point
    const verifierPersistCalls = (deps.persistState as ReturnType<typeof vi.fn>).mock.calls
      .filter((call: unknown[]) => call[1] === 'verifier')
    expect(verifierPersistCalls.length).toBe(2)
    const firstVerifierState = verifierPersistCalls[0]![0] as GraphState
    expect(firstVerifierState.verdict?.failedAtomIds).toEqual(['atom-002'])
    expect(firstVerifierState.failedAtomIds).toEqual(['atom-002'])
  })

  // ──────────────────────────────────────────────────────────
  // Test 2: Budget-check preserves failedAtomIds in state
  // ──────────────────────────────────────────────────────────

  it('budget-check preserves failedAtomIds in state (does not clear them)', async () => {
    let verifierCalls = 0
    const verifierAgent = {
      verify: vi.fn().mockImplementation(async () => {
        verifierCalls++
        if (verifierCalls === 1) {
          return {
            decision: 'patch' as const,
            confidence: 0.6,
            reason: 'atom-003 broken',
            failedAtomIds: ['atom-003'],
          }
        }
        return { decision: 'pass' as const, confidence: 1.0, reason: 'OK' }
      }),
    }

    const persistState = vi.fn().mockResolvedValue(undefined)

    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
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
          default:
            return JSON.stringify({ result: 'stub' })
        }
      }),
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: vi.fn().mockResolvedValue(makeStubBriefingScript()),
      },
      criticAgent: {
        semanticReview: vi.fn().mockResolvedValue(makeStubSemanticReview()),
        codeReview: vi.fn().mockResolvedValue(makeStubCodeCritique()),
      },
      verifierAgent,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    await graph.run(state, { maxSteps: 50 })

    // Find the planner persist call from the SECOND iteration (the repair)
    // The repair planner call happens after budget-check routes back to planner
    const plannerPersistCalls = persistState.mock.calls
      .filter((call: unknown[]) => call[1] === 'planner')
    // There should be 2 planner calls: first pass + repair
    expect(plannerPersistCalls.length).toBe(2)

    // The second planner call should still have failedAtomIds in state
    // because budget-check preserved them
    const repairPlannerState = plannerPersistCalls[1]![0] as GraphState
    expect(repairPlannerState.failedAtomIds).toEqual(['atom-003'])
  })

  // ──────────────────────────────────────────────────────────
  // Test 3: Planner receives failedAtomIds when present
  // ──────────────────────────────────────────────────────────

  it('planner receives failedAtomIds in its input when present', async () => {
    let verifierCalls = 0
    const verifierAgent = {
      verify: vi.fn().mockImplementation(async () => {
        verifierCalls++
        if (verifierCalls === 1) {
          return {
            decision: 'patch' as const,
            confidence: 0.6,
            reason: 'atom-002 broken',
            notes: 'Fix data layer query',
            failedAtomIds: ['atom-002'],
          }
        }
        return { decision: 'pass' as const, confidence: 1.0, reason: 'OK' }
      }),
    }

    const plannerAgent = {
      producePlan: vi.fn().mockResolvedValue({
        approach: 'Test plan',
        atoms: [
          { id: 'atom-001', description: 'Auth module', assignedTo: 'coder' },
          { id: 'atom-002', description: 'Data layer', assignedTo: 'coder' },
          { id: 'atom-003', description: 'API routes', assignedTo: 'coder' },
        ],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      } as Plan),
    }

    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
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
      plannerAgent,
      verifierAgent,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    await graph.run(state, { maxSteps: 50 })

    // PlannerAgent.producePlan should be called twice
    expect(plannerAgent.producePlan).toHaveBeenCalledTimes(2)

    // First call: no failedAtomIds (initial pass)
    const firstCall = plannerAgent.producePlan.mock.calls[0]![0] as PlannerInput
    expect(firstCall.failedAtomIds).toBeUndefined()

    // Second call: repair pass — should have failedAtomIds
    const secondCall = plannerAgent.producePlan.mock.calls[1]![0] as PlannerInput
    expect(secondCall.failedAtomIds).toEqual(['atom-002'])
  })

  // ──────────────────────────────────────────────────────────
  // Test 4: Full graph run — verifier patches 1 atom, only
  //          that atom is re-planned
  // ──────────────────────────────────────────────────────────

  it('full graph run: verifier patches with 1 atom, second pass only re-plans that atom', async () => {
    let verifierCalls = 0
    const verifierAgent = {
      verify: vi.fn().mockImplementation(async () => {
        verifierCalls++
        if (verifierCalls === 1) {
          return {
            decision: 'patch' as const,
            confidence: 0.5,
            reason: 'atom-002 failed verification',
            notes: 'Fix the query builder in atom-002',
            failedAtomIds: ['atom-002'],
          }
        }
        return { decision: 'pass' as const, confidence: 1.0, reason: 'All atoms pass' }
      }),
    }

    const plannerAgent = {
      producePlan: vi.fn().mockResolvedValue({
        approach: 'Full plan',
        atoms: [
          { id: 'atom-001', description: 'Auth module', assignedTo: 'coder' },
          { id: 'atom-002', description: 'Data layer', assignedTo: 'coder' },
          { id: 'atom-003', description: 'API routes', assignedTo: 'coder' },
        ],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'medium',
      } as Plan),
    }

    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
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
      plannerAgent,
      verifierAgent,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    const visited: string[] = []
    const finalState = await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // Graph should complete with pass
    expect(finalState.verdict?.decision).toBe('pass')

    // Two full loops: first pass (10 nodes) + repair (6 nodes: budget-check -> planner -> coder -> code-critic -> tester -> verifier)
    expect(visited).toEqual([
      // First pass
      'budget-check', 'architect', 'semantic-critic', 'compile', 'gate-1',
      'planner', 'coder', 'code-critic', 'tester', 'verifier',
      // Repair loop
      'budget-check', 'planner', 'coder', 'code-critic', 'tester', 'verifier',
    ])

    // The planner was called twice
    expect(plannerAgent.producePlan).toHaveBeenCalledTimes(2)

    // Second planner call should receive failedAtomIds
    const repairInput = plannerAgent.producePlan.mock.calls[1]![0] as PlannerInput
    expect(repairInput.failedAtomIds).toEqual(['atom-002'])
    expect(repairInput.repairNotes).toBe('Fix the query builder in atom-002')

    // failedAtomIds should be cleared after successful pass
    expect(finalState.failedAtomIds).toBeNull()
  })

  // ──────────────────────────────────────────────────────────
  // Test 5: Verdict without failedAtomIds (backward compat)
  //          behaves identically to current behavior
  // ──────────────────────────────────────────────────────────

  it('verdict patch WITHOUT failedAtomIds still retries all atoms (backward compat)', async () => {
    let verifierCalls = 0
    const verifierAgent = {
      verify: vi.fn().mockImplementation(async () => {
        verifierCalls++
        if (verifierCalls === 1) {
          return {
            decision: 'patch' as const,
            confidence: 0.6,
            reason: 'Needs improvements',
            notes: 'General fix needed',
            // NO failedAtomIds
          }
        }
        return { decision: 'pass' as const, confidence: 1.0, reason: 'OK' }
      }),
    }

    const plannerAgent = {
      producePlan: vi.fn().mockResolvedValue({
        approach: 'Test plan',
        atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      } as Plan),
    }

    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
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
      plannerAgent,
      verifierAgent,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    const finalState = await graph.run(state, { maxSteps: 50 })

    expect(finalState.verdict?.decision).toBe('pass')

    // Planner called twice, but second call should NOT have failedAtomIds
    const secondCall = plannerAgent.producePlan.mock.calls[1]![0] as PlannerInput
    expect(secondCall.failedAtomIds).toBeUndefined()
  })

  // ──────────────────────────────────────────────────────────
  // Test 6: failedAtomIds appears in GraphState initial state
  // ──────────────────────────────────────────────────────────

  it('createInitialState sets failedAtomIds to null', () => {
    const state = createInitialState('WG-001', { id: 'WG-001' })
    expect(state.failedAtomIds).toBeNull()
  })

  // ──────────────────────────────────────────────────────────
  // Test 7: Multiple failedAtomIds
  // ──────────────────────────────────────────────────────────

  it('multiple failedAtomIds are all passed through to planner', async () => {
    let verifierCalls = 0
    const verifierAgent = {
      verify: vi.fn().mockImplementation(async () => {
        verifierCalls++
        if (verifierCalls === 1) {
          return {
            decision: 'patch' as const,
            confidence: 0.4,
            reason: 'Two atoms failed',
            notes: 'Fix atom-001 and atom-003',
            failedAtomIds: ['atom-001', 'atom-003'],
          }
        }
        return { decision: 'pass' as const, confidence: 1.0, reason: 'OK' }
      }),
    }

    const plannerAgent = {
      producePlan: vi.fn().mockResolvedValue({
        approach: 'Test plan',
        atoms: [
          { id: 'atom-001', description: 'Auth', assignedTo: 'coder' },
          { id: 'atom-002', description: 'Data', assignedTo: 'coder' },
          { id: 'atom-003', description: 'API', assignedTo: 'coder' },
        ],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      } as Plan),
    }

    const deps: GraphDeps = {
      callModel: vi.fn().mockImplementation(async (taskKind: string) => {
        switch (taskKind) {
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
      plannerAgent,
      verifierAgent,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    await graph.run(state, { maxSteps: 50 })

    const repairInput = plannerAgent.producePlan.mock.calls[1]![0] as PlannerInput
    expect(repairInput.failedAtomIds).toEqual(['atom-001', 'atom-003'])
  })
})
