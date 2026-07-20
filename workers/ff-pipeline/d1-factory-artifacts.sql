-- factory-artifacts D1 schema
--
-- Provision:  wrangler d1 create factory-artifacts
-- Apply:      wrangler d1 execute factory-artifacts --file=workers/ff-pipeline/d1-factory-artifacts.sql
--
-- Specs: SPEC-LINEAR-SYNC-SERVICE-001 v2.0 (§0.3, §2.2, §8)
-- Used by: linear-sync worker (FACTORY_ARTIFACTS_DB binding)
--
-- Safe to re-apply idempotently (IF NOT EXISTS throughout).

-- linear_bindings
-- Idempotency table: maps every Factory artifact ID → Linear issue.
-- factory_artifact_id covers: directiveId, divergenceId, escalationId,
--   health-document IDs, and advisory-hypothesis IDs.
CREATE TABLE IF NOT EXISTS linear_bindings (
  factory_artifact_id       TEXT    NOT NULL PRIMARY KEY,
  linear_issue_id           TEXT    NOT NULL,          -- human-readable identifier, e.g. WEO-42
  linear_issue_internal_id  TEXT    NOT NULL,          -- Linear UUID (used for API calls)
  binding_type              TEXT    NOT NULL CHECK (
                              binding_type IN (
                                'atom',
                                'divergence',
                                'escalation',
                                'health-document',
                                'advisory-hypothesis'
                              )
                            ),
  work_graph_version        TEXT    NOT NULL,
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  last_synced_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  sync_status               TEXT    NOT NULL DEFAULT 'ok' CHECK (
                              sync_status IN ('ok', 'error')
                            )
);

-- Lookup by artifact class (atom, divergence, escalation, …)
CREATE INDEX IF NOT EXISTS idx_linear_bindings_type
  ON linear_bindings (binding_type);

-- Lookup all bindings for a given WorkGraph snapshot
CREATE INDEX IF NOT EXISTS idx_linear_bindings_version
  ON linear_bindings (work_graph_version);

-- Reverse lookup: Linear UUID → factory artifact
CREATE INDEX IF NOT EXISTS idx_linear_bindings_issue
  ON linear_bindings (linear_issue_internal_id);

-- workgraph_milestone_bindings
-- Maps a WorkGraph version string → Linear milestone.
-- Supersedes KV-based milestone bindings introduced in linear-sync v1.0.
CREATE TABLE IF NOT EXISTS workgraph_milestone_bindings (
  work_graph_version    TEXT    NOT NULL PRIMARY KEY,
  work_graph_id         TEXT    NOT NULL,
  linear_milestone_id   TEXT    NOT NULL,              -- Linear milestone UUID
  linear_milestone_name TEXT    NOT NULL,
  repo_id               TEXT    NOT NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Lookup all milestones for a given repo
CREATE INDEX IF NOT EXISTS idx_wgmb_repo
  ON workgraph_milestone_bindings (repo_id);

-- Lookup by WorkGraph document identity (distinct from version string)
CREATE INDEX IF NOT EXISTS idx_wgmb_work_graph_id
  ON workgraph_milestone_bindings (work_graph_id);

-- artifacts: artifact metadata store
-- Used by: factory-graphql worker (DB binding)
CREATE TABLE IF NOT EXISTS artifacts (
  id            TEXT    NOT NULL PRIMARY KEY,
  session_id    TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  content_ref   TEXT,
  content_hash  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  metadata      TEXT    -- JSON string
);
CREATE INDEX IF NOT EXISTS idx_artifacts_session
  ON artifacts (session_id, kind);

-- artifact_edges: lineage graph edges
-- Used by: factory-graphql worker (DB binding), recursive CTE in getLineageEdges
CREATE TABLE IF NOT EXISTS artifact_edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT    NOT NULL,
  target_id   TEXT    NOT NULL,
  rel         TEXT    NOT NULL DEFAULT '',
  props       TEXT                              -- JSON string
);
CREATE INDEX IF NOT EXISTS idx_artifact_edges_source
  ON artifact_edges (source_id);
CREATE INDEX IF NOT EXISTS idx_artifact_edges_target
  ON artifact_edges (target_id);
