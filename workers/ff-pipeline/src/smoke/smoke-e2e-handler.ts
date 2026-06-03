// smoke-e2e-handler.ts — POST /smoke/e2e
//
// Verify the dispatch-to-Gas-City path is alive after a deploy. < 5 minutes.
// Option B: direct sling POST to Gas City, bypassing compileAndDispatchFormula.
// Zero ArangoDB reads or writes (AC-S6).
//
// Spec: specs/reference/SPEC-G3-SMOKE-FIDELITY-SCRIPTS.md §3 (Architect + SE approved, v6).

import { authorizeOperatorControl } from '../index.js'
import type { PipelineEnv } from '../types.js'

type SmokeOutcome = 'approved' | 'failed' | 'skipped'

interface SmokeResult {
  outcome: SmokeOutcome
  workflowId?: string
  durationMs: number
  reason?: string
  detail?: unknown
}

/** GC poll cadence and ceiling per §3.5 timeout budget. */
const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 240_000

const TERMINAL_FAILURE_RE = /fail|reject|exhaust/i

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function handleSmokeE2E(request: Request, env: PipelineEnv): Promise<Response> {
  const startedAt = Date.now()

  // 1. Auth — honor the helper's status (401 missing / 403 invalid / 503 unconfigured).
  const auth = authorizeOperatorControl(request, env)
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status)
  }

  // GAS_CITY env vars live on FormulaCompilerEnv (same cast pattern as index.ts:2040).
  const gcEnv = env as PipelineEnv & import('../compilers/formula-compiler.js').FormulaCompilerEnv
  const baseUrl = gcEnv.GAS_CITY_BASE_URL
  const cityName = gcEnv.GAS_CITY_CITY_NAME
  const bearer = gcEnv.GAS_CITY_BEARER_TOKEN
  const agentName = gcEnv.GAS_CITY_AGENT_NAME

  const missing: string[] = []
  if (!baseUrl) missing.push('GAS_CITY_BASE_URL')
  if (!cityName) missing.push('GAS_CITY_CITY_NAME')
  if (!bearer) missing.push('GAS_CITY_BEARER_TOKEN')
  if (!agentName) missing.push('GAS_CITY_AGENT_NAME')
  if (missing.length > 0) {
    const result: SmokeResult = {
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      reason: 'gas_city_env_not_configured',
      detail: { missing },
    }
    return jsonResponse(result, 500)
  }

  // 2. POST to the Gas City sling endpoint.
  const slingUrl = `${baseUrl}/v0/city/${cityName}/sling`
  const slingBody = {
    formula: 'factory-noop-smoke-v1',
    attached_bead_id: '',
    bead: '',
    target: agentName,
    rig: '',
    scope_kind: 'city',
    scope_ref: cityName,
    force: true,
    vars: {},
  }

  let slingRes: Response
  try {
    slingRes = await fetch(slingUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-GC-Request': '1',
        'X-Trace-ID': crypto.randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slingBody),
    })
  } catch (err) {
    const result: SmokeResult = {
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      reason: 'sling_request_failed',
      detail: { error: err instanceof Error ? err.message : String(err) },
    }
    return jsonResponse(result, 500)
  }

  const slingText = await slingRes.text()
  const slingParsed = tryParseJson(slingText)

  // 3. Sling response handling (precedence order per §3.2 step 3).
  if (slingRes.status === 404 && /template_not_found|not_found|formula/.test(slingText)) {
    // factory-noop-smoke-v1 not yet deployed in gc binary — allow CI to pass.
    const result: SmokeResult = {
      outcome: 'skipped',
      durationMs: Date.now() - startedAt,
      reason: 'noop_formula_not_registered',
    }
    return jsonResponse(result, 200)
  }

  if (slingRes.status < 200 || slingRes.status >= 300) {
    // Any other non-2xx (4xx auth/validation, or 5xx) — surface, do not swallow.
    const result: SmokeResult = {
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      reason: `sling_error_${slingRes.status}`,
      detail: slingParsed ?? slingText,
    }
    return jsonResponse(result, 500)
  }

  if (!slingParsed || slingParsed.status !== 'slung') {
    const result: SmokeResult = {
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      reason: 'sling_rejected',
      detail: slingParsed ?? slingText,
    }
    return jsonResponse(result, 500)
  }

  // HTTP 200 and status === "slung": read the workflow id.
  const workflowId =
    (typeof slingParsed.workflow_id === 'string' && slingParsed.workflow_id) ||
    (typeof slingParsed.root_bead_id === 'string' && slingParsed.root_bead_id) ||
    ''

  if (!workflowId) {
    const result: SmokeResult = {
      outcome: 'failed',
      durationMs: Date.now() - startedAt,
      reason: 'sling_missing_workflow_id',
      detail: slingParsed,
    }
    return jsonResponse(result, 500)
  }

  // 4. Poll for workflow terminal state, every 5s up to 240s.
  const workflowUrl = `${baseUrl}/v0/city/${cityName}/workflow/${workflowId}`
  const pollDeadline = startedAt + POLL_TIMEOUT_MS

  while (Date.now() < pollDeadline) {
    await sleep(POLL_INTERVAL_MS)

    let pollRes: Response
    try {
      pollRes = await fetch(workflowUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-GC-Request': '1',
        },
      })
    } catch {
      // Transient transport failure — keep polling.
      continue
    }

    // Non-200 poll response is transient (row may not be projected yet) — keep polling.
    if (pollRes.status !== 200) {
      // Drain the body so the connection can be reused.
      await pollRes.text().catch(() => '')
      continue
    }

    const pollText = await pollRes.text()
    const pollParsed = tryParseJson(pollText)
    if (!pollParsed) {
      // Unparseable 200 — treat as transient.
      continue
    }

    if (pollParsed.complete === true) {
      const terminalReason =
        typeof pollParsed.terminal_reason === 'string' ? pollParsed.terminal_reason : ''
      if (TERMINAL_FAILURE_RE.test(terminalReason)) {
        const result: SmokeResult = {
          outcome: 'failed',
          workflowId,
          durationMs: Date.now() - startedAt,
          reason: terminalReason || 'terminal_failure',
        }
        return jsonResponse(result, 500)
      }
      const result: SmokeResult = {
        outcome: 'approved',
        workflowId,
        durationMs: Date.now() - startedAt,
      }
      return jsonResponse(result, 200)
    }
    // complete !== true → keep polling.
  }

  // 240s elapsed without terminal state → failed timeout.
  const result: SmokeResult = {
    outcome: 'failed',
    workflowId,
    durationMs: Date.now() - startedAt,
    reason: 'timeout',
  }
  return jsonResponse(result, 500)
}
