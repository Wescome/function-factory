/**
 * @factory/subscription-buffer
 *
 * SubscriptionEventBuffer DO — per-session hibernatable WebSocket fan-out,
 * monotonic sequencing, TTL-bounded replay buffer.
 *
 * Spec: Factory GraphQL Subscription Replay Contract v1
 */

export { SubscriptionEventBufferDO } from './buffer-do.js'
export { emitSubscriptionEvent }      from './emit.js'
export type { EventWrite, BufferedEvent, Env } from './types.js'
