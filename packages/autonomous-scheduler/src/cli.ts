#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  JsonlAgentQueue,
  createStrategyRecipesDogfoodRunPaths,
  createDryRunCommandExecutor,
  planCodexRunner,
  runQueueDaemon,
  runSingleAgentRequest,
  runStrategyRecipesDogfood,
  validateAgentRequest,
} from './index.js'

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  const cliArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const [command, ...args] = cliArgs

  try {
    if (!command || command === 'help' || command === '--help') {
      printHelp()
      return
    }

    if (command === 'validate-request') {
      const request = validateAgentRequest(await readJson(requiredArg(args, 0, 'request file')))
      printJson({
        ok: true,
        id: request.id,
        role: request.role,
        repo: request.repo,
        workgraph: request.workgraph,
      })
      return
    }

    if (command === 'enqueue') {
      const queue = new JsonlAgentQueue({
        queueDir: requiredArg(args, 0, 'queue dir'),
        actor: option(args, '--actor') ?? 'factory-governor',
      })
      const request = await queue.enqueue(await readJson(requiredArg(args, 1, 'request file')))
      printJson({ ok: true, enqueued: request.id, status: await queue.status() })
      return
    }

    if (command === 'claim') {
      const queueOptions: ConstructorParameters<typeof JsonlAgentQueue>[0] = {
        queueDir: requiredArg(args, 0, 'queue dir'),
        actor: option(args, '--actor') ?? 'factory-runner',
      }
      const leaseMs = numberOption(args, '--lease-ms')
      if (leaseMs !== undefined) queueOptions.leaseMs = leaseMs
      const queue = new JsonlAgentQueue(queueOptions)
      const request = await queue.claimNext()
      printJson({ ok: true, claimed: request?.id ?? null })
      return
    }

    if (command === 'heartbeat') {
      const queueOptions: ConstructorParameters<typeof JsonlAgentQueue>[0] = {
        queueDir: requiredArg(args, 0, 'queue dir'),
        actor: option(args, '--actor') ?? 'factory-runner',
      }
      const leaseMs = numberOption(args, '--lease-ms')
      if (leaseMs !== undefined) queueOptions.leaseMs = leaseMs
      const queue = new JsonlAgentQueue(queueOptions)
      const claim = await queue.heartbeat(requiredArg(args, 1, 'request id'))
      printJson({ ok: true, claim })
      return
    }

    if (command === 'status') {
      const queue = new JsonlAgentQueue({
        queueDir: requiredArg(args, 0, 'queue dir'),
        actor: option(args, '--actor') ?? 'factory-governor',
      })
      printJson({ ok: true, status: await queue.status(), events: await queue.listEvents() })
      return
    }

    if (command === 'plan') {
      const request = await readJson(requiredArg(args, 0, 'request file'))
      const repoRoot = requiredOption(args, '--repo-root')
      const codexTimeoutMs = numberOption(args, '--codex-timeout-ms')
      const planOptions: Parameters<typeof planCodexRunner>[1] = { repoRoot }
      if (codexTimeoutMs !== undefined) planOptions.codexTimeoutMs = codexTimeoutMs
      const plan = planCodexRunner(request, planOptions)
      printJson({
        ok: true,
        requestId: plan.requestId,
        branchName: plan.branchName,
        preflightCommands: plan.preflightCommands,
        codexCommand: {
          command: plan.codexCommand.command,
          args: [
            plan.codexCommand.args[0],
            ...plan.codexCommand.args.slice(1, -1),
            '<prompt omitted>',
          ],
          cwd: plan.codexCommand.cwd,
          timeoutMs: plan.codexCommand.timeoutMs,
        },
        prompt: plan.prompt,
      })
      return
    }

    if (command === 'run-single') {
      const queueDir = requiredArg(args, 0, 'queue dir')
      const requestPath = requiredArg(args, 1, 'request file')
      const request = validateAgentRequest(await readJson(requestPath))
      const repoRoot = requiredOption(args, '--repo-root')
      const bundleDir = requiredOption(args, '--bundle-dir')
      const now = new Date().toISOString()
      const stamp = now.replace(/[^0-9TZ]/g, '')
      const resultId = option(args, '--result-id') ?? `ARES-${request.id.slice(3)}-${stamp}`
      const agentRunId = option(args, '--agent-run-id') ?? `RUN-${request.id.slice(3)}-${stamp}`
      const changedFiles = csvOption(args, '--changed-files')
      const diffFile = option(args, '--diff-file')
      const diff = diffFile ? await readFile(diffFile, 'utf8') : undefined
      const dryRunExecutor = hasFlag(args, '--dry-run')
        ? createDryRunExecutorFromArgs(args)
        : undefined

      const runOptions: Parameters<typeof runSingleAgentRequest>[1] = {
        queue: new JsonlAgentQueue({ queueDir, actor: option(args, '--actor') ?? 'factory-governor' }),
        repoRoot,
        bundleDir,
        resultId,
        agentRunId,
        completedAt: now,
      }
      if (changedFiles) runOptions.changedFiles = changedFiles
      if (diff !== undefined) runOptions.diff = diff
      const codexTimeoutMs = numberOption(args, '--codex-timeout-ms')
      if (codexTimeoutMs !== undefined) runOptions.codexTimeoutMs = codexTimeoutMs
      if (dryRunExecutor) {
        runOptions.codexExecutor = dryRunExecutor
        runOptions.pullRequestExecutor = dryRunExecutor
      }

      const outcome = await runSingleAgentRequest(request, runOptions)

      printJson({
        ok: true,
        requestId: outcome.request.id,
        status: outcome.result.status,
        prUrl: outcome.result.prUrl ?? null,
        bundle: outcome.bundle,
      })
      return
    }

    if (command === 'daemon') {
      const queueDir = requiredArg(args, 0, 'queue dir')
      const repoRoot = requiredOption(args, '--repo-root')
      const bundleRoot = requiredOption(args, '--bundle-root')
      const daemonOptions: Parameters<typeof runQueueDaemon>[0] = {
        queue: new JsonlAgentQueue({ queueDir, actor: option(args, '--actor') ?? 'factory-daemon' }),
        repoRoot,
        bundleRoot,
        pollIntervalMs: numberOption(args, '--poll-ms') ?? 5_000,
      }
      const maxIterations = numberOption(args, '--max-iterations')
      if (maxIterations !== undefined) daemonOptions.maxIterations = maxIterations
      const codexTimeoutMs = numberOption(args, '--codex-timeout-ms')
      if (codexTimeoutMs !== undefined) daemonOptions.codexTimeoutMs = codexTimeoutMs
      const dryRunExecutor = hasFlag(args, '--dry-run')
        ? createDryRunExecutorFromArgs(args)
        : undefined
      if (dryRunExecutor) {
        daemonOptions.codexExecutor = dryRunExecutor
        daemonOptions.pullRequestExecutor = dryRunExecutor
      }

      const outcome = await runQueueDaemon(daemonOptions)

      printJson({ ok: true, outcome })
      return
    }

    if (command === 'dogfood-strategy-recipes') {
      const requestPath = option(args, '--request') ?? fileURLToPath(
        new URL('../fixtures/strategy-recipes-agent-request.json', import.meta.url),
      )
      const home = option(args, '--home') ?? join(process.env.HOME ?? process.cwd(), '.factory', 'dogfood')
      const paths = createStrategyRecipesDogfoodRunPaths(join(home, 'strategy-recipes'))
      const queueDir = option(args, '--queue-dir') ?? paths.queueDir
      const bundleDir = option(args, '--bundle-dir') ?? paths.bundleDir
      const repoRoot = option(args, '--repo-root') ?? process.env.STRATEGY_RECIPES_REPO ?? '/Users/wes/Developer/strategy-recipes'
      const dogfoodOptions: Parameters<typeof runStrategyRecipesDogfood>[0] = {
        request: await readJson(requestPath),
        repoRoot,
        queueDir,
        bundleDir,
        mode: hasFlag(args, '--real') ? 'real' : 'dry-run',
      }
      const changedFiles = csvOption(args, '--changed-files')
      const mockPrUrl = option(args, '--mock-pr-url')
      const branchNameSuffix = option(args, '--branch-suffix')
      if (changedFiles) dogfoodOptions.changedFiles = changedFiles
      if (mockPrUrl) dogfoodOptions.mockPrUrl = mockPrUrl
      if (branchNameSuffix) dogfoodOptions.branchNameSuffix = branchNameSuffix
      const codexTimeoutMs = numberOption(args, '--codex-timeout-ms')
      if (codexTimeoutMs !== undefined) dogfoodOptions.codexTimeoutMs = codexTimeoutMs

      const dogfood = await runStrategyRecipesDogfood(dogfoodOptions)

      printJson({
        ok: true,
        mode: dogfood.mode,
        repoRoot: dogfood.repoRoot,
        queueDir: dogfood.queueDir,
        bundleDir: dogfood.bundleDir,
        requestId: dogfood.outcome.request.id,
        status: dogfood.outcome.result.status,
        prUrl: dogfood.outcome.result.prUrl ?? null,
        bundle: dogfood.outcome.bundle,
      })
      return
    }

    throw new Error(`Unknown command: ${command}`)
  } catch (error) {
    process.exitCode = 1
    printJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function printHelp(): void {
  console.log([
    'factory autonomous scheduler CLI',
    '',
    'Commands:',
    '  validate-request <request.json>',
    '  enqueue <queue-dir> <request.json> [--actor name]',
    '  claim <queue-dir> [--actor name] [--lease-ms n]',
    '  heartbeat <queue-dir> <request-id> [--actor name] [--lease-ms n]',
    '  status <queue-dir> [--actor name]',
    '  plan <request.json> --repo-root <path> [--codex-timeout-ms n]',
    '  run-single <queue-dir> <request.json> --repo-root <path> --bundle-dir <path> [--changed-files a,b] [--diff-file path] [--codex-timeout-ms n] [--dry-run]',
    '  daemon <queue-dir> --repo-root <path> --bundle-root <path> [--poll-ms n] [--max-iterations n] [--codex-timeout-ms n] [--dry-run]',
    '  dogfood-strategy-recipes [--repo-root path] [--home path] [--request path] [--branch-suffix text] [--codex-timeout-ms n] [--real]',
    '',
    'run-single and daemon execute git, codex, and gh commands unless --dry-run is supplied.',
    'dogfood-strategy-recipes defaults to dry-run mode.',
  ].join('\n'))
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function requiredArg(args: string[], index: number, label: string): string {
  const value = args[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing ${label}`)
  }
  return value
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name)
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function csvOption(args: string[], name: string): string[] | undefined {
  const value = option(args, name)
  if (!value) return undefined
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function numberOption(args: string[], name: string): number | undefined {
  const value = option(args, name)
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return parsed
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function createDryRunExecutorFromArgs(args: string[]): ReturnType<typeof createDryRunCommandExecutor> {
  const options: Parameters<typeof createDryRunCommandExecutor>[0] = {}
  const prUrl = option(args, '--mock-pr-url')
  if (prUrl) options.prUrl = prUrl
  return createDryRunCommandExecutor(options)
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

await main()
