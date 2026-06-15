/**
 * @factory/architect-agent — Env
 *
 * Cloudflare Workers Env interface for ArchitectAgentDO.
 * Bindings match workers/ff-architect-agent/wrangler.jsonc.
 *
 * No ArangoDB — all hot state lives in DO SQLite (ctx.storage.sql).
 * No D1 binding — ArchitectAgentDO is a singleton; its own SQLite is authoritative.
 */

export interface Env {
  // ── Durable Object namespaces ─────────────────────────────────────────────
  // Note: typed as plain DurableObjectNamespace to avoid circular import.
  // The worker entry in ff-architect-agent parameterizes this with ArchitectAgentDO.
  ARCHITECT_AGENT: DurableObjectNamespace

  /** FactoryArtifactGraphDO — lineage + audit writes (replaces all ArangoDB collection writes).
   *  Key pattern: 'artifact-graph:factory' (singleton factory graph). */
  ARTIFACT_GRAPH: DurableObjectNamespace

  // ── Vars ──────────────────────────────────────────────────────────────────
  /** Escalation target for We-layer operations */
  WEOPS_GATEWAY_URL: string
  /** Harness bridge — GET /pipeline-config notification target */
  HARNESS_BRIDGE_URL: string
  /** Compiler — GET /pipeline-config notification target */
  COMPILER_URL: string
  /** Anomaly scan alarm interval in ms. Default: "900000" (15 min) */
  ANOMALY_SCAN_INTERVAL_MS: string
  /** Patch propagation timeout in ms. Default: "1800000" (30 min) */
  PATCH_PROPAGATION_TIMEOUT_MS: string
  /** CRD resolution timeout in ms. Default: "600000" (10 min). Was CRP_RESOLUTION_TIMEOUT_MS. */
  CRD_RESOLUTION_TIMEOUT_MS: string

  ENVIRONMENT: string

  // ── Secrets (wrangler secret put) ────────────────────────────────────────
  /** Bearer token for WeOps gateway calls */
  OPERATOR_CONTROL_TOKEN: string
  /** Envelope signing key (shared with CommissioningAgentDO) */
  FF_AGENT_SIGNING_KEY: string
}
