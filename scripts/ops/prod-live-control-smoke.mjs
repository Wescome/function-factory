#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  executeInteractiveCommand,
  fetchMonitorSnapshot,
} from './watch-run.mjs'

const DEFAULT_BASE_URL = 'https://ff-pipeline.koales.workers.dev'
const DEFAULT_HARNESS_KEY = 'harnesses/operator-recovery-smoke.harness.yaml'
const DEFAULT_HARNESS_FILE = 'harnesses/operator-recovery-smoke.harness.yaml'
const DEFAULT_REPORT_DIR = 'specs/verification-reports'
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_POLL_MS = 2_500

export function parseSmokeArgs(argv, env = process.env) {
  const args = {
    baseUrl: env.FF_PIPELINE_URL || DEFAULT_BASE_URL,
    token: env.FF_OPERATOR_TOKEN || env.OPERATOR_CONTROL_TOKEN || '',
    operator: env.USER || 'operator',
    harnessKey: DEFAULT_HARNESS_KEY,
    harnessFile: DEFAULT_HARNESS_FILE,
    reportDir: DEFAULT_REPORT_DIR,
    runPrefix: 'prod-live-control',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
    uploadHarness: true,
    writeReport: true,
    json: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base-url') args.baseUrl = requiredValue(argv, ++i, arg)
    else if (arg === '--token') args.token = requiredValue(argv, ++i, arg)
    else if (arg === '--operator') args.operator = requiredValue(argv, ++i, arg)
    else if (arg === '--harness-key') args.harnessKey = requiredValue(argv, ++i, arg)
    else if (arg === '--harness-file') args.harnessFile = requiredValue(argv, ++i, arg)
    else if (arg === '--report-dir') args.reportDir = requiredValue(argv, ++i, arg)
    else if (arg === '--run-prefix') args.runPrefix = requiredValue(argv, ++i, arg)
    else if (arg === '--timeout') args.timeoutMs = parsePositiveNumber(requiredValue(argv, ++i, arg), arg) * 1000
    else if (arg === '--poll') args.pollMs = parsePositiveNumber(requiredValue(argv, ++i, arg), arg) * 1000
    else if (arg === '--skip-harness-upload') args.uploadHarness = false
    else if (arg === '--no-report') args.writeReport = false
    else if (arg === '--json') args.json = true
    else if (arg === '-h' || arg === '--help') args.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }

  if (!args.help && !args.token) throw new Error('missing operator token: set FF_OPERATOR_TOKEN')
  return args
}

export function usage() {
  return [
    'Usage: node scripts/ops/prod-live-control-smoke.mjs [options]',
    '',
    'Runs production live-control smoke checks and writes a Verification Report.',
    '',
    'Options:',
    '  --base-url <url>          Worker base URL; defaults to FF_PIPELINE_URL or production',
    '  --token <token>           Operator token; defaults to FF_OPERATOR_TOKEN',
    '  --operator <name>         Operator label; defaults to USER',
    '  --harness-key <key>       R2 harness key; default harnesses/operator-recovery-smoke.harness.yaml',
    '  --harness-file <path>     Local harness file to upload before running',
    '  --skip-harness-upload     Do not upload the local harness before running',
    '  --report-dir <path>       Report output directory; default specs/verification-reports',
    '  --run-prefix <prefix>     Prefix for generated production run IDs',
    '  --timeout <seconds>       Per-check timeout; default 180',
    '  --poll <seconds>          Monitor poll interval; default 2.5',
    '  --no-report               Run checks without writing the YAML report',
    '  --json                    Print result JSON',
    '  -h, --help                Show this help',
  ].join('\n')
}

export async function runProductionLiveControlSmoke(args, deps = {}) {
  const fetchFn = deps.fetchFn || fetch
  const runCommand = deps.runCommand || runCommandOrThrow
  const now = deps.now || (() => new Date())
  const sleepFn = deps.sleepFn || sleep
  const writeFile = deps.writeFile || writeFileSync
  const mkdir = deps.mkdir || mkdirSync
  const stamp = now().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '')
  const runSuffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const ctx = {
    args,
    fetchFn,
    runCommand,
    sleepFn,
    writeFile,
    runIds: {
      retry: `${args.runPrefix}-retry-${runSuffix}`,
      redispatch: `${args.runPrefix}-redispatch-${runSuffix}`,
      cancel: `${args.runPrefix}-cancel-${runSuffix}`,
    },
    startedAt: now().toISOString(),
    results: [],
  }

  if (args.uploadHarness) uploadHarness(args, runCommand)
  const worker = await getJson(fetchFn, args.baseUrl, '/version')
  await assertUnauthenticatedControlRejected(fetchFn, args)
  await runRetryCheck(ctx)
  await runRedispatchCheck(ctx)
  await runCancelCheck(ctx)

  const report = buildVerificationReport({
    id: `VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-${stamp}`,
    createdAt: now().toISOString(),
    baseUrl: args.baseUrl,
    harnessKey: args.harnessKey,
    worker,
    results: ctx.results,
  })
  const reportPath = args.writeReport
    ? writeVerificationReport(report, args.reportDir, { mkdir, writeFile })
    : ''
  return { ok: report.verdict === 'pass', reportPath, report }
}

export function buildVerificationReport({ id, createdAt, baseUrl, harnessKey, worker, results }) {
  const checks = results.map((result) => ({
    name: result.name,
    verdict: result.ok ? 'pass' : 'fail',
    explicitness: 'explicit',
    rationale: result.rationale,
    evidence: result.evidence,
  }))
  return {
    id,
    artifact_type: 'VerificationReport',
    verification_kind: 'production-live-control-smoke',
    source_refs: ['FN-SYNTH-MIGRATE'],
    created_at: createdAt,
    target: {
      base_url: baseUrl,
      harness_key: harnessKey,
      worker_version_id: worker?.workerVersion?.id ?? 'unknown',
      environment: worker?.environment ?? 'unknown',
    },
    verdict: checks.every((check) => check.verdict === 'pass') ? 'pass' : 'fail',
    checks,
    remediation: checks.every((check) => check.verdict === 'pass')
      ? 'no remediation required'
      : 'inspect failed check evidence and rerun production live-control smoke after remediation',
  }
}

export function writeVerificationReport(report, reportDir, deps = {}) {
  const mkdir = deps.mkdir || mkdirSync
  const writeFile = deps.writeFile || writeFileSync
  mkdir(reportDir, { recursive: true })
  const path = join(reportDir, `${report.id}.yaml`)
  writeFile(path, YAML.stringify(report), 'utf8')
  return path
}

async function runRetryCheck(ctx) {
  const runId = ctx.runIds.retry
  await triggerHarness(ctx.fetchFn, ctx.args, runId, 'production live-control retry smoke')
  await waitForSnapshot(ctx, runId, 'retry stage_failed', hasTimelineEvent('stage_failed', 'SEED'))
  await executeInteractiveCommand(ctx.fetchFn, interactiveArgs(ctx.args, runId), await monitor(ctx, runId), 'n', async () => 'production smoke note before retry')
  await putSeedArtifact(ctx, runId)
  const retry = await executeInteractiveCommand(ctx.fetchFn, interactiveArgs(ctx.args, runId), await monitor(ctx, runId), 'r', async () => 'production smoke retry')
  const final = await waitForSnapshot(ctx, runId, 'retry completed', (snapshot) => snapshot.status === 'completed')
  const ok = retry.refresh === true
    && final.status === 'completed'
    && firstStage(final)?.status === 'pass'
    && countTimeline(final, 'harness_complete') === 1
    && final.interventions?.some((entry) => entry.type === 'operator_note_added')
    && final.interventions?.some((entry) => entry.type === 'stage_retry_requested')
  ctx.results.push({
    name: 'interactive_retry',
    ok,
    rationale: 'Interactive monitor note and retry recover a missing preseed artifact and preserve terminal projection.',
    evidence: {
      run_id: runId,
      control_message: retry.message,
      status: final.status,
      stage_status: firstStage(final)?.status,
      harness_complete_count: countTimeline(final, 'harness_complete'),
      interventions: final.interventions?.map((entry) => entry.type) ?? [],
    },
  })
}

async function runRedispatchCheck(ctx) {
  const runId = ctx.runIds.redispatch
  await triggerHarness(ctx.fetchFn, ctx.args, runId, 'production live-control redispatch smoke')
  await waitForSnapshot(ctx, runId, 'redispatch stage_failed', hasTimelineEvent('stage_failed', 'SEED'))
  await putSeedArtifact(ctx, runId)
  const redispatch = await executeInteractiveCommand(ctx.fetchFn, interactiveArgs(ctx.args, runId), await monitor(ctx, runId), 'd', async () => 'production smoke redispatch')
  const final = await waitForSnapshot(ctx, runId, 'redispatch completed', (snapshot) => snapshot.status === 'completed')
  const ok = redispatch.refresh === true
    && final.status === 'completed'
    && firstStage(final)?.status === 'pass'
    && countTimeline(final, 'harness_complete') === 1
    && final.interventions?.some((entry) => entry.type === 'stage_redispatch_requested')
  ctx.results.push({
    name: 'interactive_redispatch',
    ok,
    rationale: 'Interactive monitor redispatch re-enqueues the current stage without corrupting terminal projection.',
    evidence: {
      run_id: runId,
      control_message: redispatch.message,
      status: final.status,
      stage_status: firstStage(final)?.status,
      harness_complete_count: countTimeline(final, 'harness_complete'),
      interventions: final.interventions?.map((entry) => entry.type) ?? [],
    },
  })
}

async function runCancelCheck(ctx) {
  const runId = ctx.runIds.cancel
  await triggerHarness(ctx.fetchFn, ctx.args, runId, 'production live-control cancel smoke')
  await waitForSnapshot(ctx, runId, 'cancel stage_started', hasTimelineEvent('stage_started', 'SEED'))
  const cancel = await executeInteractiveCommand(ctx.fetchFn, interactiveArgs(ctx.args, runId), await monitor(ctx, runId), 'c', async (question) =>
    question.toLowerCase().includes('confirm') ? 'cancel' : 'production smoke cancel')
  const final = await waitForSnapshot(ctx, runId, 'cancel terminal', (snapshot) =>
    snapshot.status === 'failed' || snapshot.summary?.errorClass === 'operator_cancelled')
  const ok = cancel.refresh === true
    && final.summary?.errorClass === 'operator_cancelled'
    && final.interventions?.some((entry) => entry.type === 'run_cancel_requested')
  ctx.results.push({
    name: 'interactive_cancel',
    ok,
    rationale: 'Interactive monitor cancel requires confirmation and records operator_cancelled terminal evidence.',
    evidence: {
      run_id: runId,
      control_message: cancel.message,
      status: final.status,
      error_class: final.summary?.errorClass,
      interventions: final.interventions?.map((entry) => entry.type) ?? [],
    },
  })
}

function uploadHarness(args, runCommand) {
  runCommand('pnpm', [
    '--filter', '@factory/ff-pipeline', 'exec', 'wrangler', 'r2', 'object', 'put',
    `ff-workspaces/${args.harnessKey}`,
    '--file', `../../${args.harnessFile}`,
    '--remote',
  ])
}

async function putSeedArtifact(ctx, runId) {
  const path = `/tmp/${runId}-SeedWorkspace.json`
  ctx.writeFile(path, JSON.stringify({
    schemaVersion: '1.0',
    files: [{ path: 'README.md', content: `operator supplied seed for ${runId}` }],
  }, null, 2), 'utf8')
  ctx.runCommand('pnpm', [
    '--filter', '@factory/ff-pipeline', 'exec', 'wrangler', 'r2', 'object', 'put',
    `ff-workspaces/runs/${runId}/artifacts/SeedWorkspace`,
    '--file', path,
    '--remote',
  ])
}

async function assertUnauthenticatedControlRejected(fetchFn, args) {
  const response = await fetchFn(new URL('/run-interventions/prod-smoke-auth-probe/note', normalizedBaseUrl(args.baseUrl)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'unauthenticated probe' }),
  })
  if (response.status !== 401) {
    const text = await response.text()
    throw new Error(`unauthenticated control expected 401, got ${response.status}: ${text.slice(0, 400)}`)
  }
}

async function triggerHarness(fetchFn, args, runId, objective) {
  await postJson(fetchFn, args.baseUrl, '/trigger-harness', {
    functionRunId: runId,
    objective,
    harnessKey: args.harnessKey,
  })
}

async function waitForSnapshot(ctx, runId, label, predicate) {
  const started = Date.now()
  let last
  while (Date.now() - started < ctx.args.timeoutMs) {
    try {
      last = await monitor(ctx, runId)
      if (predicate(last)) return last
    } catch (err) {
      last = { error: err instanceof Error ? err.message : String(err) }
    }
    await ctx.sleepFn(ctx.args.pollMs)
  }
  throw new Error(`timeout waiting for ${label} on ${runId}: ${JSON.stringify(last).slice(0, 1200)}`)
}

async function monitor(ctx, runId) {
  return fetchMonitorSnapshot(ctx.fetchFn, ctx.args.baseUrl, runId, 250)
}

function interactiveArgs(args, runId) {
  return {
    baseUrl: args.baseUrl,
    token: args.token,
    operator: args.operator,
    runId,
  }
}

function hasTimelineEvent(type, stageName) {
  return (snapshot) => Array.isArray(snapshot.timeline)
    && snapshot.timeline.some((event) => event.type === type && (!stageName || event.stageName === stageName))
}

function firstStage(snapshot) {
  return Array.isArray(snapshot.stages) ? snapshot.stages[0] : undefined
}

function countTimeline(snapshot, type) {
  return Array.isArray(snapshot.timeline) ? snapshot.timeline.filter((event) => event.type === type).length : 0
}

async function getJson(fetchFn, baseUrl, path) {
  const response = await fetchFn(new URL(path, normalizedBaseUrl(baseUrl)))
  const text = await response.text()
  if (!response.ok) throw new Error(`GET ${path} failed ${response.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

async function postJson(fetchFn, baseUrl, path, body) {
  const response = await fetchFn(new URL(path, normalizedBaseUrl(baseUrl)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`POST ${path} failed ${response.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

function runCommandOrThrow(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).slice(0, 1200)}`)
  }
  return result.stdout
}

function normalizedBaseUrl(value) {
  return String(value).replace(/\/+$/, '') || DEFAULT_BASE_URL
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be positive`)
  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  let args
  try {
    args = parseSmokeArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error('')
    console.error(usage())
    process.exitCode = 2
    return
  }

  if (args.help) {
    console.log(usage())
    return
  }

  try {
    const result = await runProductionLiveControlSmoke(args)
    console.log(args.json ? JSON.stringify(result, null, 2) : `production live-control smoke ${result.ok ? 'passed' : 'failed'} report=${result.reportPath || '<not written>'}`)
    if (!result.ok) process.exitCode = 1
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
