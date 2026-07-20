/**
 * @factory/gears — D1 audit log helpers
 *
 * Standalone functions for writing to and querying the factory-bead-audit D1
 * database. CoordinatorDO.writeAudit() calls these; other consumers may also
 * query the audit log for observability.
 *
 * SPEC-FF-GEARS-001 §7b
 */

export interface BeadAuditRow {
  run_id:   string
  bead_id:  string
  gear_id:  string
  agent_id: string
  verdict:  'done' | 'failed'
  attempt:  number
  ts:       number
}

export async function insertBeadAudit(
  db:  D1Database,
  row: BeadAuditRow
): Promise<void> {
  await db.prepare(
    `INSERT INTO bead_audit (run_id, bead_id, gear_id, agent_id, verdict, attempt, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.run_id,
    row.bead_id,
    row.gear_id,
    row.agent_id,
    row.verdict,
    row.attempt,
    row.ts
  ).run()
}

export async function getBeadAuditForRun(
  db:    D1Database,
  runId: string
): Promise<BeadAuditRow[]> {
  const result = await db.prepare(
    `SELECT * FROM bead_audit WHERE run_id = ? ORDER BY ts ASC`
  ).bind(runId).all<BeadAuditRow>()
  return result.results
}
