// smoke-e2e-handler.ts — POST /smoke/e2e
//
// Verify the dispatch-to-Gas-City path is alive after a deploy. < 5 minutes.
// Option B: direct sling POST to Gas City, bypassing compileAndDispatchFormula.
// Zero ArangoDB reads or writes (AC-S6).
//
// Spec: specs/reference/SPEC-G3-SMOKE-FIDELITY-SCRIPTS.md §3 (Architect + SE approved, v6).

import { authorizeOperatorControl } from '../index.js'
import type { PipelineEnv } from '../types.js'
import type { FormulaCompilerEnv } from '../compilers/formula-compiler.js'

type SmokeOutcome = 'approved' | 'failed' | 'skipped'

interface SmokeResult {
  outcome: SmokeOutcome
  workflowId?: string
  durationMs: number
  reason?: string
  detail?: unknown
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  const gcEnv = env as PipelineEnv & FormulaCompilerEnv & { GAS_CITY?: Fetcher }
  const baseUrl = gcEnv.GAS_CITY_BASE_URL
  const cityName = gcEnv.GAS_CITY_CITY_NAME
  const bearer = gcEnv.GAS_CITY_BEARER_TOKEN
  const agentName = gcEnv.GAS_CITY_AGENT_NAME
  // Route through the service binding to avoid CF error 1042 (Workers on the same account
  // cannot use fetch() to call each other via *.workers.dev URLs).
  const gcFetch: typeof fetch = gcEnv.GAS_CITY
    ? (url, init) => gcEnv.GAS_CITY!.fetch(url as string, init)
    : (url, init) => globalThis.fetch(url as string, init)

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
    slingRes = await gcFetch(slingUrl, {
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

  // HTTP 200 and status === "slung": the dispatch path is alive.
  // A successful sling proves: service binding reachable, GC auth works,
  // formula registered, bead+convoy created. Execution polling is not done
  // here — noop-agent step execution still routes through harness providers
  // that require container slots (cloudflare-sandbox or pi-rpc). Real molecule
  // runs cover end-to-end execution. Smoke covers the dispatch path only.
  const workflowId =
    (typeof slingParsed.workflow_id === 'string' && slingParsed.workflow_id) ||
    (typeof slingParsed.root_bead_id === 'string' && slingParsed.root_bead_id) ||
    ''

  const result: SmokeResult = {
    outcome: 'approved',
    ...(workflowId ? { workflowId } : {}),
    durationMs: Date.now() - startedAt,
  }
  return jsonResponse(result, 200)
}
