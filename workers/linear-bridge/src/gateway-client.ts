/**
 * @module gateway-client
 *
 * POSTs an InboundSignal to the WeOps Gateway at POST /signals.
 * Uses 3× exponential backoff on transient failures.
 *
 * The JWT is passed as a Bearer token in the Authorization header.
 * The gateway validates the JWT (7 steps) before routing the signal.
 */

import type { InboundSignal } from '@factory/schemas/weops-signals'

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 500

// ─── Result ───────────────────────────────────────────────────────────────────

export interface GatewayDeliverySuccess {
  ok: true
  status: number
  body: string
}

export interface GatewayDeliveryFailure {
  ok: false
  status?: number
  error: string
}

export type GatewayDeliveryResult = GatewayDeliverySuccess | GatewayDeliveryFailure

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Delivers an InboundSignal to the WeOps Gateway with 3× exponential backoff.
 *
 * @param signal      Validated InboundSignal to deliver
 * @param jwtToken    Signed WeOpsDispositionToken JWT (Bearer)
 * @param gatewayUrl  Base URL of the gateway (WEOPS_GATEWAY_URL env var)
 */
export async function deliverSignalToGateway(
  signal: InboundSignal,
  jwtToken: string,
  gatewayUrl: string,
): Promise<GatewayDeliveryResult> {
  const url = `${gatewayUrl.replace(/\/$/, '')}/signals`
  const body = JSON.stringify(signal)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
        body,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`gateway-client: fetch attempt ${attempt}/${MAX_ATTEMPTS} failed:`, msg)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1))
        continue
      }
      return { ok: false, error: `gateway unreachable after ${MAX_ATTEMPTS} attempts: ${msg}` }
    }

    // 2xx: success
    if (resp.ok) {
      const respBody = await resp.text()
      return { ok: true, status: resp.status, body: respBody }
    }

    // 4xx: client error — do not retry (bad request, auth failure, etc.)
    if (resp.status >= 400 && resp.status < 500) {
      const respBody = await resp.text()
      return {
        ok: false,
        status: resp.status,
        error: `gateway rejected signal (${resp.status}): ${respBody}`,
      }
    }

    // 5xx: server error — retry with backoff
    const respBody = await resp.text()
    console.error(`gateway-client: attempt ${attempt}/${MAX_ATTEMPTS} → ${resp.status}: ${respBody}`)
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1))
    } else {
      return {
        ok: false,
        status: resp.status,
        error: `gateway returned ${resp.status} after ${MAX_ATTEMPTS} attempts: ${respBody}`,
      }
    }
  }

  return { ok: false, error: 'gateway-client: exhausted retry loop unexpectedly' }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
