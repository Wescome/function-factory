/**
 * @factory/subscription-buffer — types
 *
 * Core type definitions for the SubscriptionEventBuffer DO.
 * Spec: Factory GraphQL Subscription Replay Contract v1 §2.5
 */

/** Producer-supplied event write payload (§2.5). */
export interface EventWrite {
  sessionId:     string
  stream:        'sessionEvents' | 'artifactWrites' | 'beadUpdates'
  kind:          string           // SessionEventKind name OR 'ARTIFACT_WRITTEN' OR 'BEAD_UPDATE'
  runId?:        string           // required for beadUpdates
  assemblyId?:   string           // required for artifactWrites
  payload:       unknown          // GraphQL event body, already in GraphQL shape
  occurredAt:    number           // epoch ms — authoritative timestamp from the producer
  terminal?:     boolean          // true on SESSION_COMPLETED/FAILED/CANCELLED
  producerToken: string           // HMAC(secret, sessionId) — §5.2
}

/** A single event as stored and replayed from DO SQLite. */
export interface BufferedEvent {
  seq:               number
  stream:            'sessionEvents' | 'artifactWrites' | 'beadUpdates'
  kind:              string
  scopeRunId:        string | null
  scopeAssemblyId:   string | null
  payload:           unknown
  occurredAt:        number
  appendedAt:        number
  terminal:          boolean
}

/** Singleton control row from buffer_meta (id = 0). */
export interface BufferMeta {
  sessionId:          string
  runId:              string | null
  assemblyId:         string | null
  nextSeq:            number
  lastWriteAt:        number
  terminalAt:         number | null
  producerTokenHash:  string | null
}

/** Cloudflare Worker environment bindings for the SubscriptionEventBuffer DO. */
export interface Env {
  SUB_BUFFER_KV:              KVNamespace
  SUB_BUFFER_PRODUCER_SECRET: SecretsStoreSecret
}
