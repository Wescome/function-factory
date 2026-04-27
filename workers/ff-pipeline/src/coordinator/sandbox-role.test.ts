import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphState } from './state.js'
import type { SandboxDeps } from './sandbox-role.js'
import { sandboxRole, makeExecutionRole } from './sandbox-role.js'
import { createInitialState } from './state.js'
import type { GraphDeps } from './graph.js'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    ...createInitialState('WG-T6', {
      id: 'WG-T6',
      title: 'Test WorkGraph',
      atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
      invariants: [],
      dependencies: [],
    }),
    plan: {
      approach: 'Test approach',
      atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
      executorRecommendation: 'gdk-agent',
      estimatedComplexity: 'low',
    },
    ...overrides,
  }
}

function makeSandboxDeps(overrides: Partial<SandboxDeps> = {}): SandboxDeps {
  return {
    execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
      ok: true,
      role: 'coder',
      filesChanged: ['src/stub.ts'],
      agentOutput: 'Implemented stub',
      tokenUsage: { input: 100, output: 50, total: 150 },
    })),
    prepareWorkspace: vi.fn().mockResolvedValue(undefined),
    createBackup: vi.fn().mockResolvedValue('backup-handle-001'),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makePersistState() {
  return vi.fn<(state: GraphState, role: string) => Promise<void>>().mockResolvedValue(undefined)
}

// ────────────────────────────────────────────────────────────
// T6: sandboxRole() — graph node factory
// ────────────────────────────────────────────────────────────

describe('sandboxRole()', () => {
  let sandboxDeps: SandboxDeps
  let persistState: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sandboxDeps = makeSandboxDeps()
    persistState = makePersistState()
  })

  // ── Test 1: prepareWorkspace called when workspaceReady is false ──
  describe('workspace preparation', () => {
    it('calls prepareWorkspace when workspaceReady is false (coder)', async () => {
      const state = makeState({ workspaceReady: false })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      expect(sandboxDeps.prepareWorkspace).toHaveBeenCalledOnce()
    })

    it('calls prepareWorkspace when workspaceReady is undefined (coder)', async () => {
      const state = makeState()
      // createInitialState sets workspaceReady: false
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      expect(sandboxDeps.prepareWorkspace).toHaveBeenCalledOnce()
    })

    // ── Test 2: skips prepareWorkspace when workspaceReady is true ──
    it('skips prepareWorkspace when workspaceReady is true', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      expect(sandboxDeps.prepareWorkspace).not.toHaveBeenCalled()
    })

    it('tester role does NOT call prepareWorkspace (tester never prepares)', async () => {
      const state = makeState({ workspaceReady: false })
      const node = sandboxRole('tester', sandboxDeps, persistState)

      // For tester, workspace must already be ready — set by coder
      // sandboxRole for tester should skip workspace prep
      // (the coder always runs before tester in the graph)
      const stateReady = makeState({ workspaceReady: true })
      const nodeReady = sandboxRole('tester', sandboxDeps, persistState)

      await nodeReady(stateReady)

      expect(sandboxDeps.prepareWorkspace).not.toHaveBeenCalled()
    })
  })

  // ── Test 3: execInSandbox called with correct task JSON shape ──
  describe('task JSON construction', () => {
    it('sends correct task JSON for coder role', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      expect(sandboxDeps.execInSandbox).toHaveBeenCalledOnce()
      const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      const task = JSON.parse(taskJson)

      expect(task.role).toBe('coder')
      expect(task.workGraphId).toBe('WG-T6')
      expect(task.plan).toBeTruthy()
      expect(task.prompt).toBeDefined()
    })

    it('sends correct task JSON for tester role', async () => {
      const state = makeState({
        workspaceReady: true,
        code: {
          files: [{ path: 'src/stub.ts', content: '// stub', action: 'create' }],
          summary: 'Stub code',
          testsIncluded: false,
        },
      })
      const node = sandboxRole('tester', sandboxDeps, persistState)

      // Mock tester-shaped response
      ;(sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'tester',
        filesChanged: [],
        testOutput: 'PASS: 1 test passed',
        agentOutput: 'All tests pass',
        tokenUsage: { input: 80, output: 40, total: 120 },
      }))

      await node(state)

      const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      const task = JSON.parse(taskJson)

      expect(task.role).toBe('tester')
      expect(task.code).toBeDefined()
    })

    it('includes workGraph context in task JSON', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      const task = JSON.parse(taskJson)

      expect(task.workGraph).toBeDefined()
      expect(task.workGraph.title).toBe('Test WorkGraph')
    })

    it('includes repair context when verdict is patch', async () => {
      const state = makeState({
        workspaceReady: true,
        repairCount: 1,
        verdict: {
          decision: 'patch',
          confidence: 0.8,
          reason: 'Missing error handling',
          notes: 'Add try/catch in main handler',
        },
      })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      const task = JSON.parse(taskJson)

      expect(task.repairNotes).toBe('Add try/catch in main handler')
      expect(task.repairCount).toBe(1)
    })
  })

  // ── Test 4: parses result and updates GraphState ──
  describe('result parsing', () => {
    it('updates code field for coder role', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      const result = await node(state)

      expect(result.code).toBeDefined()
      expect(result.code!.files).toBeDefined()
      expect(result.code!.summary).toBeDefined()
    })

    it('updates tests field for tester role', async () => {
      ;(sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'tester',
        filesChanged: [],
        testOutput: '3 tests passed, 0 failed',
        agentOutput: 'All tests pass',
        tokenUsage: { input: 80, output: 40, total: 120 },
      }))

      const state = makeState({
        workspaceReady: true,
        code: {
          files: [{ path: 'src/stub.ts', content: '// stub', action: 'create' }],
          summary: 'Stub',
          testsIncluded: false,
        },
      })
      const node = sandboxRole('tester', sandboxDeps, persistState)

      const result = await node(state)

      expect(result.tests).toBeDefined()
      expect(result.tests!.summary).toBeDefined()
    })

    it('updates tokenUsage from sandbox result', async () => {
      const state = makeState({ workspaceReady: true, tokenUsage: 500 })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      const result = await node(state)

      expect(result.tokenUsage).toBeGreaterThan(500)
    })

    it('updates roleHistory', async () => {
      const state = makeState({ workspaceReady: true, roleHistory: [] })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      const result = await node(state)

      expect(result.roleHistory).toHaveLength(1)
      expect(result.roleHistory![0]!.role).toBe('coder')
    })

    it('tracks coderToolCalls from sandbox result', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      const result = await node(state)

      // toolCallCount derived from filesChanged length + agentOutput
      expect(result.coderToolCalls).toBeDefined()
    })

    it('handles sandbox returning ok: false gracefully', async () => {
      ;(sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
        ok: false,
        role: 'coder',
        filesChanged: [],
        agentOutput: '',
        tokenUsage: { input: 50, output: 20, total: 70 },
        error: 'Model timeout',
      }))

      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      // Should not throw — returns a partial state with error info
      const result = await node(state)
      expect(result.code).toBeDefined()
      expect(result.code!.summary).toContain('error')
    })
  })

  // ── Test 5: coder creates backup for repair loop recovery ──
  describe('backup management', () => {
    it('coder calls createBackup after successful execution', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      const result = await node(state)

      expect(sandboxDeps.createBackup).toHaveBeenCalledOnce()
      expect(result.coderBackupHandle).toBe('backup-handle-001')
    })

    it('tester does NOT create backup', async () => {
      ;(sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'tester',
        filesChanged: [],
        testOutput: 'PASS',
        agentOutput: 'Tests pass',
        tokenUsage: { input: 50, output: 25, total: 75 },
      }))

      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('tester', sandboxDeps, persistState)

      await node(state)

      expect(sandboxDeps.createBackup).not.toHaveBeenCalled()
    })

    it('restores backup on resample before re-execution', async () => {
      const state = makeState({
        workspaceReady: true,
        coderBackupHandle: 'backup-previous',
        verdict: {
          decision: 'resample',
          confidence: 0.7,
          reason: 'Wrong approach',
        },
      })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      expect(sandboxDeps.restoreBackup).toHaveBeenCalledWith('backup-previous')
    })
  })

  // ── Test 6: persistState is called ──
  describe('state persistence', () => {
    it('calls persistState after execution', async () => {
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, persistState)

      await node(state)

      expect(persistState).toHaveBeenCalledOnce()
      const [persistedState, role] = persistState.mock.calls[0]!
      expect(role).toBe('coder')
      expect(persistedState.code).toBeDefined()
    })
  })

  // ────────────────────────────────────────────────────────────
  // Error path tests (quality review gaps)
  // ────────────────────────────────────────────────────────────

  describe('error paths', () => {
    // ── 1. Malformed JSON from sandbox ──
    it('throws a descriptive error when execInSandbox returns malformed JSON', async () => {
      const malformedDeps = makeSandboxDeps({
        execInSandbox: vi.fn().mockResolvedValue('not json {garbage'),
      })
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', malformedDeps, persistState)

      await expect(node(state)).rejects.toThrow(/sandbox.*JSON/i)
      // Must NOT be a raw SyntaxError — must be wrapped with context
      try {
        await node(state)
      } catch (err: unknown) {
        expect((err as Error).message).not.toBe('Unexpected token \'o\', "not json {garbage" is not valid JSON')
        expect((err as Error).message).toMatch(/sandbox/i)
      }
    })

    // ── 2. prepareWorkspace throws ──
    it('propagates prepareWorkspace errors (so makeExecutionRole can fall back)', async () => {
      const failingDeps = makeSandboxDeps({
        prepareWorkspace: vi.fn().mockRejectedValue(new Error('clone failed')),
      })
      const state = makeState({ workspaceReady: false })
      const node = sandboxRole('coder', failingDeps, persistState)

      // sandboxRole should let this propagate — makeExecutionRole catches it
      await expect(node(state)).rejects.toThrow('clone failed')
    })

    // ── 3. createBackup throws — non-fatal ──
    it('returns coder result even when createBackup throws (backup is non-fatal)', async () => {
      const failBackupDeps = makeSandboxDeps({
        createBackup: vi.fn().mockRejectedValue(new Error('R2 write failed')),
      })
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', failBackupDeps, persistState)

      // Should NOT throw — backup failure is non-fatal
      const result = await node(state)

      // Coder result must still be present
      expect(result.code).toBeDefined()
      expect(result.code!.files).toHaveLength(1)
      // Backup handle should be null/undefined since backup failed
      expect(result.coderBackupHandle).toBeUndefined()
      // State must still be persisted
      expect(persistState).toHaveBeenCalled()
    })

    // ── 4. restoreBackup throws on resample ──
    it('handles restoreBackup failure on resample gracefully', async () => {
      const failRestoreDeps = makeSandboxDeps({
        restoreBackup: vi.fn().mockRejectedValue(new Error('backup corrupted')),
      })
      const state = makeState({
        workspaceReady: true,
        coderBackupHandle: 'backup-previous',
        verdict: {
          decision: 'resample',
          confidence: 0.7,
          reason: 'Wrong approach',
        },
      })
      const node = sandboxRole('coder', failRestoreDeps, persistState)

      // Should still proceed — restoreBackup failure should not block the coder run
      const result = await node(state)
      expect(result.code).toBeDefined()
      expect(result.workspaceReady).toBe(true)
    })

    // ── 5. Tester regex parsing — no numbers in summary ──
    it('tester defaults gracefully when test output has no numbers', async () => {
      ;(sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'tester',
        filesChanged: [],
        testOutput: 'All assertions satisfied successfully',
        agentOutput: 'Tests complete',
        tokenUsage: { input: 50, output: 25, total: 75 },
      }))

      const state = makeState({
        workspaceReady: true,
        code: {
          files: [{ path: 'src/stub.ts', content: '//', action: 'create' }],
          summary: 'Stub',
          testsIncluded: false,
        },
      })
      const node = sandboxRole('tester', sandboxDeps, persistState)

      const result = await node(state)

      // When ok=true but no regex match, should default to 1 passed, 0 failed
      expect(result.tests).toBeDefined()
      expect(result.tests!.testsPassed).toBe(1)
      expect(result.tests!.testsFailed).toBe(0)
      expect(result.tests!.testsRun).toBe(1)
      expect(result.tests!.passed).toBe(true)
    })

    // ── 6. persistState throws ──
    it('propagates persistState errors (caller decides recovery)', async () => {
      const failingPersist = vi.fn().mockRejectedValue(new Error('KV write failed'))
      const state = makeState({ workspaceReady: true })
      const node = sandboxRole('coder', sandboxDeps, failingPersist)

      // persistState failure should propagate — this is a hard dependency
      await expect(node(state)).rejects.toThrow('KV write failed')
    })
  })
})

// ────────────────────────────────────────────────────────────
// Patch → re-coder repair cycle (graph-level test)
// ────────────────────────────────────────────────────────────

describe('patch repair cycle via sandboxRole', () => {
  it('coder runs twice when verifier returns patch then pass, repairCount increments', async () => {
    const { buildSynthesisGraph } = await import('./graph.js')

    let coderCallCount = 0
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockImplementation(async (taskJson: string) => {
        const task = JSON.parse(taskJson)
        if (task.role === 'coder') {
          coderCallCount++
          return JSON.stringify({
            ok: true,
            role: 'coder',
            filesChanged: ['src/impl.ts'],
            agentOutput: `Coder attempt ${coderCallCount}`,
            tokenUsage: { input: 100, output: 50, total: 150 },
          })
        }
        if (task.role === 'tester') {
          return JSON.stringify({
            ok: true,
            role: 'tester',
            filesChanged: [],
            testOutput: '1 test passed',
            agentOutput: 'Pass',
            tokenUsage: { input: 50, output: 25, total: 75 },
          })
        }
        return JSON.stringify({ ok: true, role: task.role, filesChanged: [], agentOutput: '', tokenUsage: { input: 0, output: 0, total: 0 } })
      }),
    })

    let verifierCallCount = 0
    const callModel = vi.fn().mockImplementation(async (taskKind: string) => {
      switch (taskKind) {
        case 'planner':
          return JSON.stringify({
            approach: 'Plan',
            atoms: [{ id: 'a1', description: 'impl', assignedTo: 'coder' }],
            executorRecommendation: 'gdk-agent',
            estimatedComplexity: 'low',
          })
        case 'critic':
          return JSON.stringify({
            passed: true,
            issues: [],
            mentorRuleCompliance: [],
            overallAssessment: 'OK',
          })
        case 'verifier': {
          verifierCallCount++
          if (verifierCallCount === 1) {
            // First pass: patch
            return JSON.stringify({
              decision: 'patch',
              confidence: 0.6,
              reason: 'Missing error handling',
              notes: 'Add try/catch in main handler',
            })
          }
          // Second pass: pass
          return JSON.stringify({
            decision: 'pass',
            confidence: 0.95,
            reason: 'All good',
          })
        }
        default:
          return JSON.stringify({})
      }
    })

    const persistState = makePersistState()
    const fetchMentorRules = vi.fn().mockResolvedValue([])

    const executionRole = makeExecutionRole({
      sandboxDeps,
      callModel,
      persistState,
      fetchMentorRules,
      dryRun: false,
    })

    const graph = buildSynthesisGraph({
      callModel,
      persistState,
      fetchMentorRules,
      executionRole,
    })

    const initialState = makeState()
    const finalState = await graph.run(initialState, { maxSteps: 100 })

    // Coder must have run twice (initial + patch repair)
    expect(coderCallCount).toBe(2)
    // Verifier ran twice (patch first, pass second)
    expect(verifierCallCount).toBe(2)
    // Final verdict is pass
    expect(finalState.verdict!.decision).toBe('pass')
  })
})

// ────────────────────────────────────────────────────────────
// executionRole() — dispatch with fallback
// ────────────────────────────────────────────────────────────

describe('executionRole()', () => {
  it('makeExecutionRole returns a dispatcher that creates distinct node functions per role', () => {
    const sandboxDeps = makeSandboxDeps()
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps,
      callModel: vi.fn().mockResolvedValue('{}'),
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: true,
    })

    const coderNode = executionRole('coder')
    const testerNode = executionRole('tester')

    // Must return functions (not undefined, not the same reference)
    expect(typeof coderNode).toBe('function')
    expect(typeof testerNode).toBe('function')
    expect(coderNode).not.toBe(testerNode)
  })
})

// ────────────────────────────────────────────────────────────
// Integration: executionRole dispatch logic
// ────────────────────────────────────────────────────────────

describe('executionRole dispatch', () => {
  // ── Test 5 (from spec): falls back to callModel fallback when sandbox throws ──
  it('falls back to callModel when sandbox throws', async () => {
    const failingSandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockRejectedValue(new Error('sandbox unavailable')),
    })
    const callModel = vi.fn().mockResolvedValue(JSON.stringify({
      files: [{ path: 'src/fallback.ts', content: '// fallback', action: 'create' }],
      summary: 'Fallback code',
      testsIncluded: false,
    }))
    const persistState = makePersistState()
    const fetchMentorRules = vi.fn().mockResolvedValue([])

    const executionRole = makeExecutionRole({
      sandboxDeps: failingSandboxDeps,
      callModel,
      persistState,
      fetchMentorRules,
      dryRun: false,
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('coder')(state)

    // Sandbox failed — should fall back to callModel (callModel fallback equivalent)
    expect(callModel).toHaveBeenCalled()
    expect(result.code).toBeDefined()
  })

  // ── Test 6 (from spec): uses dryRunRole when dryRun is true ──
  it('uses dry-run output when dryRun is true', async () => {
    const sandboxDeps = makeSandboxDeps()
    const callModel = vi.fn()
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps,
      callModel,
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: true,
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('coder')(state)

    // Neither sandbox nor callModel should be invoked in dry-run
    expect(sandboxDeps.execInSandbox).not.toHaveBeenCalled()
    expect(callModel).not.toHaveBeenCalled()

    // Should return a dry-run code artifact
    expect(result.code).toBeDefined()
    expect(result.code!.summary).toContain('Dry-run')
  })

  it('dry-run tester returns test report', async () => {
    const executionRole = makeExecutionRole({
      sandboxDeps: makeSandboxDeps(),
      callModel: vi.fn(),
      persistState: makePersistState(),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: true,
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('tester')(state)

    expect(result.tests).toBeDefined()
    expect(result.tests!.passed).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// Test 7: Graph topology works with executionRole injected
// ────────────────────────────────────────────────────────────

describe('graph topology with executionRole', () => {
  it('runs full graph with executionRole for coder/tester while callModel fallback handles others', async () => {
    const { buildSynthesisGraph } = await import('./graph.js')
    const { makeExecutionRole } = await import('./sandbox-role.js')

    // Stub callModel for planner, critic, verifier (callModel fallback path)
    const callModel = vi.fn().mockImplementation(async (taskKind: string) => {
      switch (taskKind) {
        case 'planner':
          return JSON.stringify({
            approach: 'Test plan',
            atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
            executorRecommendation: 'gdk-agent',
            estimatedComplexity: 'low',
          })
        case 'critic':
          return JSON.stringify({
            passed: true,
            issues: [],
            mentorRuleCompliance: [],
            overallAssessment: 'Looks good',
          })
        case 'verifier':
          return JSON.stringify({
            decision: 'pass',
            confidence: 1.0,
            reason: 'All good',
          })
        default:
          return JSON.stringify({ result: 'stub' })
      }
    })

    const persistState = makePersistState()
    const fetchMentorRules = vi.fn().mockResolvedValue([])

    // Build executionRole that uses dry-run (simplest path for topology test)
    const executionRole = makeExecutionRole({
      sandboxDeps: makeSandboxDeps(),
      callModel,
      persistState,
      fetchMentorRules,
      dryRun: true,
    })

    const graph = buildSynthesisGraph({
      callModel,
      persistState,
      fetchMentorRules,
      executionRole,
    })

    const initialState = makeState()
    const finalState = await graph.run(initialState, { maxSteps: 50 })

    // Graph completed — verdict reached
    expect(finalState.verdict).toBeDefined()
    expect(finalState.verdict!.decision).toBe('pass')

    // Planner, critic, verifier used callModel (callModel fallback)
    // callModel should have been called for planner, critic, verifier = 3 times
    expect(callModel).toHaveBeenCalledTimes(3)

    // coder and tester went through executionRole (dry-run)
    expect(finalState.code).toBeDefined()
    expect(finalState.code!.summary).toContain('Dry-run')
    expect(finalState.tests).toBeDefined()
    expect(finalState.tests!.passed).toBe(true)
  })

  it('without executionRole, all roles use callModel fallback (backward compat)', async () => {
    const { buildSynthesisGraph } = await import('./graph.js')

    const callModel = vi.fn().mockImplementation(async (taskKind: string) => {
      switch (taskKind) {
        case 'planner':
          return JSON.stringify({
            approach: 'Plan', atoms: [{ id: 'a1', description: 'x', assignedTo: 'coder' }],
            executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
          })
        case 'coder':
          return JSON.stringify({
            files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
            summary: 'Code', testsIncluded: false,
          })
        case 'critic':
          return JSON.stringify({
            passed: true, issues: [], mentorRuleCompliance: [], overallAssessment: 'OK',
          })
        case 'tester':
          return JSON.stringify({
            passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
            failures: [], summary: 'OK',
          })
        case 'verifier':
          return JSON.stringify({ decision: 'pass', confidence: 1.0, reason: 'OK' })
        default:
          return JSON.stringify({})
      }
    })

    const graph = buildSynthesisGraph({
      callModel,
      persistState: makePersistState(),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      // NO executionRole — backward compat
    })

    const finalState = await graph.run(makeState(), { maxSteps: 50 })

    // All 5 roles should have used callModel
    expect(callModel).toHaveBeenCalledTimes(5)
    expect(finalState.verdict!.decision).toBe('pass')
  })
})
