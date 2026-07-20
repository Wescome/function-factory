/**
 * @factory/linear-sync — binding-store
 *
 * D1 CRUD for the `linear_bindings` idempotency table.
 * Schema: workers/ff-pipeline/d1-factory-artifacts.sql
 */

export type BindingType = 'atom' | 'divergence' | 'escalation' | 'health-document' | 'advisory-hypothesis'
export type SyncStatus = 'ok' | 'error'

export interface LinearBinding {
  factory_artifact_id: string
  linear_issue_id: string         // human-readable, e.g. "WEO-42"
  linear_issue_internal_id: string  // Linear UUID
  binding_type: BindingType
  work_graph_version: string
  created_at: string
  last_synced_at: string
  sync_status: SyncStatus
}

export interface UpsertBindingInput {
  factoryArtifactId: string
  linearIssueId: string
  linearIssueInternalId: string
  bindingType: BindingType
  workGraphVersion: string
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getBinding(
  db: D1Database,
  factoryArtifactId: string,
): Promise<LinearBinding | null> {
  const result = await db
    .prepare('SELECT * FROM linear_bindings WHERE factory_artifact_id = ?')
    .bind(factoryArtifactId)
    .first<LinearBinding>()
  return result ?? null
}

export async function getBindingsByVersion(
  db: D1Database,
  workGraphVersion: string,
): Promise<LinearBinding[]> {
  const result = await db
    .prepare('SELECT * FROM linear_bindings WHERE work_graph_version = ?')
    .bind(workGraphVersion)
    .all<LinearBinding>()
  return result.results
}

export async function getBindingByLinearId(
  db: D1Database,
  linearIssueInternalId: string,
): Promise<LinearBinding | null> {
  const result = await db
    .prepare('SELECT * FROM linear_bindings WHERE linear_issue_internal_id = ?')
    .bind(linearIssueInternalId)
    .first<LinearBinding>()
  return result ?? null
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function upsertBinding(
  db: D1Database,
  input: UpsertBindingInput,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(`
      INSERT INTO linear_bindings
        (factory_artifact_id, linear_issue_id, linear_issue_internal_id, binding_type, work_graph_version, created_at, last_synced_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ok')
      ON CONFLICT (factory_artifact_id) DO UPDATE SET
        linear_issue_id          = excluded.linear_issue_id,
        linear_issue_internal_id = excluded.linear_issue_internal_id,
        binding_type             = excluded.binding_type,
        work_graph_version       = excluded.work_graph_version,
        last_synced_at           = excluded.last_synced_at,
        sync_status              = 'ok'
    `)
    .bind(
      input.factoryArtifactId,
      input.linearIssueId,
      input.linearIssueInternalId,
      input.bindingType,
      input.workGraphVersion,
      now,
      now,
    )
    .run()
}

export async function markBindingSynced(
  db: D1Database,
  factoryArtifactId: string,
  status: SyncStatus = 'ok',
): Promise<void> {
  await db
    .prepare(`
      UPDATE linear_bindings
      SET last_synced_at = ?, sync_status = ?
      WHERE factory_artifact_id = ?
    `)
    .bind(new Date().toISOString(), status, factoryArtifactId)
    .run()
}
