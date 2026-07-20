/**
 * @factory/subscription-buffer — emit
 *
 * Fire-and-forget helper for producers to emit events to the buffer DO.
 * Spec: Factory GraphQL Subscription Replay Contract v1 §5.2 (Option A)
 */

import { computeProducerToken } from './hmac.js'
import type { EventWrite } from './types.js'

/**
 * Emit a subscription event to the SubscriptionEventBuffer DO for the given session.
 *
 * This is best-effort, fire-and-forget. Failures are logged but never thrown.
 * The event is already on its way to the durable store via the producer's own
 * transaction; this POST is a projection for live subscriber convenience only.
 *
 * @param ns      - The DurableObjectNamespace for SubscriptionEventBufferDO (SUB_BUFFER binding)
 * @param secret  - The shared HMAC secret (SUB_BUFFER_PRODUCER_SECRET)
 * @param ev      - The event to emit (without producerToken — computed here)
 */
export async function emitSubscriptionEvent(
  ns:     DurableObjectNamespace,
  secret: string,
  ev:     Omit<EventWrite, 'producerToken'>
): Promise<void> {
  try {
    const producerToken = await computeProducerToken(secret, ev.sessionId)
    const stub = ns.get(ns.idFromName(`sub-buffer:${ev.sessionId}`))
    await stub.fetch('https://do/event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...ev, producerToken }),
    })
  } catch (err) {
    // Non-fatal: the live tier is subordinate. The durable stores still receive
    // the event via the producer's own flush path; the subscriber falls back on
    // reconnect via the durable replay (D1 / ArtifactGraph DO / gRPC ResumeStream).
    console.warn(`[emitSubscriptionEvent] ${ev.kind} for ${ev.sessionId} failed`, err)
  }
}
