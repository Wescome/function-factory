/**
 * @module pdp-client
 *
 * WeOps Kernel Policy Decision Point (PDP) client.
 *
 * The PDP is the authoritative policy enforcement point for WeOps governance.
 * Before a session is accepted, the gateway checks whether the submitting
 * actor is permitted to submit the given purpose.
 *
 * Protocol:
 *   POST https://pdp/evaluate  (via CF service binding Fetcher)
 *   Authorization: Bearer {apiKey}
 *   Body: { session_id, actor_type, purpose_id }
 *
 *   Response 200: { permitted: true }
 *                 { permitted: false, reason: string }
 *   Any non-2xx or network error: treated as DENY.
 *
 * Timeout: 3 seconds.  Timeout = DENY (fail-closed).
 */

export interface PdpResult {
  permitted: boolean
  reason?: string
}

/**
 * Calls the PDP to evaluate whether the given actor/purpose is allowed
 * to submit a session.
 *
 * Always resolves (never throws).  Errors and timeouts are mapped to DENY.
 */
export async function checkPermit(
  pdp: Fetcher,
  apiKey: string,
  sessionId: string,
  actorType: string,
  purposeId: string,
): Promise<PdpResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3_000)

  try {
    const response = await pdp.fetch(`https://pdp/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ session_id: sessionId, actor_type: actorType, purpose_id: purposeId }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        permitted: false,
        reason: `PDP returned HTTP ${response.status}`,
      }
    }

    const data = (await response.json()) as { permitted?: boolean; reason?: string }

    if (data.permitted !== true) {
      return {
        permitted: false,
        reason: data.reason ?? 'DENY (no reason provided)',
      }
    }

    return { permitted: true }
  } catch (err: unknown) {
    clearTimeout(timeoutId)

    if (err instanceof Error && err.name === 'AbortError') {
      return { permitted: false, reason: 'PDP request timed out (3s)' }
    }

    const message = err instanceof Error ? err.message : String(err)
    return { permitted: false, reason: `PDP network error: ${message}` }
  }
}
