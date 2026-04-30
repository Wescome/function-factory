import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AutonomousSchedulerValidationError,
  JsonlAgentQueue,
  buildAgentResultFromExecution,
  buildCodexWorkerPrompt,
  createStrategyRecipesDogfoodRunPaths,
  createDryRunCommandExecutor,
  executeCodexRunnerPlan,
  executePullRequestPlan,
  planCodexRunner,
  planPullRequest,
  runQueueDaemon,
  runSingleAgentRequest,
  runStrategyRecipesDogfood,
  validateAgentRequest,
  validateAgentResult,
  validateQueueEvent,
  writeAgentResultBundle,
} from '../src/index.js'

const requestFixture = JSON.parse(
  readFileSync(new URL('../fixtures/strategy-recipes-agent-request.json', import.meta.url), 'utf8'),
) as unknown

const resultFixture = JSON.parse(
  readFileSync(new URL('../fixtures/strategy-recipes-agent-result.json', import.meta.url), 'utf8'),
) as unknown

describe('autonomous scheduler contracts', () => {
  it('validates the Strategy.Recipes dogfood AgentRequest fixture', () => {
    const request = validateAgentRequest(requestFixture)

    expect(request.id).toBe('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(request.role).toBe('builder')
    expect(request.repo.name).toBe('strategy-recipes')
    expect(request.branch.mode).toBe('new_pr_branch')
    expect(request.policy.autonomyMode).toBe('branch_pr')
    expect(request.workgraph.sourceRefs).toContain('Strategy_Recipes_UX_Architecture_v1.1.md')
  })

  it('validates a completed AgentResult with PR evidence', () => {
    const result = validateAgentResult(resultFixture)

    expect(result.status).toBe('completed')
    expect(result.requestId).toBe('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(result.prUrl).toBe('https://github.com/Wescome/strategy-recipes/pull/1')
    expect(result.evidence.some((entry) => entry.kind === 'pr_url')).toBe(true)
  })

  it('validates queue events for the jsonl queue boundary', () => {
    const event = validateQueueEvent({
      schemaVersion: 'factory.queue-event.v0',
      id: 'QE-STRATEGY-RECIPES-ENQUEUED',
      type: 'request.enqueued',
      requestId: 'AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW',
      timestamp: '2026-04-30T14:01:00.000Z',
      actor: 'factory-governor',
      details: {
        queue: 'jsonl_queue',
        branchMode: 'new_pr_branch',
      },
    })

    expect(event.type).toBe('request.enqueued')
    expect(event.details.queue).toBe('jsonl_queue')
  })

  it('rejects requests without WorkGraph lineage', () => {
    const invalid = structuredClone(requestFixture) as Record<string, unknown>
    invalid.workgraph = {
      id: 'WG-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW',
      nodeId: 'first-product-view',
      sourceRefs: [],
    }

    expectValidationIssues(() => validateAgentRequest(invalid), ['workgraph.sourceRefs must not be empty'])
  })

  it('rejects broad or absolute allowed paths', () => {
    const invalid = structuredClone(requestFixture) as Record<string, unknown>
    invalid.policy = {
      ...(invalid.policy as Record<string, unknown>),
      allowedPaths: ['**', '/tmp/work'],
    }

    expectValidationIssues(() => validateAgentRequest(invalid), [
      'policy.allowedPaths contains overly broad path: **',
      'policy.allowedPaths must be repo-relative: /tmp/work',
    ])
  })

  it('rejects policies that omit default-branch and secret safeguards', () => {
    const invalid = structuredClone(requestFixture) as Record<string, unknown>
    invalid.policy = {
      ...(invalid.policy as Record<string, unknown>),
      forbiddenActions: ['delete_remote_branch'],
    }

    expectValidationIssues(() => validateAgentRequest(invalid), [
      'policy.forbiddenActions must include merge_default_branch',
      'policy.forbiddenActions must include deploy_production',
      'policy.forbiddenActions must include force_push',
      'policy.forbiddenActions must include edit_secrets',
    ])
  })
})

describe('Codex runner planning', () => {
  it('plans a PR-branch Codex runner invocation from an AgentRequest', () => {
    const plan = planCodexRunner(requestFixture, {
      repoRoot: '/tmp/strategy-recipes',
      codexBinary: 'codex',
    })

    expect(plan.requestId).toBe('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(plan.branchName).toBe('factory/strategy-recipes-first-product-view/ar-strategy-recipes-first-product-view')
    expect(plan.preflightCommands.map((command) => command.command)).toEqual(['git', 'git', 'git'])
    expect(plan.preflightCommands[1]?.args).toEqual([
      'switch',
      '-c',
      'factory/strategy-recipes-first-product-view/ar-strategy-recipes-first-product-view',
      'origin/main',
    ])
    expect(plan.codexCommand.command).toBe('codex')
    expect(plan.codexCommand.args[0]).toBe('exec')
    expect(plan.prompt).toContain('Allowed paths: README.md, docs/**, packages/**, apps/**, examples/**, tests/**')
    expect(plan.prompt).toContain('Do not merge, deploy, force-push, delete remote branches, edit secrets')
  })

  it('builds a worker prompt with required commands and evidence', () => {
    const prompt = buildCodexWorkerPrompt(requestFixture)

    expect(prompt).toContain('Required commands:')
    expect(prompt).toContain('- pnpm test')
    expect(prompt).toContain('Required evidence:')
    expect(prompt).toContain('- pr_url')
  })

  it('does not plan execution for enqueue-only requests', () => {
    const invalid = structuredClone(requestFixture) as Record<string, unknown>
    invalid.policy = {
      ...(invalid.policy as Record<string, unknown>),
      autonomyMode: 'enqueue_only',
    }

    expect(() => planCodexRunner(invalid, { repoRoot: '/tmp/strategy-recipes' })).toThrow(
      'Codex runner cannot execute autonomyMode=enqueue_only',
    )
  })

  it('executes planned commands sequentially through an injected executor', async () => {
    const plan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    const seen: string[] = []
    const execution = await executeCodexRunnerPlan(plan, async (command) => {
      seen.push(command.command)
      return {
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        exitCode: 0,
        stdout: '',
        stderr: '',
        startedAt: '2026-04-30T14:30:00.000Z',
        completedAt: '2026-04-30T14:30:01.000Z',
      }
    })

    expect(seen).toEqual(['git', 'git', 'git', 'codex'])
    expect(execution.status).toBe('completed')
    expect(execution.commands).toHaveLength(4)
  })

  it('stops runner execution on first failing command', async () => {
    const plan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    let count = 0
    const execution = await executeCodexRunnerPlan(plan, async (command) => {
      count += 1
      return {
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        exitCode: count === 2 ? 1 : 0,
        stdout: '',
        stderr: count === 2 ? 'branch exists' : '',
        startedAt: '2026-04-30T14:30:00.000Z',
        completedAt: '2026-04-30T14:30:01.000Z',
      }
    })

    expect(execution.status).toBe('failed')
    expect(execution.commands).toHaveLength(2)
    expect(execution.failedCommand).toBe(
      'git switch -c factory/strategy-recipes-first-product-view/ar-strategy-recipes-first-product-view origin/main',
    )
  })

  it('supports dry-run command execution without invoking external tools', async () => {
    const plan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    const executor = createDryRunCommandExecutor({
      prUrl: 'https://github.com/Wescome/strategy-recipes/pull/dry-run',
      now: fixedClock(),
    })
    const execution = await executeCodexRunnerPlan(plan, executor)
    const pr = await executePullRequestPlan(planPullRequest(requestFixture, execution, {
      repoRoot: '/tmp/strategy-recipes',
    }), executor)

    expect(execution.status).toBe('completed')
    expect(execution.commands[0]?.stdout).toContain('dry-run: git fetch')
    expect(pr.prUrl).toBe('https://github.com/Wescome/strategy-recipes/pull/dry-run')
  })

  it('builds a validated completed AgentResult from runner execution', async () => {
    const plan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    const execution = await executeCodexRunnerPlan(plan, async (command) => ({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: 0,
      stdout: '',
      stderr: '',
      startedAt: '2026-04-30T14:30:00.000Z',
      completedAt: '2026-04-30T14:30:01.000Z',
    }))

    const result = buildAgentResultFromExecution(requestFixture, execution, {
      resultId: 'ARES-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-EXECUTION',
      agentRunId: 'RUN-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-002',
      completedAt: '2026-04-30T14:35:00.000Z',
      artifactBasePath: 'artifacts/AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW',
      prUrl: 'https://github.com/Wescome/strategy-recipes/pull/2',
      changedFiles: ['docs/product/first-product-view.md'],
    })

    expect(result.status).toBe('completed')
    expect(result.prUrl).toBe('https://github.com/Wescome/strategy-recipes/pull/2')
    expect(result.branchName).toBe('factory/strategy-recipes-first-product-view/ar-strategy-recipes-first-product-view')
    expect(result.evidence.map((entry) => entry.kind)).toContain('pr_url')
    expect(result.evidence.map((entry) => entry.kind)).toContain('git_diff')
  })

  it('requires PR evidence for completed runner results', async () => {
    const plan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    const execution = await executeCodexRunnerPlan(plan, async (command) => ({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: 0,
      stdout: '',
      stderr: '',
      startedAt: '2026-04-30T14:30:00.000Z',
      completedAt: '2026-04-30T14:30:01.000Z',
    }))

    expect(() =>
      buildAgentResultFromExecution(requestFixture, execution, {
        resultId: 'ARES-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-MISSING-PR',
        agentRunId: 'RUN-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-003',
        completedAt: '2026-04-30T14:35:00.000Z',
        artifactBasePath: 'artifacts/AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW',
        changedFiles: ['docs/product/first-product-view.md'],
      }),
    ).toThrow(AutonomousSchedulerValidationError)
  })

  it('writes a durable AgentResult artifact bundle', async () => {
    const queueDir = mkdtempSync(join(tmpdir(), 'factory-autonomous-'))
    const bundleDir = join(queueDir, 'bundle')
    const plan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    const execution = await executeCodexRunnerPlan(plan, async (command) => ({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      startedAt: '2026-04-30T14:30:00.000Z',
      completedAt: '2026-04-30T14:30:01.000Z',
    }))
    const result = buildAgentResultFromExecution(requestFixture, execution, {
      resultId: 'ARES-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-BUNDLE',
      agentRunId: 'RUN-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-004',
      completedAt: '2026-04-30T14:35:00.000Z',
      artifactBasePath: bundleDir,
      prUrl: 'https://github.com/Wescome/strategy-recipes/pull/3',
      changedFiles: ['docs/product/first-product-view.md'],
    })

    const manifest = await writeAgentResultBundle(requestFixture, execution, result, {
      bundleDir,
      diff: 'diff --git a/docs/product/first-product-view.md b/docs/product/first-product-view.md',
    })

    expect(manifest.schemaVersion).toBe('factory.agent-result-bundle.v0')
    expect(manifest.files.commands).toHaveLength(4)
    expect(readFileSync(manifest.files.request, 'utf8')).toContain('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(readFileSync(manifest.files.result, 'utf8')).toContain('ARES-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-BUNDLE')
    expect(readFileSync(manifest.files.commands[0] ?? '', 'utf8')).toContain('stdout:')
    expect(readFileSync(manifest.files.diff ?? '', 'utf8')).toContain('diff --git')
  })

  it('plans and executes pull request creation through the command seam', async () => {
    const codexPlan = planCodexRunner(requestFixture, { repoRoot: '/tmp/strategy-recipes' })
    const execution = await executeCodexRunnerPlan(codexPlan, async (command) => ({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: 0,
      stdout: '',
      stderr: '',
      startedAt: '2026-04-30T14:30:00.000Z',
      completedAt: '2026-04-30T14:30:01.000Z',
    }))

    const prPlan = planPullRequest(requestFixture, execution, { repoRoot: '/tmp/strategy-recipes' })
    expect(prPlan.command.command).toBe('gh')
    expect(prPlan.command.args.slice(0, 3)).toEqual(['pr', 'create', '--base'])
    expect(prPlan.command.args).toContain('main')
    expect(prPlan.command.args).toContain('factory/strategy-recipes-first-product-view/ar-strategy-recipes-first-product-view')
    expect(prPlan.body).toContain('Factory request: AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')

    const pr = await executePullRequestPlan(prPlan, async (command) => ({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      exitCode: 0,
      stdout: 'https://github.com/Wescome/strategy-recipes/pull/4\n',
      stderr: '',
      startedAt: '2026-04-30T14:36:00.000Z',
      completedAt: '2026-04-30T14:36:01.000Z',
    }))

    expect(pr.prUrl).toBe('https://github.com/Wescome/strategy-recipes/pull/4')
  })

  it('does not plan PR creation for failed executions', async () => {
    expect(() =>
      planPullRequest(
        requestFixture,
        {
          requestId: 'AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW',
          branchName: 'factory/strategy-recipes-first-product-view/ar-strategy-recipes-first-product-view',
          status: 'failed',
          commands: [],
          failedCommand: 'codex exec',
        },
        { repoRoot: '/tmp/strategy-recipes' },
      ),
    ).toThrow('Pull request plan requires completed execution for AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
  })
})

describe('JsonlAgentQueue', () => {
  it('enqueues, claims, completes, and records events', async () => {
    const queueDir = mkdtempSync(join(tmpdir(), 'factory-autonomous-'))
    const queue = new JsonlAgentQueue({
      queueDir,
      actor: 'factory-governor',
      now: fixedClock(),
    })

    await queue.enqueue(requestFixture)
    expect(await queue.status()).toMatchObject({
      total: 1,
      pending: 1,
      claimed: 0,
      completed: 0,
    })

    const claimed = await queue.claimNext()
    expect(claimed?.id).toBe('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(await queue.claimNext()).toBeNull()
    expect(await queue.status()).toMatchObject({
      total: 1,
      pending: 0,
      claimed: 1,
      completed: 0,
    })

    await queue.complete(resultFixture)
    expect(await queue.status()).toMatchObject({
      total: 1,
      pending: 0,
      claimed: 0,
      completed: 1,
      failed: 0,
      refused: 0,
    })

    const events = await queue.listEvents()
    expect(events.map((event) => event.type)).toEqual([
      'request.enqueued',
      'request.claimed',
      'request.completed',
    ])

    const requestsFile = readFileSync(join(queueDir, 'requests.jsonl'), 'utf8')
    expect(requestsFile).toContain('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
  })

  it('rejects duplicate request IDs', async () => {
    const queue = new JsonlAgentQueue({
      queueDir: mkdtempSync(join(tmpdir(), 'factory-autonomous-')),
      actor: 'factory-governor',
      now: fixedClock(),
    })

    await queue.enqueue(requestFixture)

    await expect(queue.enqueue(requestFixture)).rejects.toThrow(
      'AgentRequest already exists in queue: AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW',
    )
  })

  it('heartbeats active claims and records heartbeat events', async () => {
    const queue = new JsonlAgentQueue({
      queueDir: mkdtempSync(join(tmpdir(), 'factory-autonomous-')),
      actor: 'factory-runner',
      leaseMs: 60_000,
      now: fixedClock(),
    })

    await queue.enqueue(requestFixture)
    await queue.claimNext()
    const claim = await queue.heartbeat('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')

    expect(claim.heartbeatAt).toBe('2026-04-30T14:30:00.000Z')
    expect(claim.leaseExpiresAt).toBe('2026-04-30T14:31:00.000Z')
    expect((await queue.listEvents()).map((event) => event.type)).toContain('request.heartbeat')
  })

  it('reclaims expired claims', async () => {
    let current = new Date('2026-04-30T14:30:00.000Z')
    const queueDir = mkdtempSync(join(tmpdir(), 'factory-autonomous-'))
    const queue = new JsonlAgentQueue({
      queueDir,
      actor: 'factory-runner-1',
      leaseMs: 1_000,
      now: () => current,
    })

    await queue.enqueue(requestFixture)
    expect((await queue.claimNext())?.id).toBe('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(await queue.status()).toMatchObject({ pending: 0, claimed: 1 })

    current = new Date('2026-04-30T14:30:02.000Z')
    const reclaimingQueue = new JsonlAgentQueue({
      queueDir,
      actor: 'factory-runner-2',
      leaseMs: 1_000,
      now: () => current,
    })

    expect(await reclaimingQueue.status()).toMatchObject({ pending: 1, claimed: 0 })
    expect((await reclaimingQueue.claimNext())?.id).toBe('AR-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW')
    expect(await reclaimingQueue.status()).toMatchObject({ pending: 0, claimed: 1 })
    expect((await reclaimingQueue.listEvents()).filter((event) => event.type === 'request.claimed')).toHaveLength(2)
  })
})

describe('single-request scheduler run', () => {
  it('drives one request through queue, runner, PR creation, result, and bundle', async () => {
    const home = mkdtempSync(join(tmpdir(), 'factory-autonomous-'))
    const queue = new JsonlAgentQueue({
      queueDir: join(home, 'queue'),
      actor: 'factory-governor',
      now: fixedClock(),
    })
    const codexCommands: string[] = []

    const outcome = await runSingleAgentRequest(requestFixture, {
      queue,
      repoRoot: '/tmp/strategy-recipes',
      bundleDir: join(home, 'bundle'),
      resultId: 'ARES-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-RUN',
      agentRunId: 'RUN-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-005',
      completedAt: '2026-04-30T14:40:00.000Z',
      changedFiles: ['docs/product/first-product-view.md'],
      diff: 'diff --git a/docs/product/first-product-view.md b/docs/product/first-product-view.md',
      codexExecutor: async (command) => {
        codexCommands.push(command.command)
        return {
          command: command.command,
          args: command.args,
          cwd: command.cwd,
          exitCode: 0,
          stdout: '',
          stderr: '',
          startedAt: '2026-04-30T14:30:00.000Z',
          completedAt: '2026-04-30T14:30:01.000Z',
        }
      },
      pullRequestExecutor: async (command) => ({
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        exitCode: 0,
        stdout: 'https://github.com/Wescome/strategy-recipes/pull/5\n',
        stderr: '',
        startedAt: '2026-04-30T14:36:00.000Z',
        completedAt: '2026-04-30T14:36:01.000Z',
      }),
    })

    expect(codexCommands).toEqual(['git', 'git', 'git', 'codex'])
    expect(outcome.result.status).toBe('completed')
    expect(outcome.pullRequest?.prUrl).toBe('https://github.com/Wescome/strategy-recipes/pull/5')
    expect(readFileSync(outcome.bundle.files.manifest, 'utf8')).toContain('factory.agent-result-bundle.v0')
    expect(await queue.status()).toMatchObject({
      total: 1,
      pending: 0,
      claimed: 0,
      completed: 1,
    })
  })

  it('completes the queue with a failed result when Codex execution fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'factory-autonomous-'))
    const queue = new JsonlAgentQueue({
      queueDir: join(home, 'queue'),
      actor: 'factory-governor',
      now: fixedClock(),
    })
    let prCalls = 0

    const outcome = await runSingleAgentRequest(requestFixture, {
      queue,
      repoRoot: '/tmp/strategy-recipes',
      bundleDir: join(home, 'bundle'),
      resultId: 'ARES-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-FAILED-RUN',
      agentRunId: 'RUN-STRATEGY-RECIPES-FIRST-PRODUCT-VIEW-006',
      completedAt: '2026-04-30T14:40:00.000Z',
      codexExecutor: async (command) => ({
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        exitCode: command.command === 'codex' ? 1 : 0,
        stdout: '',
        stderr: command.command === 'codex' ? 'worker failed' : '',
        startedAt: '2026-04-30T14:30:00.000Z',
        completedAt: '2026-04-30T14:30:01.000Z',
      }),
      pullRequestExecutor: async (command) => {
        prCalls += 1
        return {
          command: command.command,
          args: command.args,
          cwd: command.cwd,
          exitCode: 0,
          stdout: 'https://github.com/Wescome/strategy-recipes/pull/6\n',
          stderr: '',
          startedAt: '2026-04-30T14:36:00.000Z',
          completedAt: '2026-04-30T14:36:01.000Z',
        }
      },
    })

    expect(outcome.result.status).toBe('failed')
    expect(outcome.pullRequest).toBeUndefined()
    expect(prCalls).toBe(0)
    expect(await queue.status()).toMatchObject({
      total: 1,
      failed: 1,
    })
  })
})

describe('queue daemon', () => {
  it('claims and runs one queued request through the daemon loop', async () => {
    const home = mkdtempSync(join(tmpdir(), 'factory-autonomous-'))
    const queue = new JsonlAgentQueue({
      queueDir: join(home, 'queue'),
      actor: 'factory-daemon',
      now: fixedClock(),
    })
    await queue.enqueue(requestFixture)

    const outcome = await runQueueDaemon({
      queue,
      repoRoot: '/tmp/strategy-recipes',
      bundleRoot: join(home, 'bundles'),
      pollIntervalMs: 0,
      maxIterations: 1,
      now: fixedClock(),
      codexExecutor: async (command) => ({
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        exitCode: 0,
        stdout: '',
        stderr: '',
        startedAt: '2026-04-30T14:30:00.000Z',
        completedAt: '2026-04-30T14:30:01.000Z',
      }),
      pullRequestExecutor: async (command) => ({
        command: command.command,
        args: command.args,
        cwd: command.cwd,
        exitCode: 0,
        stdout: 'https://github.com/Wescome/strategy-recipes/pull/7\n',
        stderr: '',
        startedAt: '2026-04-30T14:36:00.000Z',
        completedAt: '2026-04-30T14:36:01.000Z',
      }),
    })

    expect(outcome).toEqual({
      iterations: 1,
      completedRuns: 1,
      stopReason: 'max_iterations',
    })
    expect(await queue.status()).toMatchObject({ total: 1, completed: 1 })
  })

  it('stops daemon loop when stop predicate is set', async () => {
    const queue = new JsonlAgentQueue({
      queueDir: mkdtempSync(join(tmpdir(), 'factory-autonomous-')),
      actor: 'factory-daemon',
      now: fixedClock(),
    })

    await expect(
      runQueueDaemon({
        queue,
        repoRoot: '/tmp/strategy-recipes',
        bundleRoot: '/tmp/bundles',
        pollIntervalMs: 0,
        maxIterations: 10,
        shouldStop: () => true,
      }),
    ).resolves.toEqual({
      iterations: 0,
      completedRuns: 0,
      stopReason: 'stop_requested',
    })
  })
})

describe('Strategy.Recipes dogfood', () => {
  it('creates deterministic dogfood run paths', () => {
    const paths = createStrategyRecipesDogfoodRunPaths('/tmp/factory-dogfood', fixedClock())

    expect(paths.runId).toBe('strategy-recipes-20260430T143000000Z')
    expect(paths.queueDir).toBe('/tmp/factory-dogfood/strategy-recipes-20260430T143000000Z/queue')
    expect(paths.bundleDir).toBe('/tmp/factory-dogfood/strategy-recipes-20260430T143000000Z/bundle')
  })

  it('runs Strategy.Recipes dogfood in dry-run mode', async () => {
    const home = mkdtempSync(join(tmpdir(), 'factory-dogfood-'))
    const paths = createStrategyRecipesDogfoodRunPaths(home, fixedClock())
    const dogfood = await runStrategyRecipesDogfood({
      request: requestFixture,
      repoRoot: '/tmp/strategy-recipes',
      queueDir: paths.queueDir,
      bundleDir: paths.bundleDir,
      mode: 'dry-run',
      mockPrUrl: 'https://github.com/Wescome/strategy-recipes/pull/dogfood',
      now: fixedClock(),
    })

    expect(dogfood.mode).toBe('dry-run')
    expect(dogfood.outcome.result.status).toBe('completed')
    expect(dogfood.outcome.result.prUrl).toBe('https://github.com/Wescome/strategy-recipes/pull/dogfood')
    expect(readFileSync(dogfood.outcome.bundle.files.manifest, 'utf8')).toContain('factory.agent-result-bundle.v0')
  })
})

function expectValidationIssues(action: () => unknown, expectedIssues: string[]): void {
  expect(action).toThrow(AutonomousSchedulerValidationError)

  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(AutonomousSchedulerValidationError)
    const validationError = error as AutonomousSchedulerValidationError
    for (const issue of expectedIssues) {
      expect(validationError.issues).toContain(issue)
    }
    return
  }

  throw new Error('expected validation error')
}

function fixedClock(): () => Date {
  return () => new Date('2026-04-30T14:30:00.000Z')
}
