/**
 * sandboxRole() — Graph node factory for sandbox-based execution.
 *
 * T6 integration crux: connects the Coordinator graph to the Sandbox Container.
 * Instead of calling an LLM directly (callModel-fallback), this node:
 *   1. Prepares the sandbox workspace (first coder call or resample)
 *   2. Sends the role task to the sandbox via execInSandbox()
 *   3. Parses the result and returns a Partial<GraphState> update
 *
 * The actual sandbox calls are abstracted behind SandboxDeps so they
 * can be mocked in vitest (we cannot import @cloudflare/sandbox there).
 */

import { ROLE_CONTRACTS } from './contracts.js'
import type { RoleName } from './contracts.js'
import type {
  GraphState,
  CodeArtifact,
  TestReport,
} from './state.js'
import type { GraphDeps } from './graph.js'

// ────────────────────────────────────────────────────────────
// SandboxDeps — mockable interface over @cloudflare/sandbox
// ────────────────────────────────────────────────────────────

export interface SandboxDeps {
  /** Runs run-session.js inside the sandbox, returns stdout (JSON). */
  execInSandbox: (taskJson: string) => Promise<string>
  /** Prepares workspace: git clone, pnpm install. */
  prepareWorkspace: (config: { repoUrl: string; ref: string; branch: string }) => Promise<void>
  /** Creates a filesystem backup; returns an opaque handle. */
  createBackup: (dir: string) => Promise<string>
  /** Restores a previously-created backup. */
  restoreBackup: (handle: string) => Promise<void>
}

// ────────────────────────────────────────────────────────────
// Sandbox result shape (matches run-session.js output)
// ────────────────────────────────────────────────────────────

interface SandboxResult {
  ok: boolean
  role: string
  filesChanged: string[]
  testOutput?: string
  agentOutput: string
  tokenUsage: { input: number; output: number; total: number }
  error?: string
}

// ────────────────────────────────────────────────────────────
// sandboxRole() — node factory
// ────────────────────────────────────────────────────────────

/**
 * Creates a graph node function for sandbox-based role execution.
 *
 * @param role     - 'coder' or 'tester'
 * @param deps     - Sandbox dependency interface (mockable)
 * @param persist  - State persistence callback
 * @returns        - Async function matching (state: GraphState) => Promise<Partial<GraphState>>
 */
export function sandboxRole(
  role: 'coder' | 'tester',
  deps: SandboxDeps,
  persist: GraphDeps['persistState'],
): (state: GraphState) => Promise<Partial<GraphState>> {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    // ── 1. Workspace preparation (coder only, when not ready) ──
    if (role === 'coder' && !state.workspaceReady) {
      await deps.prepareWorkspace({
        repoUrl: state.workGraph.repoUrl ?? '',
        ref: state.workGraph.ref ?? 'HEAD',
        branch: state.workGraph.branch ?? 'main',
      })
    }

    // ── 2. Restore backup on resample (coder only) ──
    // Failure is non-fatal: if restore fails, the coder proceeds on the existing workspace.
    if (role === 'coder' && state.coderBackupHandle && state.verdict?.decision === 'resample') {
      try {
        await deps.restoreBackup(state.coderBackupHandle)
      } catch {
        // Backup restoration failed — proceed without it. The coder will
        // work on the current workspace state, which is suboptimal but not fatal.
      }
    }

    // ── 3. Build task JSON ──
    const contract = ROLE_CONTRACTS[role]
    const taskPayload: Record<string, unknown> = {
      role,
      workGraphId: state.workGraphId,
      workGraph: {
        title: state.workGraph.title,
        atoms: state.workGraph.atoms,
        invariants: state.workGraph.invariants,
        dependencies: state.workGraph.dependencies,
      },
      plan: state.plan,
      prompt: contract.systemPrompt,
      repairCount: state.repairCount,
      maxRepairs: state.maxRepairs,
      // Phase C: sandbox-specific fields for run-session.js
      workDir: '/workspace',
      model: {
        provider: 'deepseek',
        modelId: 'deepseek/deepseek-v4-pro',
      },
    }

    // Phase C: role-specific sandbox gates
    if (role === 'coder') {
      taskPayload.fileScope = {
        allowWrite: ['/workspace'],
        denyWrite: ['/workspace/node_modules', '/workspace/.git'],
      }
      taskPayload.commandPolicy = {
        denyCommands: [
          'rm -rf /',
          'curl',
          'wget',
          'nc ',
          'ncat',
          'dd ',
          'mkfs',
          'shutdown',
          'reboot',
        ],
      }

      if (state.verdict?.decision === 'patch') {
        taskPayload.repairNotes = state.verdict.notes
        taskPayload.previousCode = state.code?.summary
        taskPayload.critiqueIssues = state.critique?.issues
      }
      if (state.verdict?.decision === 'resample') {
        taskPayload.resampleReason = state.verdict.reason
        taskPayload.previousApproach = state.plan?.approach
      }
    }

    if (role === 'tester') {
      taskPayload.code = state.code
      taskPayload.critique = state.critique
    }

    const taskJson = JSON.stringify(taskPayload)

    // ── 4. Execute in sandbox ──
    const rawResult = await deps.execInSandbox(taskJson)
    let sandboxResult: SandboxResult
    try {
      sandboxResult = JSON.parse(rawResult)
    } catch {
      throw new Error(
        `Sandbox returned invalid JSON for role "${role}": ${rawResult.slice(0, 200)}`,
      )
    }

    // ── 5. Parse result into GraphState updates ──
    const estimatedTokens = sandboxResult.tokenUsage?.total ?? 0
    const updated: Partial<GraphState> = {
      tokenUsage: state.tokenUsage + estimatedTokens,
      roleHistory: [
        ...state.roleHistory,
        {
          role,
          output: sandboxResult,
          tokenUsage: estimatedTokens,
          timestamp: new Date().toISOString(),
        },
      ],
    }

    if (role === 'coder') {
      updated.workspaceReady = true

      if (sandboxResult.ok) {
        updated.code = {
          files: sandboxResult.filesChanged.map(f => ({
            path: f,
            content: '', // Actual content lives in the sandbox filesystem
            action: 'modify' as const,
          })),
          summary: sandboxResult.agentOutput,
          testsIncluded: false,
          toolCallCount: sandboxResult.filesChanged.length,
        }
      } else {
        updated.code = {
          files: [],
          summary: `Sandbox error: ${sandboxResult.error ?? 'unknown error'}`,
          testsIncluded: false,
          toolCallCount: 0,
        }
      }

      updated.coderToolCalls = sandboxResult.filesChanged.length

      // ── 6. Create backup for repair loop recovery ──
      // Failure is non-fatal: coder result is still usable without a backup handle.
      try {
        const backupHandle = await deps.createBackup('/workspace')
        updated.coderBackupHandle = backupHandle
      } catch {
        // Backup creation failed — the coder result is still valid, but the
        // repair loop won't be able to restore to this checkpoint.
      }
    }

    if (role === 'tester') {
      const passed = sandboxResult.ok
      const testOutput = sandboxResult.testOutput ?? sandboxResult.agentOutput

      // Parse test counts from output if available
      const runMatch = testOutput.match(/(\d+)\s+tests?\s+passed/)
      const failMatch = testOutput.match(/(\d+)\s+(?:tests?\s+)?failed/)
      const testsPassed = runMatch?.[1] ? parseInt(runMatch[1], 10) : (passed ? 1 : 0)
      const testsFailed = failMatch?.[1] ? parseInt(failMatch[1], 10) : (passed ? 0 : 1)

      updated.tests = {
        passed,
        testsRun: testsPassed + testsFailed,
        testsPassed,
        testsFailed,
        failures: passed ? [] : [{ name: 'sandbox-test', error: sandboxResult.error ?? 'Tests failed' }],
        summary: testOutput,
      }

      updated.testerToolCalls = 0 // Tester is read-only
    }

    // ── 7. Persist state ──
    await persist({ ...state, ...updated } as GraphState, role)

    return updated
  }
}

// ────────────────────────────────────────────────────────────
// makeExecutionRole() — dispatch factory with fallback + dry-run
// ────────────────────────────────────────────────────────────

export interface ExecutionRoleConfig {
  sandboxDeps: SandboxDeps
  callModel: GraphDeps['callModel']
  persistState: GraphDeps['persistState']
  fetchMentorRules: GraphDeps['fetchMentorRules']
  dryRun: boolean
  /** Phase C: optional CoderAgent for 3-tier fallback (sandbox > agent > callModel) */
  coderAgent?: { produceCode: (input: any) => Promise<import('./state.js').CodeArtifact> }
  /** Phase C: optional TesterAgent for 3-tier fallback (sandbox > agent > callModel) */
  testerAgent?: { runTests: (input: any) => Promise<import('./state.js').TestReport> }
}

/**
 * Creates the executionRole dispatcher.
 * - dryRun mode: returns stub data without calling sandbox or LLM
 * - sandbox mode: calls sandboxRole(), falls back through 3-tier chain:
 *   1. Sandbox Container (real filesystem, real tools)
 *   2. Agent (gdk-agent agentLoop in V8, arango_query tool)
 *   3. callModel (raw prompt, no tools)
 */
export function makeExecutionRole(config: ExecutionRoleConfig) {
  return (role: 'coder' | 'tester') => {
    return async (state: GraphState): Promise<Partial<GraphState>> => {
      // ── Dry-run path ──
      if (config.dryRun) {
        return dryRunRole(role, state, config.persistState)
      }

      // ── Tier 1: Sandbox Container ──
      try {
        const node = sandboxRole(role, config.sandboxDeps, config.persistState)
        return await node(state)
      } catch {
        // Sandbox failed — try agent fallback
      }

      // ── Tier 2: Agent (gdk-agent agentLoop in V8) ──
      try {
        if (role === 'coder' && config.coderAgent) {
          return await fallbackToCoderAgent(state, config)
        }
        if (role === 'tester' && config.testerAgent) {
          return await fallbackToTesterAgent(state, config)
        }
      } catch {
        // Agent failed — fall through to callModel
      }

      // ── Tier 3: callModel (raw prompt, no tools) ──
      return await fallbackToCallModel(role, state, config)
    }
  }
}

// ────────────────────────────────────────────────────────────
// Dry-run stubs
// ────────────────────────────────────────────────────────────

async function dryRunRole(
  role: 'coder' | 'tester',
  state: GraphState,
  persist: GraphDeps['persistState'],
): Promise<Partial<GraphState>> {
  const updated: Partial<GraphState> = {
    roleHistory: [
      ...state.roleHistory,
      { role, output: { dryRun: true }, tokenUsage: 0, timestamp: new Date().toISOString() },
    ],
  }

  if (role === 'coder') {
    updated.code = {
      files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' }],
      summary: 'Dry-run code output',
      testsIncluded: false,
    }
    updated.workspaceReady = true
  }

  if (role === 'tester') {
    updated.tests = {
      passed: true,
      testsRun: 1,
      testsPassed: 1,
      testsFailed: 0,
      failures: [],
      summary: 'Dry-run — all tests pass',
    }
  }

  await persist({ ...state, ...updated } as GraphState, role)
  return updated
}

// ────────────────────────────────────────────────────────────
// Tier 2 Fallback: CoderAgent (gdk-agent agentLoop in V8)
// ────────────────────────────────────────────────────────────

async function fallbackToCoderAgent(
  state: GraphState,
  config: ExecutionRoleConfig,
): Promise<Partial<GraphState>> {
  const code = await config.coderAgent!.produceCode({
    workGraph: state.workGraph,
    plan: state.plan,
    ...(state.verdict?.decision === 'patch' && state.verdict.notes ? {
      repairNotes: state.verdict.notes,
      previousCode: state.code ?? undefined,
      critiqueIssues: state.critique?.issues,
    } : {}),
  })

  const updated: Partial<GraphState> = {
    code,
    roleHistory: [
      ...state.roleHistory,
      { role: 'coder', output: code, tokenUsage: 0, timestamp: new Date().toISOString() },
    ],
  }

  await config.persistState({ ...state, ...updated } as GraphState, 'coder')
  return updated
}

// ────────────────────────────────────────────────────────────
// Tier 2 Fallback: TesterAgent (gdk-agent agentLoop in V8)
// ────────────────────────────────────────────────────────────

async function fallbackToTesterAgent(
  state: GraphState,
  config: ExecutionRoleConfig,
): Promise<Partial<GraphState>> {
  const tests = await config.testerAgent!.runTests({
    workGraph: state.workGraph,
    plan: state.plan ?? {},
    code: state.code ?? {},
    ...(state.critique ? { critique: state.critique } : {}),
  })

  const updated: Partial<GraphState> = {
    tests,
    roleHistory: [
      ...state.roleHistory,
      { role: 'tester', output: tests, tokenUsage: 0, timestamp: new Date().toISOString() },
    ],
  }

  await config.persistState({ ...state, ...updated } as GraphState, 'tester')
  return updated
}

// ────────────────────────────────────────────────────────────
// Tier 3 Fallback: callModel-fallback-equivalent via callModel
// ────────────────────────────────────────────────────────────

async function fallbackToCallModel(
  role: 'coder' | 'tester',
  state: GraphState,
  config: ExecutionRoleConfig,
): Promise<Partial<GraphState>> {
  const contract = ROLE_CONTRACTS[role]

  const mentorRules = await config.fetchMentorRules()
  const userMessage = JSON.stringify({
    workGraphId: state.workGraphId,
    workGraph: {
      title: state.workGraph.title,
      atoms: state.workGraph.atoms,
      invariants: state.workGraph.invariants,
      dependencies: state.workGraph.dependencies,
    },
    plan: state.plan,
    repairCount: state.repairCount,
    maxRepairs: state.maxRepairs,
    ...(role === 'tester' ? { code: state.code, critique: state.critique } : {}),
    ...(role === 'coder' && state.verdict?.decision === 'patch' ? {
      repairNotes: state.verdict.notes,
      previousCode: state.code?.summary,
      critiqueIssues: state.critique?.issues,
    } : {}),
  })

  const rawResult = await config.callModel(
    contract.taskKind,
    contract.systemPrompt,
    userMessage,
  )

  const parsed = contract.parse(rawResult)
  const estimatedTokens = Math.ceil(
    (contract.systemPrompt.length + userMessage.length + rawResult.length) / 4,
  )

  const updated: Partial<GraphState> = {
    [contract.outputChannel]: parsed,
    tokenUsage: state.tokenUsage + estimatedTokens,
    roleHistory: [
      ...state.roleHistory,
      { role, output: parsed, tokenUsage: estimatedTokens, timestamp: new Date().toISOString() },
    ],
  }

  await config.persistState({ ...state, ...updated } as GraphState, role)
  return updated
}
