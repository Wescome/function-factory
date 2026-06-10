import type { Migration } from '../src/migrate.js';

export const v00_base: Migration = {
  version: 0,
  name: 'v00_bead_graph_base',
  sql: `
    CREATE TABLE IF NOT EXISTS beads (
      id          TEXT    PRIMARY KEY,
      org_id      TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      written_by  TEXT    NOT NULL,
      ts          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bead_edges (
      child_id    TEXT    NOT NULL REFERENCES beads(id),
      parent_id   TEXT    NOT NULL REFERENCES beads(id),
      rel         TEXT    NOT NULL,
      PRIMARY KEY (child_id, parent_id, rel)
    );

    CREATE INDEX IF NOT EXISTS idx_beads_org_type ON beads(org_id, type);
    CREATE INDEX IF NOT EXISTS idx_beads_org_ts   ON beads(org_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_edges_child    ON bead_edges(child_id);
    CREATE INDEX IF NOT EXISTS idx_edges_parent   ON bead_edges(parent_id);

    CREATE TABLE IF NOT EXISTS schema_history (
      version INTEGER PRIMARY KEY,
      name    TEXT    NOT NULL,
      applied INTEGER NOT NULL
    )
  `,
};
