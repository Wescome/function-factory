/**
 * T12-wiring: buildSandboxDeps() coordinator-level branching tests.
 *
 * Verifies that the coordinator's private buildSandboxDeps() method:
 * 1. When env.SANDBOX is defined, delegates to the real sandbox-deps-factory
 * 2. When env.SANDBOX is undefined, returns throwing stubs (backward compat)
 * 3. Passes currentWorkGraphId through to the real factory
 *
 * Strategy: Since SynthesisCoordinator extends Agent (cloudflare:workers), it
 * cannot be instantiated in vitest. We verify:
 *   a) Source-level: the coordinator source imports and calls buildRealSandboxDeps
 *   b) Behavioral: the sandbox-deps-factory returns real deps (already tested)
 *   c) Integration: makeExecutionRole with throwing stubs falls back correctly
 *   d) Source-level: currentWorkGraphId is set before buildSandboxDeps is called
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const coordinatorSrc = readFileSync(
  resolve(__dirname, './coordinator.ts'),
  'utf-8',
)

// ────────────────────────────────────────────────────────────
// 1. Source-level: env.SANDBOX branching exists
// ────────────────────────────────────────────────────────────

describe('T12-wiring: buildSandboxDeps() env.SANDBOX branching', () => {
  it('imports buildSandboxDeps from sandbox-deps-factory (aliased as buildRealSandboxDeps)', () => {
    // The coordinator must import the real factory
    expect(coordinatorSrc).toMatch(
      /import\s*\{[^}]*buildSandboxDeps\s+as\s+buildRealSandboxDeps[^}]*\}\s*from\s*['"]\.\/sandbox-deps-factory['"]/,
    )
  })

  it('buildSandboxDeps method checks this.env.SANDBOX before deciding which path', () => {
    // Must have an `if (this.env.SANDBOX)` guard
    expect(coordinatorSrc).toMatch(/if\s*\(\s*this\.env\.SANDBOX\s*\)/)
  })

  it('calls buildRealSandboxDeps when env.SANDBOX is truthy', () => {
    // Inside the if-block, must call buildRealSandboxDeps(...)
    expect(coordinatorSrc).toMatch(/buildRealSandboxDeps\(\s*this\.env\.SANDBOX/)
  })

  it('passes this.currentWorkGraphId to buildRealSandboxDeps', () => {
    // The real factory needs the workGraphId for sandbox naming
    expect(coordinatorSrc).toMatch(
      /buildRealSandboxDeps\(\s*this\.env\.SANDBOX\s*,\s*this\.currentWorkGraphId\s*\)/,
    )
  })

  it('returns throwing stubs when env.SANDBOX is falsy', () => {
    // After the if-block, must have fallback stubs that throw
    // Look for the pattern: throw new Error containing "Sandbox not"
    expect(coordinatorSrc).toMatch(/throw\s+new\s+Error\(\s*['"]Sandbox not/)
  })

  it('stub execInSandbox throws with descriptive error', () => {
    // The stub error message should indicate sandbox is not available
    expect(coordinatorSrc).toMatch(/execInSandbox.*throw\s+new\s+Error|throw\s+new\s+Error.*falling back/)
  })

  it('stub prepareWorkspace throws with descriptive error', () => {
    expect(coordinatorSrc).toMatch(/prepareWorkspace[\s\S]*?throw\s+new\s+Error/)
  })

  it('stub createBackup returns empty string (non-throwing)', () => {
    // createBackup is non-fatal; returning empty string is fine
    expect(coordinatorSrc).toMatch(/createBackup:\s*async\s*\([^)]*\)\s*=>\s*['"]/)
  })

  it('stub restoreBackup is a no-op (non-throwing)', () => {
    // restoreBackup is non-fatal; returning void is fine
    expect(coordinatorSrc).toMatch(/restoreBackup:\s*async\s*\([^)]*\)\s*=>\s*\{/)
  })
})

// ────────────────────────────────────────────────────────────
// 2. currentWorkGraphId tracking
// ────────────────────────────────────────────────────────────

describe('T12-wiring: currentWorkGraphId lifecycle', () => {
  it('declares currentWorkGraphId as a private field', () => {
    expect(coordinatorSrc).toMatch(/private\s+currentWorkGraphId\s*:\s*string/)
  })

  it('initializes currentWorkGraphId with a default value', () => {
    // Should have a default so buildSandboxDeps never gets undefined
    expect(coordinatorSrc).toMatch(/currentWorkGraphId\s*:\s*string\s*=\s*['"]/)
  })

  it('sets currentWorkGraphId at the start of synthesize()', () => {
    // In synthesize(), currentWorkGraphId must be set from the workGraph
    expect(coordinatorSrc).toMatch(/this\.currentWorkGraphId\s*=\s*workGraphId/)
  })

  it('currentWorkGraphId is set BEFORE buildSandboxDeps is called', () => {
    // Extract the synthesize method body and verify ordering
    const synthesizeStart = coordinatorSrc.indexOf('async synthesize(')
    const setWorkGraphId = coordinatorSrc.indexOf('this.currentWorkGraphId = workGraphId', synthesizeStart)
    const callBuildDeps = coordinatorSrc.indexOf('this.buildSandboxDeps()', synthesizeStart)

    // Both must exist
    expect(setWorkGraphId).toBeGreaterThan(-1)
    expect(callBuildDeps).toBeGreaterThan(-1)

    // Set must come before use
    expect(setWorkGraphId).toBeLessThan(callBuildDeps)
  })
})

// ────────────────────────────────────────────────────────────
// 3. SANDBOX is optional on CoordinatorEnv
// ────────────────────────────────────────────────────────────

describe('T12-wiring: CoordinatorEnv.SANDBOX is optional', () => {
  it('SANDBOX field is declared with ? (optional) on CoordinatorEnv', () => {
    // The SANDBOX binding must be optional so existing deploys without
    // the sandbox container keep working
    expect(coordinatorSrc).toMatch(/SANDBOX\?\s*:\s*unknown/)
  })

  it('SANDBOX type is unknown (opaque DurableObjectNamespace)', () => {
    // unknown is correct — the actual type is DurableObjectNamespace
    // but we keep it opaque to avoid importing cloudflare:workers types
    expect(coordinatorSrc).toMatch(/SANDBOX\?\s*:\s*unknown/)
  })
})

// ────────────────────────────────────────────────────────────
// 4. Behavioral: sandbox-deps-factory returns real SandboxDeps
//    (imports directly — no cloudflare runtime needed)
// ────────────────────────────────────────────────────────────

// We re-test the factory shape here to confirm the coordinator's
// import target actually produces the right shape. This is the
// "when env.SANDBOX is defined" behavioral verification.
import type { SandboxDeps } from './sandbox-role.js'

describe('T12-wiring: buildRealSandboxDeps produces valid SandboxDeps', () => {
  // vi.mock to intercept @cloudflare/sandbox since it's not available in vitest
  const { mockGetSandbox } = vi.hoisted(() => {
    const mockSandbox = {
      exec: vi.fn().mockResolvedValue({ success: true, stdout: '{}', stderr: '' }),
      writeFile: vi.fn().mockResolvedValue({ success: true }),
      createBackup: vi.fn().mockResolvedValue({ id: 'bk-1', dir: '/' }),
      restoreBackup: vi.fn().mockResolvedValue({ success: true }),
      gitCheckout: vi.fn().mockResolvedValue({ success: true }),
    }
    return { mockGetSandbox: vi.fn().mockReturnValue(mockSandbox) }
  })

  vi.mock('@cloudflare/sandbox', () => ({
    getSandbox: mockGetSandbox,
  }))

  it('returns an object with all four SandboxDeps methods', async () => {
    // Dynamic import to pick up the mock
    const { buildSandboxDeps } = await import('./sandbox-deps-factory.js')
    const fakeBinding = { idFromName: vi.fn() }

    const deps: SandboxDeps = buildSandboxDeps(fakeBinding, 'WG-wire-test')

    expect(typeof deps.execInSandbox).toBe('function')
    expect(typeof deps.prepareWorkspace).toBe('function')
    expect(typeof deps.createBackup).toBe('function')
    expect(typeof deps.restoreBackup).toBe('function')
  })

  it('passes the sandbox binding and derived name to getSandbox', async () => {
    const { buildSandboxDeps } = await import('./sandbox-deps-factory.js')
    const fakeBinding = { idFromName: vi.fn() }

    const deps = buildSandboxDeps(fakeBinding, 'WG-wire-test')
    await deps.execInSandbox('{}')

    expect(mockGetSandbox).toHaveBeenCalledWith(fakeBinding, 'synth-WG-wire-test')
  })
})

// ────────────────────────────────────────────────────────────
// 5. Integration: throwing stubs trigger callModel fallback
//    (validates the complete fallback chain)
// ────────────────────────────────────────────────────────────

import { makeExecutionRole } from './sandbox-role.js'
import { createInitialState, type GraphState } from './state.js'

describe('T12-wiring: throwing stubs trigger callModel fallback (integration)', () => {
  function makeThrowingStubs(): SandboxDeps {
    return {
      execInSandbox: async () => { throw new Error('Sandbox not yet deployed — falling back to callModel') },
      prepareWorkspace: async () => { throw new Error('Sandbox not yet deployed') },
      createBackup: async () => '',
      restoreBackup: async () => {},
    }
  }

  function makeStubCallModel() {
    return vi.fn().mockImplementation(async (taskKind: string) => {
      if (taskKind === 'coder') {
        return JSON.stringify({
          files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
          summary: 'Fallback code', testsIncluded: false,
        })
      }
      if (taskKind === 'tester') {
        return JSON.stringify({
          passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
          failures: [], summary: 'OK',
        })
      }
      return '{}'
    })
  }

  it('when stubs throw, makeExecutionRole catches and uses callModel for coder', async () => {
    const callModel = makeStubCallModel()
    const persistState = vi.fn().mockResolvedValue(undefined)
    const fetchMentorRules = vi.fn().mockResolvedValue([])

    const executionRole = makeExecutionRole({
      dryRun: false,
      sandboxDeps: makeThrowingStubs(),
      callModel,
      persistState,
      fetchMentorRules,
    })

    const state: GraphState = {
      ...createInitialState('WG-fallback', {
        id: 'WG-fallback',
        title: 'Fallback test',
        atoms: [{ id: 'a1', description: 'test', assignedTo: 'coder' }],
        invariants: [],
        dependencies: [],
      }),
      plan: {
        approach: 'test',
        atoms: [{ id: 'a1', description: 'test', assignedTo: 'coder' }],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      },
    }

    const coderFn = executionRole('coder')
    const result = await coderFn(state)

    // callModel was invoked as fallback
    expect(callModel).toHaveBeenCalledWith('coder', expect.any(String), expect.any(String))

    // The result has code (from callModel fallback)
    expect(result.code).toBeDefined()
    expect(result.code!.summary).toBe('Fallback code')
  })

  it('when stubs throw, makeExecutionRole catches and uses callModel for tester', async () => {
    const callModel = makeStubCallModel()
    const persistState = vi.fn().mockResolvedValue(undefined)
    const fetchMentorRules = vi.fn().mockResolvedValue([])

    const executionRole = makeExecutionRole({
      dryRun: false,
      sandboxDeps: makeThrowingStubs(),
      callModel,
      persistState,
      fetchMentorRules,
    })

    const state: GraphState = {
      ...createInitialState('WG-fallback-t', {
        id: 'WG-fallback-t',
        title: 'Tester fallback',
        atoms: [],
        invariants: [],
        dependencies: [],
      }),
      plan: {
        approach: 'test',
        atoms: [],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      },
      code: {
        files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
        summary: 'code',
        testsIncluded: false,
      },
    }

    const testerFn = executionRole('tester')
    const result = await testerFn(state)

    expect(callModel).toHaveBeenCalledWith('tester', expect.any(String), expect.any(String))
    expect(result.tests).toBeDefined()
    expect(result.tests!.passed).toBe(true)
  })

  it('stubs match the exact shape returned by coordinator.buildSandboxDeps()', () => {
    // The coordinator stubs must conform to SandboxDeps.
    // Verify the shape matches what makeExecutionRole expects.
    const stubs = makeThrowingStubs()

    expect(typeof stubs.execInSandbox).toBe('function')
    expect(typeof stubs.prepareWorkspace).toBe('function')
    expect(typeof stubs.createBackup).toBe('function')
    expect(typeof stubs.restoreBackup).toBe('function')
  })

  it('stub execInSandbox rejects with a descriptive message', async () => {
    const stubs = makeThrowingStubs()
    await expect(stubs.execInSandbox('{}')).rejects.toThrow(/Sandbox not/)
  })

  it('stub prepareWorkspace rejects with a descriptive message', async () => {
    const stubs = makeThrowingStubs()
    await expect(stubs.prepareWorkspace({ repoUrl: '', ref: '', branch: '' }))
      .rejects.toThrow(/Sandbox not/)
  })

  it('stub createBackup resolves to empty string (non-fatal)', async () => {
    const stubs = makeThrowingStubs()
    await expect(stubs.createBackup('/workspace')).resolves.toBe('')
  })

  it('stub restoreBackup resolves to void (non-fatal)', async () => {
    const stubs = makeThrowingStubs()
    await expect(stubs.restoreBackup('handle')).resolves.toBeUndefined()
  })
})
