/**
 * @module session-router
 *
 * Routes an accepted SubmitSession request to the Commissioning Agent DO.
 *
 * The Commissioning Agent DO (one per work order) owns the SM1 state machine.
 * It is addressed by `idFromName("commissioning-agent:" + workOrderId)`.
 *
 * Protocol:
 *   POST https://do/signal
 *   Body: { type: "commission", sessionId, workOrderId, envelope }
 *
 *   200/202 → accepted
 *   409     → already commissioned (idempotent duplicate)
 *   412     → precondition failed (e.g. work order not found)
 *   other   → rejected
 */

export interface RouteResult {
  accepted: boolean
  reason?: string
}

/**
 * Routes a new session to the Commissioning Agent DO for the given work order.
 *
 * @param caNamespace  DO namespace for the Commissioning Agent.
 * @param sessionId    Newly-minted session id.
 * @param workOrderId  Work order id extracted from the WGSP envelope.
 * @param envelope     Raw parsed WGSP envelope (forwarded as-is to the CA).
 */
export async function routeToCommissioningAgent(
  caNamespace: DurableObjectNamespace,
  sessionId: string,
  workOrderId: string,
  envelope: unknown,
): Promise<RouteResult> {
  const stub = caNamespace.get(caNamespace.idFromName(`commissioning-agent:${workOrderId}`))

  let response: Response
  try {
    response = await stub.fetch('https://do/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'commission', sessionId, workOrderId, envelope }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { accepted: false, reason: `commissioning agent unreachable: ${message}` }
  }

  if (response.status === 200 || response.status === 202) {
    return { accepted: true }
  }

  // 409 = already commissioned — still accepted (idempotent)
  if (response.status === 409) {
    return { accepted: true }
  }

  // 412 = precondition failed (work order not found / wrong state)
  if (response.status === 412) {
    let reason = 'precondition failed'
    try {
      const body = (await response.json()) as { reason?: string }
      reason = body.reason ?? reason
    } catch {
      // ignore parse failure
    }
    return { accepted: false, reason }
  }

  let reason = `commissioning agent returned HTTP ${response.status}`
  try {
    const body = (await response.json()) as { reason?: string }
    reason = body.reason ?? reason
  } catch {
    // ignore parse failure
  }
  return { accepted: false, reason }
}
