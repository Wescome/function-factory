import type { Migration } from '../src/migrate.js';

/**
 * v01 — Add composite index for Hypothesis node filtering.
 *
 * The existing idx_nodes_ns_type covers (ns, type) but does not include
 * `created DESC` for efficient ORDER BY on filtered queries. This index
 * improves /query/hypothesis response time when filtering by status,
 * severity, or surfacedCycleCount via json_extract().
 */
export const v01HypothesisIndex: Migration = {
  version: 1,
  name: 'v01_hypothesis_index',
  sql: `
    CREATE INDEX IF NOT EXISTS idx_nodes_ns_type_created
      ON nodes(ns, type, created DESC);
  `,
};
