#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import {
  JsonlAgentQueue,
  planCodexRunner,
  runSingleAgentRequest,
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
      const plan = planCodexRunner(request, { repoRoot })
      printJson({
        ok: true,
        requestId: plan.requestId,
        branchName: plan.branchName,
        preflightCommands: plan.preflightCommands,
        codexCommand: {
          command: plan.codexCommand.command,
          args: [plan.codexCommand.args[0], '<prompt omitted>'],
          cwd: plan.codexCommand.cwd,
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
    '  plan <request.json> --repo-root <path>',
    '  run-single <queue-dir> <request.json> --repo-root <path> --bundle-dir <path> [--changed-files a,b] [--diff-file path]',
    '',
    'run-single executes git, codex, and gh commands through the production process executor.',
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

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

await main()
