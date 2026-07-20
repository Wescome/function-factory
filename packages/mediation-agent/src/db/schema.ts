/**
 * MediationAgentDO SQLite schema.
 *
 * Two tables:
 *   meta             — one row per DO instance (keyed by meta key)
 *   compiled_molecules — one row per compiled AtomDirective per run
 *
 * SPEC-FF-ILAYER-EXEC-001 §6
 */

export function migrate(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compiled_molecules (
      atom_id           TEXT PRIMARY KEY,
      run_id            TEXT NOT NULL,
      work_graph_id     TEXT NOT NULL,
      atom_directive    TEXT NOT NULL,
      compiled_at       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_compiled_molecules_run
      ON compiled_molecules(run_id);
  `)
}

// ── meta key constants ────────────────────────────────────────────────────

export const META_KEYS = {
  lifecycle:              'lifecycle',
  runId:                  'runId',
  orgId:                  'orgId',
  workGraphId:            'workGraphId',
  workGraphVersion:       'workGraphVersion',
  atomCount:              'atomCount',
  lastCommissionAt:       'lastCommissionAt',
  eluciationArtifactId:   'eluciationArtifactId',
} as const

export type MetaKey = typeof META_KEYS[keyof typeof META_KEYS]
