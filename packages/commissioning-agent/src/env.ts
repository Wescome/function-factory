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
  DREAM_DO: DurableObjectNamespace // POST /increment on commission

  // ── Storage ───────────────────────────────────────────────────────────────
  DB: D1Database // cross-run audit (D1_AUDIT pattern)

  // ── KV ────────────────────────────────────────────────────────────────────
  FACTORY_LINEAR_KV: KVNamespace // cycle context cache (1h TTL)
  KV_KS: KVNamespace // knowing-state hot cache

  // ── Service binding vars (HTTP URLs) ─────────────────────────────────────
  LINEAR_SYNC_URL: string // advisory surfacing endpoint

  // ── Secrets / vars ────────────────────────────────────────────────────────
  LINEAR_TEAM_ID: string
  LINEAR_API_KEY: string // secret
  FF_AGENT_SIGNING_KEY: string // WGSP envelope signing
  ENVIRONMENT: string
}
