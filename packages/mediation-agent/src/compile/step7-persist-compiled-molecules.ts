/**
 * Step 7 — Persist Compiled Molecules to DO SQLite
 *
 * INSERT OR IGNORE — idempotent. Keyed on atom_id; run_id used for
 * the idempotency check in POST /commission.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 7
 */

import type { AtomDirective } from '@factory/schemas'

export function persistCompiledMolecules(
  sql: SqlStorage,
  directives: Map<string, AtomDirective>,
  runId: string,
  workGraphId: string,
): void {
  const compiledAt = Date.now()

  for (const [atomId, directive] of directives) {
    sql.exec(
      `INSERT OR IGNORE INTO compiled_molecules
         (atom_id, run_id, work_graph_id, atom_directive, compiled_at)
       VALUES (?, ?, ?, ?, ?)`,
      atomId,
      runId,
      workGraphId,
      JSON.stringify(directive),
      compiledAt,
    )
  }
}
