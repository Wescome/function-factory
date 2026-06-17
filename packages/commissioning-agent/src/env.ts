/**
 * @factory/commissioning-agent — Env
 *
 * Cloudflare Workers Env interface for CommissioningAgentDO.
 * Bindings match workers/ff-commissioning-agent/wrangler.jsonc.
 */

import type { CommissioningAgentDO } from './index.js'

export interface Env {
  // ── Durable Object namespaces ─────────────────────────────────────────────
  COMMISSIONING_AGENT: DurableObjectNamespace<CommissioningAgentDO>
  MEDIATION_AGENT: DurableObjectNamespace // POST /commission target
  COORDINATOR_DO: DurableObjectNamespace // read-only for bead state
  ARTIFACT_GRAPH: DurableObjectNamespace // ArtifactGraphDO — hypothesis/amendment nodes
  // ── Storage ───────────────────────────────────────────────────────────────
  DB: D1Database // cross-run audit (D1_AUDIT pattern)

  // ── KV ────────────────────────────────────────────────────────────────────
  FACTORY_LINEAR_KV: KVNamespace // cycle context cache (1h TTL)
  KV_KS: KVNamespace // knowing-state hot cache

  // ── Service binding vars (HTTP URLs) ─────────────────────────────────────
  LINEAR_SYNC_URL: string // advisory surfacing endpoint

  // ── Secrets / vars ────────────────────────────────────────────────────────
  LINEAR_TEAM_ID: string
  /** Secrets Store binding — call .get() to retrieve the value. */
  LINEAR_API_KEY: SecretsStoreSecret
  /** Secrets Store binding — call .get() to retrieve the value. */
  FF_AGENT_SIGNING_KEY: SecretsStoreSecret
  /** Secrets Store binding — call .get() to retrieve the value. */
  OFOX_API_KEY: SecretsStoreSecret
  ENVIRONMENT: string

  // ── Subscription buffer (optional) ───────────────────────────────────────
  SUB_BUFFER?:                 DurableObjectNamespace
  /** Secrets Store binding — call .get() to retrieve the value. */
  SUB_BUFFER_PRODUCER_SECRET?: SecretsStoreSecret
}
