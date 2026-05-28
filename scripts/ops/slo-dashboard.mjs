#!/usr/bin/env node

const DEFAULT_BASE = process.env.FF_BASE_URL || 'https://ff-pipeline.koales.workers.dev'
const TIMEOUT_MS = Number(process.env.FF_SLO_TIMEOUT_MS || 15000)

const args = new Set(process.argv.slice(2))
const jsonMode = args.has('--json')
const strictMode = args.has('--strict')
const baseUrl = (process.env.FF_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')

async function fetchJson(path, init = {}) {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        ...(init.headers || {})
      }
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : null
    return {
      ok: response.ok,
      status: response.status,
      data,
      elapsed_ms: Date.now() - startedAt
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt
    }
  }
}

export function ageMinutes(isoTimestamp) {
  if (!isoTimestamp || Number.isNaN(Date.parse(isoTimestamp))) return null
  return Math.floor((Date.now() - Date.parse(isoTimestamp)) / 60000)
}

export function evaluateSlos(snapshot) {
  const health = snapshot.health?.data || {}
  const version = snapshot.version?.data || {}
  const autonomy = snapshot.autonomy?.data || {}
  const latestPersistence = Array.isArray(autonomy.recent_persistence) ? autonomy.recent_persistence[0] : null

  const checks = [
    {
      key: 'service_health',
      target: 'debug/health reports healthy + arango + aiBinding',
      pass: snapshot.health.ok && health.status === 'healthy' && health.arango === true && health.aiBinding === true
    },
    {
      key: 'autonomy_status',
      target: 'gascity/autonomy/status reports ok=true',
      pass: snapshot.autonomy.ok && autonomy.ok === true
    },
    {
      key: 'autonomy_coverage',
      target: 'at least one monitored function',
      pass: Number(autonomy.function_states?.monitored || 0) >= 1
    },
    {
      key: 'open_incidents',
      target: 'no open incidents',
      pass: Array.isArray(autonomy.open_incidents) && autonomy.open_incidents.length === 0
    },
    {
      key: 'persistence_freshness',
      target: 'latest persistence report age <= 26h',
      pass: latestPersistence != null && ageMinutes(latestPersistence.timestamp) != null && ageMinutes(latestPersistence.timestamp) <= 1560
    },
    {
      key: 'deploy_freshness',
      target: 'worker deploy age <= 48h',
      pass:
        snapshot.version.ok &&
        ageMinutes(version.workerVersion?.timestamp) != null &&
        ageMinutes(version.workerVersion?.timestamp) <= 2880
    }
  ]

  return {
    checks,
    summary: {
      pass: checks.every((check) => check.pass),
      total: checks.length,
      passed: checks.filter((check) => check.pass).length
    }
  }
}

function printTable(result, snapshot) {
  console.log(`SLO Dashboard — ${baseUrl}`)
  console.log(`Generated: ${new Date().toISOString()}`)
  console.log('')
  for (const check of result.checks) {
    const mark = check.pass ? 'PASS' : 'FAIL'
    console.log(`${mark}  ${check.key}  (${check.target})`)
  }
  console.log('')
  console.log(`Summary: ${result.summary.passed}/${result.summary.total} checks passing`)
  console.log(`Health endpoint: ${snapshot.health.status} (${snapshot.health.elapsed_ms}ms)`)
  console.log(`Version endpoint: ${snapshot.version.status} (${snapshot.version.elapsed_ms}ms)`)
  console.log(`Autonomy endpoint: ${snapshot.autonomy.status} (${snapshot.autonomy.elapsed_ms}ms)`)
}

export async function main() {
  const [version, health, autonomy] = await Promise.all([
    fetchJson('/version'),
    fetchJson('/debug/health'),
    fetchJson('/gascity/autonomy/status')
  ])

  const snapshot = { version, health, autonomy }
  const result = evaluateSlos(snapshot)

  if (jsonMode) {
    console.log(JSON.stringify({ base_url: baseUrl, generated_at: new Date().toISOString(), summary: result.summary, checks: result.checks, snapshot }, null, 2))
  } else {
    printTable(result, snapshot)
  }

  if (strictMode && !result.summary.pass) {
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
