#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { formatControlResponse, postIntervention } from './control-run.mjs'

const DEFAULT_BASE_URL = 'https://ff-pipeline.koales.workers.dev'
const DEFAULT_INTERVAL_MS = 5_000
const DEFAULT_EVENT_LIMIT = 12
const DEFAULT_LOG_LINES = 24
const INTERACTIVE_ACTIONS = new Set(['', 'n', 'r', 'd', 'c', 'q'])

export function parseArgs(argv) {
  const args = {
    baseUrl: process.env.FF_PIPELINE_URL || DEFAULT_BASE_URL,
    token: process.env.FF_OPERATOR_TOKEN || process.env.OPERATOR_CONTROL_TOKEN || '',
    operator: process.env.USER || 'operator',
    intervalMs: DEFAULT_INTERVAL_MS,
    eventLimit: DEFAULT_EVENT_LIMIT,
    logLines: DEFAULT_LOG_LINES,
    once: false,
    json: false,
    interactive: false,
    noClear: false,
    logs: 'active',
    runId: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base-url') {
      args.baseUrl = requiredValue(argv, ++i, arg)
    } else if (arg === '--interval') {
      args.intervalMs = parsePositiveNumber(requiredValue(argv, ++i, arg), arg) * 1000
    } else if (arg === '--limit') {
      args.eventLimit = parsePositiveInteger(requiredValue(argv, ++i, arg), arg)
    } else if (arg === '--log-lines') {
      args.logLines = parsePositiveInteger(requiredValue(argv, ++i, arg), arg)
    } else if (arg === '--logs') {
      args.logs = requiredValue(argv, ++i, arg)
    } else if (arg === '--token') {
      args.token = requiredValue(argv, ++i, arg)
    } else if (arg === '--operator') {
      args.operator = requiredValue(argv, ++i, arg)
    } else if (arg === '--once') {
      args.once = true
    } else if (arg === '--json') {
      args.json = true
      args.once = true
    } else if (arg === '--interactive') {
      args.interactive = true
    } else if (arg === '--no-clear') {
      args.noClear = true
    } else if (arg === '-h' || arg === '--help') {
      args.help = true
    } else if (!arg.startsWith('-') && !args.runId) {
      args.runId = arg
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (!args.help && !args.runId) {
    throw new Error('missing runId')
  }
  if (!args.help && args.interactive && args.json) {
    throw new Error('--interactive cannot be combined with --json')
  }
  if (!args.help && args.interactive && !args.token) {
    throw new Error('missing operator token: set FF_OPERATOR_TOKEN')
  }
  return args
}

export function usage() {
  return [
    'Usage: node scripts/ops/watch-run.mjs <runId> [options]',
    '',
    'Options:',
    '  --once                 Print one snapshot and exit',
    '  --json                 Print raw /run-monitor JSON and exit',
    '  --base-url <url>       Worker base URL; defaults to FF_PIPELINE_URL or production',
    '  --interval <seconds>   Poll interval; default 5',
    '  --limit <count>        Recent timeline events; default 12',
    '  --logs <stage|active|none>',
    '                         Attempt log to tail; default active',
    '  --log-lines <count>    Attempt log tail lines; default 24',
    '  --interactive          Prompt for note/retry/redispatch/cancel controls',
    '  --token <token>        Operator token for --interactive; defaults to FF_OPERATOR_TOKEN',
    '  --operator <name>      Operator label for --interactive; defaults to USER',
    '  --no-clear             Do not clear the terminal between polls',
    '  -h, --help             Show this help',
  ].join('\n')
}

export async function fetchMonitorSnapshot(fetchFn, baseUrl, runId, limit) {
  const url = new URL(`/run-monitor/${encodeURIComponent(runId)}`, normalizeBaseUrl(baseUrl))
  url.searchParams.set('limit', String(limit))
  const response = await fetchFn(url)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GET ${url.pathname} failed ${response.status}: ${text.slice(0, 400)}`)
  }
  return JSON.parse(text)
}

export async function fetchAttemptLog(fetchFn, baseUrl, runId, stageName) {
  if (!stageName) return null
  const url = new URL(`/run-status/${encodeURIComponent(runId)}`, normalizeBaseUrl(baseUrl))
  url.searchParams.set('logs', stageName)
  const response = await fetchFn(url)
  if (response.status === 404) return null
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GET ${url.pathname}?logs=${stageName} failed ${response.status}: ${text.slice(0, 400)}`)
  }
  return {
    stageName,
    key: response.headers.get('X-Run-Log-Key') || '',
    text,
  }
}

export function selectLogStage(snapshot, logsArg) {
  if (!logsArg || logsArg === 'none') return ''
  if (logsArg !== 'active') return logsArg
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  const running = stages.find((stage) => stage.status === 'running')
  if (running?.name) return running.name
  if (snapshot.currentStage) return snapshot.currentStage
  const last = [...stages].reverse().find((stage) => stage.name)
  return last?.name || ''
}

export function formatSnapshot(snapshot, attemptLog, now = new Date()) {
  const lines = []
  lines.push(`Function Factory Run Monitor  ${now.toISOString()}`)
  lines.push(`runId: ${snapshot.runId}`)
  lines.push(`status: ${snapshot.status}${snapshot.currentStage ? `  currentStage: ${snapshot.currentStage}` : ''}`)
  lines.push(`updatedAt: ${snapshot.updatedAt || snapshot.summary?.lastEventAt || 'unknown'}`)
  lines.push('')
  lines.push('Stages')
  lines.push(formatStageTable(Array.isArray(snapshot.stages) ? snapshot.stages : []))
  lines.push('')
  lines.push('Recent Timeline')
  lines.push(formatTimeline(Array.isArray(snapshot.timeline) ? snapshot.timeline : []))
  lines.push('')
  lines.push('Artifacts')
  lines.push(formatArtifacts(Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []))
  lines.push('')
  lines.push('Diagnostics')
  lines.push(formatDiagnostics(snapshot.diagnostics || {}))
  lines.push('')
  lines.push('Interventions')
  lines.push(formatInterventions(Array.isArray(snapshot.interventions) ? snapshot.interventions : []))
  if (attemptLog) {
    lines.push('')
    lines.push(`Attempt Log: ${attemptLog.stageName}${attemptLog.key ? `  ${attemptLog.key}` : ''}`)
    lines.push(tailLines(attemptLog.text, DEFAULT_LOG_LINES))
  }
  return lines.join('\n')
}

export function formatStageTable(stages) {
  if (stages.length === 0) return '  none'
  const rows = stages.map((stage) => ({
    stage: stage.name || '',
    status: stage.status || 'unknown',
    worker: stage.worker || '',
    attempts: String(stage.attempts ?? ''),
    artifacts: Array.isArray(stage.artifacts) ? stage.artifacts.join(',') : '',
  }))
  const widths = {
    stage: Math.max(5, ...rows.map((row) => row.stage.length)),
    status: Math.max(6, ...rows.map((row) => row.status.length + 2)),
    worker: Math.max(6, ...rows.map((row) => row.worker.length)),
    attempts: Math.max(8, ...rows.map((row) => row.attempts.length)),
  }
  const header = [
    pad('stage', widths.stage),
    pad('status', widths.status),
    pad('worker', widths.worker),
    pad('attempts', widths.attempts),
    'artifacts',
  ].join('  ')
  const body = rows.map((row) => [
    pad(row.stage, widths.stage),
    pad(`${statusMark(row.status)} ${row.status}`, widths.status),
    pad(row.worker, widths.worker),
    pad(row.attempts, widths.attempts),
    row.artifacts,
  ].join('  '))
  return [header, ...body].map((line) => `  ${line}`).join('\n')
}

export function formatTimeline(timeline) {
  if (timeline.length === 0) return '  none'
  return timeline.map((event) => {
    const stage = event.stageName ? ` ${event.stageName}` : ''
    const attempt = event.attemptNumber ? `#${event.attemptNumber}` : ''
    const detail = event.error || event.message || ''
    return `  ${event.at || ''}  ${event.type || ''}${stage}${attempt}${detail ? `  ${detail}` : ''}`
  }).join('\n')
}

export function formatArtifacts(artifacts) {
  if (artifacts.length === 0) return '  none'
  return artifacts.map((artifact) => `  ${artifact.name || ''}${artifact.stage ? `  stage=${artifact.stage}` : ''}${artifact.key ? `  ${artifact.key}` : ''}`).join('\n')
}

export function formatDiagnostics(diagnostics) {
  const observations = Array.isArray(diagnostics.observations) ? diagnostics.observations : []
  const contractEvaluations = Array.isArray(diagnostics.contractEvaluations) ? diagnostics.contractEvaluations : []
  return [
    `  observations: ${observations.length}`,
    `  contractEvaluations: ${contractEvaluations.length}`,
    ...(diagnostics.attemptLogsPrefix ? [`  attemptLogsPrefix: ${diagnostics.attemptLogsPrefix}`] : []),
  ].join('\n')
}

export function formatInterventions(interventions) {
  if (interventions.length === 0) return '  none'
  return interventions.map((entry) => {
    const stage = entry.stageName ? ` ${entry.stageName}` : ''
    const operator = entry.operator ? ` operator=${entry.operator}` : ''
    const effect = entry.effect ? ` effect=${entry.effect}` : ''
    const message = entry.message ? `  ${entry.message}` : ''
    return `  ${entry.at || ''}  ${entry.type || ''}${stage}${operator}${effect}${message}`
  }).join('\n')
}

export function tailLines(text, maxLines) {
  const lines = String(text).replace(/\s+$/, '').split(/\r?\n/)
  return lines.slice(-Math.max(1, maxLines)).map((line) => `  ${line}`).join('\n')
}

export function currentStageName(snapshot) {
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  const running = stages.find((stage) => stage.status === 'running')
  return running?.name || snapshot.currentStage || [...stages].reverse().find((stage) => stage.name)?.name || ''
}

export function buildInteractiveControlArgs(args, snapshot, action, message) {
  const stageName = action === 'retry-stage' || action === 'redispatch-stage' ? currentStageName(snapshot) : ''
  if ((action === 'retry-stage' || action === 'redispatch-stage') && !stageName) {
    throw new Error(`${action} requires an active stage`)
  }
  return {
    baseUrl: args.baseUrl,
    token: args.token,
    operator: args.operator,
    idempotencyKey: action === 'retry-stage' || action === 'redispatch-stage'
      ? `${action}:${args.runId}:${stageName}:${randomUUID()}`
      : '',
    json: false,
    action,
    runId: args.runId,
    stageName,
    message,
  }
}

export async function executeInteractiveCommand(fetchFn, args, snapshot, command, promptFn) {
  const normalized = command.trim().toLowerCase()
  if (!INTERACTIVE_ACTIONS.has(normalized)) {
    return { refresh: false, message: `unknown command: ${command}` }
  }
  if (normalized === 'q') return { quit: true, refresh: false, message: 'quit' }
  if (normalized === '') return { refresh: true, message: 'refresh' }

  let action = ''
  let message = ''
  if (normalized === 'n') {
    action = 'note'
    message = (await promptFn('Note: ')).trim()
    if (!message) return { refresh: false, message: 'note skipped' }
  } else if (normalized === 'r') {
    action = 'retry-stage'
    message = (await promptFn(`Retry ${currentStageName(snapshot) || 'current stage'} reason: `)).trim() || 'operator retry requested'
  } else if (normalized === 'd') {
    action = 'redispatch-stage'
    message = (await promptFn(`Redispatch ${currentStageName(snapshot) || 'current stage'} reason: `)).trim() || 'operator redispatch requested'
  } else if (normalized === 'c') {
    const confirmation = (await promptFn('Type cancel to confirm: ')).trim().toLowerCase()
    if (confirmation !== 'cancel') return { refresh: false, message: 'cancel aborted' }
    action = 'cancel'
    message = (await promptFn('Cancel reason: ')).trim() || 'operator cancel requested'
  }

  const body = await postIntervention(fetchFn, buildInteractiveControlArgs(args, snapshot, action, message))
  return {
    refresh: true,
    body,
    message: formatControlResponse(body),
  }
}

async function renderOnce(args, fetchFn = fetch) {
  const snapshot = await fetchMonitorSnapshot(fetchFn, args.baseUrl, args.runId, args.eventLimit)
  if (args.json) {
    return JSON.stringify(snapshot, null, 2)
  }
  const stageName = selectLogStage(snapshot, args.logs)
  const attemptLog = stageName ? await fetchAttemptLog(fetchFn, args.baseUrl, args.runId, stageName) : null
  return formatSnapshot(snapshot, attemptLog ? { ...attemptLog, text: tailRaw(attemptLog.text, args.logLines) } : null)
}

async function renderSnapshot(args, fetchFn = fetch) {
  const snapshot = await fetchMonitorSnapshot(fetchFn, args.baseUrl, args.runId, args.eventLimit)
  const stageName = selectLogStage(snapshot, args.logs)
  const attemptLog = stageName ? await fetchAttemptLog(fetchFn, args.baseUrl, args.runId, stageName) : null
  return {
    snapshot,
    output: formatSnapshot(snapshot, attemptLog ? { ...attemptLog, text: tailRaw(attemptLog.text, args.logLines) } : null),
  }
}

async function runInteractive(args, fetchFn = fetch) {
  const rl = createInterface({ input, output })
  try {
    let notice = ''
    while (true) {
      const rendered = await renderSnapshot(args, fetchFn)
      if (!args.noClear && process.stdout.isTTY) process.stdout.write('\x1Bc')
      console.log(rendered.output)
      if (notice) {
        console.log('')
        console.log(`Control: ${notice}`)
        notice = ''
      }
      console.log('')
      const command = await rl.question('Action [enter refresh, n note, r retry, d redispatch, c cancel, q quit]: ')
      try {
        const result = await executeInteractiveCommand(fetchFn, args, rendered.snapshot, command, (question) => rl.question(question))
        if (result.quit) return
        notice = result.message || ''
      } catch (err) {
        notice = err instanceof Error ? err.message : String(err)
      }
    }
  } finally {
    rl.close()
  }
}

function tailRaw(text, maxLines) {
  return String(text).replace(/\s+$/, '').split(/\r?\n/).slice(-Math.max(1, maxLines)).join('\n')
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
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

  if (args.interactive) {
    await runInteractive(args)
    return
  }

  while (true) {
    try {
      const output = await renderOnce(args)
      if (!args.noClear && !args.once && process.stdout.isTTY) process.stdout.write('\x1Bc')
      console.log(output)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      if (args.once) {
        process.exitCode = 1
        return
      }
    }

    if (args.once) return
    await sleep(args.intervalMs)
  }
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

function parsePositiveInteger(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`
}

function statusMark(status) {
  if (status === 'pass') return 'OK'
  if (status === 'fail') return '!!'
  if (status === 'running') return '..'
  return '??'
}

function pad(value, width) {
  return String(value).padEnd(width, ' ')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
