/**
 * @factory/architect-agent — SQLite DDL + migration helper
 *
 * Replaces ArangoDB hot state. All 4-domain tables + factory_state + repos
 * live in the ArchitectAgentDO's own SQLite storage (ctx.storage.sql).
 */

export const ARCHITECT_DDL = `
-- D1: Active patch records
CREATE TABLE IF NOT EXISTS patches (
  patch_id           TEXT PRIMARY KEY,
  trigger            TEXT NOT NULL,
  change_description TEXT NOT NULL,
  authorized_by      TEXT NOT NULL,
  urgency            TEXT NOT NULL DEFAULT 'normal',
  status             TEXT NOT NULL DEFAULT 'propagating',
  affected_repo_ids  TEXT NOT NULL DEFAULT '[]',
  applied_repo_ids   TEXT NOT NULL DEFAULT '[]',
  pending_repo_ids   TEXT NOT NULL DEFAULT '[]',
  issued_at          TEXT NOT NULL,
  completed_at       TEXT
);

-- D2: CRD (Coverage Reconciliation Directive) queue — was CRP
CREATE TABLE IF NOT EXISTS crd_queue (
  crd_id                TEXT PRIMARY KEY,
  repo_id               TEXT NOT NULL,
  amendment_id          TEXT NOT NULL,
  coherence_verdict     TEXT NOT NULL,
  hypothesis_id         TEXT NOT NULL,
  divergence_ids        TEXT NOT NULL DEFAULT '[]',
  failure_class         TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  resolution_attempts   INTEGER NOT NULL DEFAULT 0,
  resolution_action     TEXT,
  corrected_artifact_id TEXT,
  received_at           TEXT NOT NULL,
  resolved_at           TEXT
);

-- D3: Vertical slice policy history
CREATE TABLE IF NOT EXISTS vslice_configs (
  config_id                TEXT PRIMARY KEY,
  atom_retry_isolation     INTEGER NOT NULL DEFAULT 1,
  max_atom_retries         INTEGER NOT NULL DEFAULT 3,
  parallel_slice_threshold INTEGER NOT NULL DEFAULT 5,
  dag_dispatch_enabled     INTEGER NOT NULL DEFAULT 1,
  trigger_reason           TEXT NOT NULL,
  effective_from           TEXT NOT NULL,
  superseded_at            TEXT
);

-- D4: Pipeline config history
CREATE TABLE IF NOT EXISTS pipeline_configs (
  config_id                        TEXT PRIMARY KEY,
  pass_routing                     TEXT NOT NULL DEFAULT '[]',
  coherence_min_coverage           REAL NOT NULL DEFAULT 1.0,
  fidelity_max_open_blocking_divs  INTEGER NOT NULL DEFAULT 0,
  assurance_max_detector_staleness INTEGER NOT NULL DEFAULT 24,
  effective_from                   TEXT NOT NULL,
  reason                           TEXT NOT NULL,
  anomaly_evidence_ids             TEXT NOT NULL DEFAULT '[]',
  superseded_at                    TEXT
);

-- Factory-wide repo registry
CREATE TABLE IF NOT EXISTS repos (
  repo_id                     TEXT PRIMARY KEY,
  commissioning_agent_url     TEXT NOT NULL,
  mediation_agent_do_key      TEXT NOT NULL,
  health_status               TEXT NOT NULL DEFAULT 'unknown',
  active_blocking_divergences INTEGER NOT NULL DEFAULT 0,
  pending_crd_count           INTEGER NOT NULL DEFAULT 0,
  last_health_poll_at         TEXT,
  registered_at               TEXT NOT NULL
);

-- Factory lifecycle state (singleton row: factory_id = 'factory')
CREATE TABLE IF NOT EXISTS factory_state (
  factory_id          TEXT PRIMARY KEY DEFAULT 'factory',
  lifecycle_state     TEXT NOT NULL DEFAULT 'ACTIVE',
  last_anomaly_at     TEXT,
  last_patch_at       TEXT,
  active_pipeline_cfg TEXT,
  active_vslice_cfg   TEXT,
  updated_at          TEXT NOT NULL
);

-- Anomaly scan log
CREATE TABLE IF NOT EXISTS anomaly_records (
  anomaly_id    TEXT PRIMARY KEY,
  anomaly_class TEXT NOT NULL,
  domain        TEXT NOT NULL,
  evidence      TEXT NOT NULL DEFAULT '{}',
  triggered_at  TEXT NOT NULL,
  resolved      INTEGER NOT NULL DEFAULT 0
);
`

/**
 * Run all DDL statements against DO SQLite storage.
 * Safe to call on every constructor — all tables use CREATE TABLE IF NOT EXISTS.
 */
export function migrate(sql: SqlStorage): void {
  sql.exec(ARCHITECT_DDL)
}

/**
 * Ensure the factory_state singleton row exists.
 * Called after migrate() on first activation.
 */
export function ensureFactoryState(sql: SqlStorage): void {
  const now = new Date().toISOString()
  sql.exec(
    `INSERT INTO factory_state (factory_id, lifecycle_state, updated_at)
     VALUES ('factory', 'ACTIVE', ?)
     ON CONFLICT(factory_id) DO NOTHING`,
    now,
  )
}
