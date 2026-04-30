import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AutonomousSchedulerValidationError,
  JsonlAgentQueue,
  buildAgentResultFromExecution,
  buildCodexWorkerPrompt,
  executeCodexRunnerPlan,
  planCodexRunner,
  validateAgentRequest,
  validateAgentResult,
  validateQueueEvent,
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
