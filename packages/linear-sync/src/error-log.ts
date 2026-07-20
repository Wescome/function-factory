/**
 * @factory/linear-sync — error-log
 *
 * Non-blocking write to `linear_sync_errors` in FACTORY_OPS_DB.
 * Failures here are swallowed so they never propagate into the sync path.
 *
 * Schema: workers/ff-pipeline/d1-factory-ops.sql
 */

export interface SyncErrorInput {
  factoryArtifactId?: string
  errorType: string
  errorDetail: string
  endpoint?: string
  retryCount?: number
}

export async function logSyncError(
  db: D1Database,
  input: SyncErrorInput,
): Promise<void> {
  try {
    await db
      .prepare(`
        INSERT INTO linear_sync_errors
          (factory_artifact_id, error_type, error_detail, endpoint, retry_count, resolved, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `)
      .bind(
        input.factoryArtifactId ?? null,
        input.errorType,
        input.errorDetail,
        input.endpoint ?? null,
        input.retryCount ?? 0,
        new Date().toISOString(),
      )
      .run()
  } catch (err) {
    // Never let error logging block the caller
    console.error('[error-log] Failed to write linear_sync_errors:', err)
  }
}
