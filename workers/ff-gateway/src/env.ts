/**
 * @module env
 *
 * Cloudflare Worker environment bindings for ff-gateway.
 *
 * Service Binding types are declared structurally rather than imported
 * from other Workers (cross-Worker imports break rootDir).
 */

import type { CoherenceVerificationReport } from './types.js'
import type { D1Database } from '@factory/db-client'

interface GatesBinding {
  evaluateCoherenceVerification(executableSpecification: unknown): Promise<CoherenceVerificationReport>
}

interface QueryBinding {
  getSpec(collection: string, key: string): Promise<unknown>
  listSpecs(collection: string, opts: { limit: number; offset: number }): Promise<{ items: unknown[]; total: number }>
  traceLineage(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  traceImpact(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  getGateStatus(gate: number, id: string): Promise<unknown>
  getTrustScore(id: string): Promise<unknown>
  getSystemHealth(): Promise<unknown>
  listPendingCRPs(): Promise<unknown[]>
  listPendingMRPs(): Promise<unknown[]>
  listMentorRules(): Promise<unknown[]>
}

interface WorkflowInstance {
  id: string
  pause(): Promise<void>
  resume(): Promise<void>
  terminate(): Promise<void>
  restart(): Promise<void>
  status(): Promise<unknown>
  sendEvent(event: { type: string; payload: unknown }): Promise<void>
}

interface PipelineBinding {
  create(opts?: { id?: string; params?: unknown }): Promise<WorkflowInstance>
  get(id: string): Promise<WorkflowInstance>
}

export interface GatewayEnv {
  GATES: GatesBinding
  QUERY: QueryBinding
  PIPELINE: PipelineBinding
  DB: D1Database
  ENVIRONMENT: string
  // WeOps signals layer (Phase 4+)
  // Secrets set via `wrangler secret put`; KV namespace declared in wrangler.jsonc.
  /** KV namespace — jti replay guard, envelope idempotency, outbound retry queues, audit log */
  KV_REPLAY: KVNamespace
  /** CF Secret — base64-encoded HMAC-SHA256 key for inbound JWT verification */
  WEOPS_SIGNING_KEY: string
  /** CF Secret — base64-encoded HMAC-SHA256 key for outbound envelope verification */
  FF_AGENT_SIGNING_KEY: string
  /** Base URL for Commissioning Agent Worker (e.g. https://ff-commissioning-agent.example.workers.dev) */
  COMMISSIONING_AGENT_URL: string
  /** Base URL / stub URL for Architect Agent Durable Object */
  ARCHITECT_AGENT_DO_URL: string
  /** We-layer webhook URL for EscalationEvent delivery */
  WEOPS_ENDPOINT_ESCALATIONS: string
  /** We-layer webhook URL for VCR delivery */
  WEOPS_ENDPOINT_VCRS: string
}
