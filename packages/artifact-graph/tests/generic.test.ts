/**
 * generic.test.ts — Generic test suite for @factory/artifact-graph
 *
 * Tests the 10 query functions using an in-memory SQLite database via better-sqlite3.
 * Three required suites:
 *   1. Lineage Walk (3-version chain) — walkLineageBackward + walkLineageForward
 *   2. Bounded Path 3-hop — walkBoundedPath
 *   3. Bi-directional Lineage Collect — collectLineageIds
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import {
  upsertNode,
  upsertEdge,
  walkLineageBackward,
  walkLineageForward,
  walkBoundedPath,
  collectLineageIds,
} from '../src/queries.js';

// ── Minimal SqlStorage adapter wrapping better-sqlite3 Database ────────────

/**
 * Creates a SqlStorage-compatible interface backed by an in-memory better-sqlite3 DB.
 * The CF SqlStorage.exec() returns an iterable cursor; we return an array-like
 * iterable here. Variable binding uses positional ? placeholders.
 */
function createSqlStorage(db: Database.Database): SqlStorage {
  const execFn = (query: string, ...params: unknown[]): Iterable<Record<string, unknown>> => {
    const sql = query.trim();

    // better-sqlite3 does not support multi-statement in prepare(); use exec for those
    if (params.length === 0) {
      try {
        // Try to prepare and run without params (may return rows)
        const stmt = db.prepare(sql);
        return stmt.all() as Record<string, unknown>[];
      } catch {
        // For DDL multi-statement strings, fall back to exec
        db.exec(sql);
        return [];
      }
    }

    const stmt = db.prepare(sql);
    // Use .all() which returns all rows as an array (iterable)
    return stmt.all(...params) as Record<string, unknown>[];
  };

  // SqlStorage is an object with an exec method
  return { exec: execFn } as unknown as SqlStorage;
}

/** Initialize the full artifact-graph schema in a fresh in-memory database */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id      TEXT    PRIMARY KEY,
      type    TEXT    NOT NULL,
      data    TEXT    NOT NULL DEFAULT '{}',
      ns      TEXT    NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      id      TEXT    PRIMARY KEY,
      source  TEXT    NOT NULL,
      target  TEXT    NOT NULL,
      rel     TEXT    NOT NULL,
      props   TEXT    NOT NULL DEFAULT '{}',
      created INTEGER NOT NULL,
      UNIQUE(source, target, rel)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_ns_type    ON nodes(ns, type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_ns_created ON nodes(ns, created)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_source     ON edges(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_target     ON edges(target)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_rel        ON edges(rel)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_src_rel    ON edges(source, rel)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_tgt_rel    ON edges(target, rel)`);

  return db;
}

// ── Suite 1: Lineage Walk (3-version chain) ────────────────────────────────

describe('Suite 1 — Lineage Walk (3-version chain)', () => {
  let sql: SqlStorage;

  beforeEach(() => {
    const db = createTestDb();
    sql = createSqlStorage(db);

    const ns = 'test:org:1';
    upsertNode(sql, 'spec-v1', 'Specification', ns, {});
    upsertNode(sql, 'spec-v2', 'Specification', ns, {});
    upsertNode(sql, 'spec-v3', 'Specification', ns, {});

    // Edges: spec-v3 → spec-v2 → spec-v1 (child → parent via version_of)
    upsertEdge(sql, 'spec-v3', 'spec-v2', 'version_of');
    upsertEdge(sql, 'spec-v2', 'spec-v1', 'version_of');
  });

  it('walkLineageBackward from spec-v3 collects all 3 nodes in order', () => {
    const result = walkLineageBackward(sql, 'spec-v3', 'version_of');

    expect(result.nodes.length).toBe(3);
    expect(result.nodes[0]!.id).toBe('spec-v3');
    expect(result.nodes[2]!.id).toBe('spec-v1');
    expect(result.depth).toBe(2);
  });

  it('walkLineageForward from spec-v1 collects all 3 successors', () => {
    const result = walkLineageForward(sql, 'spec-v1', 'version_of');

    expect(result.nodes.length).toBe(3);
    expect(result.nodes[0]!.id).toBe('spec-v1');
  });
});

// ── Suite 2: Bounded Path 3-hop ────────────────────────────────────────────

describe('Suite 2 — Bounded Path 3-hop', () => {
  let sql: SqlStorage;

  beforeEach(() => {
    const db = createTestDb();
    sql = createSqlStorage(db);

    const ns = 'test:org:2';

    // Setup: spec -[governs]→ exec -[produces]→ trace -[evidences]→ div
    upsertNode(sql, 'spec',  'Specification',  ns, {});
    upsertNode(sql, 'exec',  'Execution',       ns, {});
    upsertNode(sql, 'trace', 'ExecutionTrace',  ns, {});
    upsertNode(sql, 'div',   'Divergence',      ns, {});

    upsertEdge(sql, 'spec',  'exec',  'governs');
    upsertEdge(sql, 'exec',  'trace', 'produces');
    upsertEdge(sql, 'trace', 'div',   'evidences');
  });

  it('walks 3-hop path and returns full PathResult', () => {
    const result = walkBoundedPath(sql, 'spec', [
      { rel: 'governs',   targetType: 'Execution' },
      { rel: 'produces',  targetType: 'ExecutionTrace' },
      { rel: 'evidences', targetType: 'Divergence' },
    ]);

    expect(result.length).toBe(1);
    expect(result[0]!.path.length).toBe(4);
    expect(result[0]!.edges.length).toBe(3);
    expect(result[0]!.path[3]!.id).toBe('div');
  });

  it('returns [] when targetType does not match', () => {
    const result = walkBoundedPath(sql, 'spec', [
      { rel: 'governs', targetType: 'NonExistentType' },
    ]);

    expect(result).toEqual([]);
  });
});

// ── Suite 3: Bi-directional Lineage Collect ───────────────────────────────

describe('Suite 3 — Bi-directional Lineage Collect', () => {
  let sql: SqlStorage;

  beforeEach(() => {
    const db = createTestDb();
    sql = createSqlStorage(db);

    const ns = 'test:org:3';

    // Setup: 4-node chain v1 → v2 → v3 → v4 (via version_of edges, child→parent)
    upsertNode(sql, 'v1', 'Specification', ns, {});
    upsertNode(sql, 'v2', 'Specification', ns, {});
    upsertNode(sql, 'v3', 'Specification', ns, {});
    upsertNode(sql, 'v4', 'Specification', ns, {});

    // v4 → v3 → v2 → v1 (newest → oldest, source→target = child→parent)
    upsertEdge(sql, 'v4', 'v3', 'version_of');
    upsertEdge(sql, 'v3', 'v2', 'version_of');
    upsertEdge(sql, 'v2', 'v1', 'version_of');
  });

  it('collectLineageIds from v2 (middle) returns all 4 IDs', () => {
    const result = collectLineageIds(sql, 'v2', 'version_of');

    expect(result).toHaveLength(4);
    expect(result).toContain('v1');
    expect(result).toContain('v2');
    expect(result).toContain('v3');
    expect(result).toContain('v4');
    // No duplicates
    expect(new Set(result).size).toBe(result.length);
  });

  it('collectLineageIds from v1 (oldest end) returns all 4 IDs', () => {
    const result = collectLineageIds(sql, 'v1', 'version_of');

    expect(result).toHaveLength(4);
    expect(result).toContain('v1');
    expect(result).toContain('v2');
    expect(result).toContain('v3');
    expect(result).toContain('v4');
  });
});
