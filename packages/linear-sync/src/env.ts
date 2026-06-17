/**
 * @factory/linear-sync — Env
 *
 * Cloudflare Workers Env interface for the linear-sync worker.
 * Bindings match SPEC-LINEAR-SYNC-SERVICE-001 v2.0 §10.
 *
 * Note: FACTORY_ARTIFACTS_DB and FACTORY_OPS_DB are separate D1 bindings,
 * one per logical database (d1-factory-artifacts.sql / d1-factory-ops.sql).
 */

export interface Env {
  // ── Secrets / vars ────────────────────────────────────────────────────────
  LINEAR_API_KEY: SecretsStoreSecret  // Linear service-account API key (no "Bearer" prefix needed)
  LINEAR_TEAM_ID: string              // Linear team UUID
  LINEAR_PROJECT_ID: string           // Linear project UUID

  // ── Durable Object namespaces ─────────────────────────────────────────────
  ARTIFACT_GRAPH: DurableObjectNamespace  // ArtifactGraphDO for IssueBindingEvent writes

  // ── D1 databases ─────────────────────────────────────────────────────────
  FACTORY_ARTIFACTS_DB: D1Database  // linear_bindings, workgraph_milestone_bindings
  FACTORY_OPS_DB: D1Database        // health_snapshots, linear_sync_errors

  // ── KV ────────────────────────────────────────────────────────────────────
  FACTORY_LINEAR_KV: KVNamespace   // doc IDs, label/state UUIDs, cycle cache
}
