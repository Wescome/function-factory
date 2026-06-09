/**
 * @module arango-client
 *
 * D1-backed document/edge client for Cloudflare Workers.
 *
 * Previously backed ArangoDB via HTTP. Now backed by Cloudflare D1 (SQLite).
 * All public method signatures are unchanged — ~140 call sites need no edits.
 *
 * Schema expected in D1:
 *   CREATE TABLE IF NOT EXISTS documents (
 *     collection TEXT NOT NULL,
 *     key        TEXT NOT NULL,
 *     json       TEXT NOT NULL,
 *     PRIMARY KEY (collection, key)
 *   );
 *   CREATE TABLE IF NOT EXISTS edges (
 *     id         INTEGER PRIMARY KEY AUTOINCREMENT,
 *     collection TEXT NOT NULL,
 *     from_id    TEXT NOT NULL,
 *     to_id      TEXT NOT NULL,
 *     data       TEXT
 *   );
 *
 * BREAKING CHANGE (query / queryOne):
 *   Consumers must now pass SQL (with ? placeholders) instead of AQL.
 *   bindVars is replaced by a params array (unknown[]).
 */

// ── Minimal D1 type shim ──────────────────────────────────────────────────────
// Defined inline so this package has zero runtime or type-only deps on
// @cloudflare/workers-types. Workers that already have that package in scope
// will see structural compatibility.

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

// ── Legacy exports kept for consumers that import these types ─────────────────

export interface ArangoConfig {
  url: string
  database: string
  auth: {
    type: 'jwt'
    token: string
  } | {
    type: 'basic'
    username: string
    password: string
  }
  /** @deprecated Not used in D1 backend. */
  fetcher?: typeof fetch | undefined
}

export interface ArangoQueryResult<T = unknown> {
  result: T[]
  hasMore: boolean
  count?: number
}

export interface ArangoValidationResult {
  valid: boolean
  violations: { constraint: string; severity: string; message: string; field?: string }[]
}

export type ArangoCollectionType = 'document' | 'edge'

export interface ArangoIndexOptions {
  type: 'hash' | 'persistent' | 'skiplist'
  fields: string[]
  unique?: boolean
  sparse?: boolean
  name?: string
}

// ── Client ────────────────────────────────────────────────────────────────────

export class ArangoClient {
  private db: D1Database
  private validator?: (collection: string, doc: Record<string, unknown>) => ArangoValidationResult

  constructor(db: D1Database) {
    this.db = db
  }

  /**
   * Set a validation function that runs before every save().
   * If validation returns violations with severity 'violation',
   * the save is blocked and an error is thrown.
   * Warnings are logged but do not block.
   */
  setValidator(fn: (collection: string, doc: Record<string, unknown>) => ArangoValidationResult): void {
    this.validator = fn
  }

  // ── Collection operations ─────────────────────────────────────────────────

  /** No-op in D1 backend — tables are created via migrations. */
  async ensureCollection(_name: string, _options: { type?: ArangoCollectionType } = {}): Promise<void> {
    return Promise.resolve()
  }

  /** No-op in D1 backend — indexes are created via migrations. */
  async ensureIndex(_collection: string, _options: ArangoIndexOptions): Promise<void> {
    return Promise.resolve()
  }

  // ── Document operations ───────────────────────────────────────────────────

  async get<T = unknown>(collection: string, key: string): Promise<T | null> {
    const row = await this.db
      .prepare('SELECT json FROM documents WHERE collection=? AND key=? LIMIT 1')
      .bind(collection, key)
      .first<{ json: string }>()
    return row ? (JSON.parse(row.json) as T) : null
  }

  async save<T = unknown>(collection: string, doc: Record<string, unknown>): Promise<T> {
    if (this.validator) {
      const result = this.validator(collection, doc)
      if (!result.valid) {
        const violationMessages = result.violations
          .filter((v) => v.severity === 'violation')
          .map((v) => v.message)
        throw new Error(
          `Artifact validation failed for ${collection}: ${violationMessages.join('; ')}`,
        )
      }
      for (const v of result.violations.filter((v) => v.severity === 'warning')) {
        console.warn(`[artifact-validator] ${v.constraint}: ${v.message}`)
      }
    }

    const key =
      (doc as Record<string, unknown>)._key != null
        ? String((doc as Record<string, unknown>)._key)
        : crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()

    const withKey = { ...doc, _key: key }
    await this.db
      .prepare(
        'INSERT INTO documents (collection, key, json) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET json=excluded.json',
      )
      .bind(collection, key, JSON.stringify(withKey))
      .run()
    return withKey as T
  }

  async update<T = unknown>(
    collection: string,
    key: string,
    patch: Record<string, unknown>,
  ): Promise<T> {
    const existing = await this.get<Record<string, unknown>>(collection, key)
    const merged = existing ? { ...existing, ...patch } : { ...patch }
    await this.db
      .prepare(
        'INSERT INTO documents (collection, key, json) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET json=excluded.json',
      )
      .bind(collection, key, JSON.stringify(merged))
      .run()
    return merged as T
  }

  async remove(collection: string, key: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM documents WHERE collection=? AND key=?')
      .bind(collection, key)
      .run()
  }

  // ── SQL queries ───────────────────────────────────────────────────────────
  //
  // NOTE: These methods previously accepted AQL + bindVars.
  // They now accept SQL + positional params (unknown[]).
  // All consumers must be updated to pass SQL with ? placeholders.

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql)
    const bound = params && params.length > 0 ? stmt.bind(...params) : stmt
    const result = await bound.all<T>()
    return (result.results ?? []) as T[]
  }

  async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const results = await this.query<T>(sql, params)
    return results[0] ?? null
  }

  // ── Edge operations ───────────────────────────────────────────────────────

  async saveEdge(
    collection: string,
    from: string,
    to: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO edges (collection, from_id, to_id, data) VALUES (?, ?, ?, ?)',
      )
      .bind(collection, from, to, Object.keys(data).length > 0 ? JSON.stringify(data) : null)
      .run()
  }

  // ── Graph traversal ───────────────────────────────────────────────────────

  /**
   * Not supported in D1 backend.
   * Use recursive CTEs via `query()` instead, e.g.:
   *   WITH RECURSIVE reachable(id) AS (
   *     SELECT to_id FROM edges WHERE collection=? AND from_id=?
   *     UNION ALL
   *     SELECT e.to_id FROM edges e JOIN reachable r ON e.from_id=r.id
   *   )
   *   SELECT * FROM reachable
   */
  traverse<T = unknown>(
    _startVertex: string,
    _edgeCollection: string,
    _direction: 'OUTBOUND' | 'INBOUND' | 'ANY',
    _minDepth: number,
    _maxDepth: number,
  ): Promise<T[]> {
    throw new Error(
      'traverse() not supported in D1 backend — use recursive CTE via query()',
    )
  }

  // ── Health check ─────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      await this.db.prepare('SELECT 1').run()
      return true
    } catch {
      return false
    }
  }
}

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Create an ArangoClient bound to a D1 database.
 * Use this in Workers that hold a D1 binding directly.
 */
export function createD1Client(db: D1Database): ArangoClient {
  return new ArangoClient(db)
}

/**
 * Create an ArangoClient from Cloudflare Worker env bindings.
 *
 * Expects env to have:
 *   DB — D1Database binding
 */
export function createClientFromEnv(env: { DB: D1Database }): ArangoClient {
  return new ArangoClient(env.DB)
}
