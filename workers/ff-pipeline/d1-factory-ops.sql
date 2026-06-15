-- factory-ops D1 schema
--
-- Provision:  wrangler d1 create factory-ops
-- Apply:      wrangler d1 execute factory-ops --file=workers/ff-pipeline/d1-factory-ops.sql
--
-- Specs: SPEC-LINEAR-SYNC-SERVICE-001 v2.0 (§9)
--        SPEC-FF-LINEAR-BRIDGE-001 v2.0 (§1.2, §7)
--        SPEC-FF-CYCLE-HEALTH-001 v2.0 (§3.3)
-- Used by: linear-sync worker (FACTORY_OPS_DB binding)
--          linear-bridge worker (FACTORY_OPS_DB binding)
--
-- Safe to re-apply idempotently (IF NOT EXISTS throughout).

-- linear_sync_errors
-- Non-blocking sync failure log written by LinearSyncService on Linear API errors.
-- Does not block the governance loop; consumed by ops dashboards / alerting.
CREATE TABLE IF NOT EXISTS linear_sync_errors (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_artifact_id  TEXT,                            -- artifact that failed (NULL for non-artifact errors)
  error_type           TEXT    NOT NULL,                -- e.g. 'rate_limit', 'api_error', 'binding_conflict'
  error_detail         TEXT    NOT NULL,                -- full error message / API response body
  endpoint             TEXT,                            -- e.g. '/sync/atoms', '/sync/divergences'
  retry_count          INTEGER NOT NULL DEFAULT 0,
  resolved             INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at          TEXT                             -- NULL until manually resolved
);

-- Lookup errors for a specific artifact
CREATE INDEX IF NOT EXISTS idx_lse_artifact
  ON linear_sync_errors (factory_artifact_id);

-- Time-ordered query for unresolved errors (ops triage)
CREATE INDEX IF NOT EXISTS idx_lse_resolved
  ON linear_sync_errors (resolved, created_at);

-- bridge_error_log
-- Processing errors emitted by the ff-linear-bridge worker.
-- Covers all error types from SPEC-FF-LINEAR-BRIDGE-001 §7:
--   parse_failure | missing_fields | authority_denied |
--   elucidation_write_failure | gateway_4xx | gateway_5xx
CREATE TABLE IF NOT EXISTS bridge_error_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  escalation_id  TEXT,                                  -- ESC-* (NULL for pre-parse errors)
  comment_id     TEXT,                                  -- Linear comment UUID
  error_type     TEXT    NOT NULL CHECK (
                   error_type IN (
                     'parse_failure',
                     'missing_fields',
                     'authority_denied',
                     'elucidation_write_failure',
                     'gateway_4xx',
                     'gateway_5xx'
                   )
                 ),
  error_detail   TEXT    NOT NULL,
  commenter_id   TEXT,                                  -- Linear user ID (NULL if unknown)
  issue_id       TEXT,                                  -- Linear issue UUID
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Lookup all errors for a given escalation
CREATE INDEX IF NOT EXISTS idx_bel_escalation
  ON bridge_error_log (escalation_id);

-- Error-type frequency analysis (ordered by time)
CREATE INDEX IF NOT EXISTS idx_bel_error_type
  ON bridge_error_log (error_type, created_at);

-- bridge_security_events
-- Audit trail for invalid / missing Linear webhook signature rejections.
-- Kept separate from bridge_error_log so the security audit trail is
-- append-only and isolated from operational noise.
CREATE TABLE IF NOT EXISTS bridge_security_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type     TEXT    NOT NULL DEFAULT 'invalid_signature' CHECK (
                   event_type IN ('invalid_signature', 'missing_signature')
                 ),
  remote_address TEXT,                                  -- request origin (best-effort; CF may not expose)
  payload_hash   TEXT,                                  -- SHA-256 of raw payload body (hex) for dedup
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Time-range queries for security review
CREATE INDEX IF NOT EXISTS idx_bse_created
  ON bridge_security_events (created_at);

-- health_snapshots
-- Stores HealthSyncRequest payloads written by LoopClosureService.
-- The linear-sync worker cron (midnight UTC) reads the latest row to
-- append a daily history snapshot to the Factory health document.
CREATE TABLE IF NOT EXISTS health_snapshots (
  id                                   INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_lifecycle_state              TEXT    NOT NULL,
  payload_json                         TEXT    NOT NULL,  -- full HealthSyncRequest JSON
  active_repo_count                    INTEGER NOT NULL DEFAULT 0,
  open_divergences_blocking            INTEGER NOT NULL DEFAULT 0,
  open_divergences_advisory            INTEGER NOT NULL DEFAULT 0,
  open_divergences_informational       INTEGER NOT NULL DEFAULT 0,
  open_escalation_count                INTEGER NOT NULL DEFAULT 0,
  pending_crp_count                    INTEGER NOT NULL DEFAULT 0,
  produced_at                          TEXT    NOT NULL,  -- HealthSyncRequest.producedAt (ISO-8601)
  created_at                           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Chronological history query (newest first)
CREATE INDEX IF NOT EXISTS idx_hs_produced_at
  ON health_snapshots (produced_at DESC);

-- Per-lifecycle-state history query
CREATE INDEX IF NOT EXISTS idx_hs_lifecycle_state
  ON health_snapshots (factory_lifecycle_state, produced_at DESC);
