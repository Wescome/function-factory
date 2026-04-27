/**
 * T7: Coordinator integration tests — executionRole wiring.
 *
 * Tests that:
 * 1. coordinator builds deps with executionRole
 * 2. dry-run still works (executionRole uses stub path)
 * 3. live mode with sandbox stubs falls back to piAiRole (no crash)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphDeps } from './graph.js'
import type { SandboxDeps } from './sandbox-role.js'
import { makeExecutionRole } from './sandbox-role.js'
import { buildSynthesisGraph } from './graph.js'
import { createInitialState, type GraphState } from './state.js'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    ...createInitialState('WG-T7', {
      id: 'WG-T7',
      title: 'T7 Integration Test',
      atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
      invariants: [],
      dependencies: [],
    }),
    ...overrides,
  }
}

function makeStubCallModel() {
  return vi.fn().mockImplementation(async (taskKind: string) => {
    switch (taskKind) {
      case 'planner':
        return JSON.stringify({
          approach: 'Test plan',
          atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
          executorRecommendation: 'pi-sdk',
          estimatedComplexity: 'low',
        })
      case 'coder':
        return JSON.stringify({
          files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
          summary: 'Code via callModel fallback',
          testsIncluded: false,
        })
      case 'critic':
        return JSON.stringify({
          passed: true,
          issues: [],
          mentorRuleCompliance: [],
          overallAssessment: 'OK',
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
  })
}

/** Creates SandboxDeps that throw — simulating "sandbox not yet deployed" */
function makeThrowingSandboxDeps(): SandboxDeps {
  return {
    execInSandbox: vi.fn().mockRejectedValue(
      new Error('Sandbox not yet deployed — falling back to piAiRole'),
    ),
    prepareWorkspace: vi.fn().mockRejectedValue(
      new Error('Sandbox not yet deployed'),
    ),
    createBackup: vi.fn().mockResolvedValue(''),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
  }
}

// ────────────────────────────────────────────────────────────
// T7.1: Coordinator builds deps with executionRole
// ────────────────────────────────────────────────────────────

describe('T7: coordinator executionRole wiring', () => {
  it('builds GraphDeps with executionRole from makeExecutionRole', () => {
    const callModel = makeStubCallModel()
    const persistState = vi.fn().mockResolvedValue(undefined)
    const fetchMentorRules = vi.fn().mockResolvedValue([])

    const executionRole = makeExecutionRole({
      dryRun: false,
      sandboxDeps: makeThrowingSandboxDeps(),
      callModel,
      persistState,
      fetchMentorRules,
    })

    const deps: GraphDeps = {
      callModel,
      persistState,
      fetchMentorRules,
      executionRole,
    }

    // executionRole is present and callable
    expect(deps.executionRole).toBeDefined()
    expect(typeof deps.executionRole).toBe('function')

    // Returns a function for 'coder' and 'tester'
    expect(typeof deps.executionRole!('coder')).toBe('function')
    expect(typeof deps.executionRole!('tester')).toBe('function')
  })

  // ────────────────────────────────────────────────────────────
  // T7.2: Dry-run still works (executionRole uses stub path)
  // ────────────────────────────────────────────────────────────

  it('dry-run with executionRole: coder/tester use dry-run stubs, not sandbox', async () => {
    const callModel = makeStubCallModel()
    const persistState = vi.fn().mockResolvedValue(undefined)
    const fetchMentorRules = vi.fn().mockResolvedValue([])
    const sandboxDeps = makeThrowingSandboxDeps()

    const executionRole = makeExecutionRole({
      dryRun: true,
      sandboxDeps,
      callModel,
      persistState,
      fetchMentorRules,
    })

    const graph = buildSynthesisGraph({
      callModel,
      persistState,
      fetchMentorRules,
      executionRole,
    })

    const state = makeState()
    const finalState = await graph.run(state, { maxSteps: 50 })

    // Verdict should be pass (dry-run)
    expect(finalState.verdict).toBeDefined()
    expect(finalState.verdict!.decision).toBe('pass')

    // Coder went through dry-run path
    expect(finalState.code).toBeDefined()
    expect(finalState.code!.summary).toContain('Dry-run')

    // Tester went through dry-run path
    expect(finalState.tests).toBeDefined()
    expect(finalState.tests!.passed).toBe(true)

    // Sandbox was never touched
    expect(sandboxDeps.execInSandbox).not.toHaveBeenCalled()
    expect(sandboxDeps.prepareWorkspace).not.toHaveBeenCalled()

    // callModel was only used for planner, critic, verifier (3 calls)
    expect(callModel).toHaveBeenCalledTimes(3)
  })

  // ────────────────────────────────────────────────────────────
  // T7.3: Live mode with throwing sandbox falls back to callModel
  // ────────────────────────────────────────────────────────────

  it('live mode with sandbox stubs: falls back to piAiRole via callModel (no crash)', async () => {
    const callModel = makeStubCallModel()
    const persistState = vi.fn().mockResolvedValue(undefined)
    const fetchMentorRules = vi.fn().mockResolvedValue([])
    const sandboxDeps = makeThrowingSandboxDeps()

    const executionRole = makeExecutionRole({
      dryRun: false, // live mode
      sandboxDeps,   // will throw
      callModel,
      persistState,
      fetchMentorRules,
    })

    const graph = buildSynthesisGraph({
      callModel,
      persistState,
      fetchMentorRules,
      executionRole,
    })

    const state = makeState()
    const finalState = await graph.run(state, { maxSteps: 50 })

    // Should complete without crashing
    expect(finalState.verdict).toBeDefined()
    expect(finalState.verdict!.decision).toBe('pass')

    // Sandbox was attempted but failed
    expect(sandboxDeps.execInSandbox).toHaveBeenCalled()

    // Fallback to callModel was used for coder and tester
    // callModel should have been called for all 5 roles:
    // planner(1) + coder-fallback(1) + critic(1) + tester-fallback(1) + verifier(1) = 5
    expect(callModel).toHaveBeenCalledTimes(5)

    // Code and tests still populated via fallback
    expect(finalState.code).toBeDefined()
    expect(finalState.tests).toBeDefined()
  })

  // ────────────────────────────────────────────────────────────
  // T7.4: buildSandboxDeps returns proper SandboxDeps shape
  // ────────────────────────────────────────────────────────────

  it('throwing SandboxDeps actually rejects when called (validates mock fidelity)', async () => {
    const deps = makeThrowingSandboxDeps()

    // execInSandbox must reject with a descriptive error
    await expect(deps.execInSandbox('{}'))
      .rejects.toThrow('Sandbox not yet deployed')

    // prepareWorkspace must reject
    await expect(deps.prepareWorkspace({ repoUrl: '', ref: '', branch: '' }))
      .rejects.toThrow('Sandbox not yet deployed')

    // createBackup must resolve (non-throwing even when sandbox is down)
    await expect(deps.createBackup('/workspace')).resolves.toBe('')

    // restoreBackup must resolve
    await expect(deps.restoreBackup('')).resolves.toBeUndefined()
  })

  // ────────────────────────────────────────────────────────────
  // T7.5: executionRole is optional (backward compat preserved)
  // ────────────────────────────────────────────────────────────

  it('graph works without executionRole (backward compat)', async () => {
    const callModel = makeStubCallModel()

    const graph = buildSynthesisGraph({
      callModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      // NO executionRole
    })

    const state = makeState()
    const finalState = await graph.run(state, { maxSteps: 50 })

    // All 5 roles use callModel
    expect(callModel).toHaveBeenCalledTimes(5)
    expect(finalState.verdict!.decision).toBe('pass')
  })
})
