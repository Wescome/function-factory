#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = 'https://ff-pipeline.koales.workers.dev'

const ACTIONS = new Set(['note', 'cancel', 'retry-stage', 'redispatch-stage'])

export function parseControlArgs(argv) {
  const args = {
    baseUrl: process.env.FF_PIPELINE_URL || DEFAULT_BASE_URL,
    token: process.env.FF_OPERATOR_TOKEN || process.env.OPERATOR_CONTROL_TOKEN || '',
    operator: process.env.USER || 'operator',
    idempotencyKey: '',
    json: false,
    action: '',
    runId: '',
    stageName: '',
    message: '',
  }

  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base-url') {
      args.baseUrl = requiredValue(argv, ++i, arg)
    } else if (arg === '--token') {
      args.token = requiredValue(argv, ++i, arg)
    } else if (arg === '--operator') {
      args.operator = requiredValue(argv, ++i, arg)
    } else if (arg === '--idempotency-key') {
      args.idempotencyKey = requiredValue(argv, ++i, arg)
    } else if (arg === '--json') {
      args.json = true
    } else if (arg === '-h' || arg === '--help') {
      args.help = true
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown argument: ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  args.action = positional[0] || ''
  args.runId = positional[1] || ''
  if (args.action === 'retry' || args.action === 'retry-stage') {
    args.action = 'retry-stage'
    args.stageName = positional[2] || ''
    args.message = positional.slice(3).join(' ')
  } else if (args.action === 'redispatch' || args.action === 'redispatch-stage') {
    args.action = 'redispatch-stage'
    args.stageName = positional[2] || ''
    args.message = positional.slice(3).join(' ')
  } else {
    args.message = positional.slice(2).join(' ')
  }

  if (args.help) return args
  if (!ACTIONS.has(args.action)) throw new Error('missing or invalid action')
  if (!args.runId) throw new Error('missing runId')
  if ((args.action === 'retry-stage' || args.action === 'redispatch-stage') && !args.stageName) {
    throw new Error(`${args.action} requires stageName`)
  }
  if (args.action === 'note' && !args.message) throw new Error('note requires message')
  if (!args.token) throw new Error('missing operator token: set FF_OPERATOR_TOKEN')
  if (!args.idempotencyKey && (args.action === 'retry-stage' || args.action === 'redispatch-stage')) {
    args.idempotencyKey = randomUUID()
  }
  return args
}

export function usage() {
  return [
    'Usage:',
    '  node scripts/ops/control-run.mjs note <runId> <message> [options]',
    '  node scripts/ops/control-run.mjs cancel <runId> [reason] [options]',
    '  node scripts/ops/control-run.mjs retry-stage <runId> <stageName> [reason] [options]',
    '  node scripts/ops/control-run.mjs redispatch-stage <runId> <stageName> [reason] [options]',
    '',
    'Options:',
    '  --base-url <url>          Worker base URL; defaults to FF_PIPELINE_URL or production',
    '  --token <token>           Operator token; defaults to FF_OPERATOR_TOKEN',
    '  --operator <name>         Operator label; defaults to USER',
    '  --idempotency-key <key>   Stable key for retry-safe control requests',
    '  --json                    Print raw response JSON',
    '  -h, --help                Show this help',
  ].join('\n')
}

export function buildInterventionRequest(args) {
  const url = new URL(`/run-interventions/${encodeURIComponent(args.runId)}/${args.action}`, normalizeBaseUrl(args.baseUrl))
  const body = {
    operator: args.operator,
    ...(args.action === 'note' ? { note: args.message } : {}),
    ...(args.action === 'cancel' ? { reason: args.message || 'operator cancel requested' } : {}),
    ...(args.action === 'retry-stage' || args.action === 'redispatch-stage'
      ? {
          stageName: args.stageName,
          reason: args.message || `${args.action} requested`,
          idempotencyKey: args.idempotencyKey,
        }
      : {}),
  }
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify(body),
    },
  }
}

export async function postIntervention(fetchFn, args) {
  const request = buildInterventionRequest(args)
  const response = await fetchFn(request.url, request.init)
  const text = await response.text()
  const parsed = parseJson(text)
  if (!response.ok) {
    throw new Error(`POST ${request.url.pathname} failed ${response.status}: ${text.slice(0, 400)}`)
  }
  return parsed
}

export function formatControlResponse(body) {
  const bits = [
    `${body.action || 'intervention'} accepted`,
    body.runId ? `runId=${body.runId}` : '',
    body.stageName ? `stage=${body.stageName}` : '',
    body.attemptNumber ? `attempt=${body.attemptNumber}` : '',
    body.effect?.deduped ? 'deduped=true' : '',
  ].filter(Boolean)
  return bits.join(' ')
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '') || DEFAULT_BASE_URL
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`)
  return value
}

async function main() {
  let args
  try {
    args = parseControlArgs(process.argv.slice(2))
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
    const body = await postIntervention(fetch, args)
    console.log(args.json ? JSON.stringify(body, null, 2) : formatControlResponse(body))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
