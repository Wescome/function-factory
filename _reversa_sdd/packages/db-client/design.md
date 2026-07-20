# Design — packages/db-client

> Unit: @factory/db-client
> Phase 4 · Writer · Generated 2026-06-10 (NEW module — D1 migration)

---

## Overview

`@factory/db-client` is a drop-in shim that preserves the `ArangoClient` API surface while delegating all storage to Cloudflare D1 (SQLite). It replaces the deprecated `@factory/arango-client` package. ~59 files across the monorepo import from this package; only `query()` / `queryOne()` callers have a breaking change (AQL → SQL migration).

---

## Architecture

```
ArangoClient
├── Document operations (D1 documents table)
│   ├── get(collection, key) → SELECT json WHERE collection=? AND key=?
│   ├── save(collection, doc) → UPSERT INSERT ... ON CONFLICT DO UPDATE
│   ├── update(collection, key, patch) → get() + merge + save()
│   └── remove(collection, key) → DELETE WHERE collection=? AND key=?
├── Query operations (D1 arbitrary SQL)
│   ├── query(sql, params?) → prepare + bind + .all() → results[]
│   └── queryOne(sql, params?) → query()[0] ?? null
├── Edge operations (D1 edges table)
│   ├── saveEdge(collection, from, to, data?) → INSERT INTO edges
│   └── traverse() → THROWS "use recursive CTE via query()"
├── Schema helpers (no-ops)
│   ├── ensureCollection() → Promise.resolve()
│   └── ensureIndex() → Promise.resolve()
├── Health
│   └── ping() → SELECT 1 → true/false
└── Validation hook
    └── setValidator(fn) → called before every save()

Factory functions:
  createD1Client(db: D1Database) → ArangoClient
  createClientFromEnv(env: { DB: D1Database }) → ArangoClient
```

---

## D1 Schema Contract

The client assumes these tables exist (created via migrations, not by the client):

```sql
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  key        TEXT NOT NULL,
  json       TEXT NOT NULL,
  PRIMARY KEY (collection, key)
);

CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  data       TEXT            -- nullable JSON
);
```

---

## Key Algorithms

### Key Generation (save)
```
if doc._key != null:
    key = String(doc._key)            // preserve caller-supplied key
else:
    key = crypto.randomUUID()
           .replace(/-/g, '')          // strip hyphens (Web Crypto API)
           .slice(0, 16)               // first 16 hex chars
           .toUpperCase()              // uppercase → "A3F2B1..."
```

Uses Web Crypto API (available natively in CF Workers, no import).

### Upsert Pattern (shared by save and update)
```sql
INSERT INTO documents (collection, key, json) VALUES (?, ?, ?)
ON CONFLICT(collection, key) DO UPDATE SET json=excluded.json
```
Last-writer-wins. No row-level locking or optimistic concurrency.

### Shallow Merge (update)
```
existing = await get(collection, key)
merged = existing ? { ...existing, ...patch } : { ...patch }
→ save(collection, merged)
```

If existing doc is not found: creates from patch alone (no error). One extra round-trip vs. a raw upsert.

### Edge Data Serialization (saveEdge)
```
data provided AND Object.keys(data).length > 0 → JSON.stringify(data) → bind
otherwise → bind null
```

Empty `{}` default → `null` stored in D1.

### Validation Severity Filter (save)
```
result.violations.filter(v => v.severity === 'violation') → error messages
result.violations.filter(v => v.severity === 'warning') → console.warn messages
```
Violation → throw (blocks save). Warning → log only (save proceeds).

---

## Data Structures

### D1 Type Shims (exported interfaces)

```typescript
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T>(): Promise<T | null>
  run<T>(): Promise<{ results: T[] }>
  all<T>(): Promise<{ results: T[] }>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
}
```

No runtime deps on `@cloudflare/workers-types` — interfaces are inlined.

### Legacy Type Exports (backward compat)

```typescript
interface ArangoConfig {
  url: string
  database: string
  auth: { type: 'jwt'; token: string } | { type: 'basic'; username, password }
  fetcher?: typeof fetch  // @deprecated
}

interface ArangoQueryResult<T> {
  result: T[]
  hasMore: boolean
  count?: number
}

interface ArangoValidationResult {
  valid: boolean
  violations: Array<{ constraint, severity, message, field? }>
}

type ArangoCollectionType = 'document' | 'edge'

interface ArangoIndexOptions {
  type: 'hash' | 'persistent' | 'skiplist'
  fields: string[]
  unique?: boolean
  sparse?: boolean
  name?: string
}
```

---

## Package Metadata

| Field | Value |
|---|---|
| Name | `@factory/db-client` |
| Version | `0.1.0` |
| Type | `"module"` (ESM) |
| Main/types entry | `src/index.ts` (source-direct) |
| Build output | `dist/` via `tsc` |
| Test runner | `vitest run --passWithNoTests` |
| Runtime deps | None (zero runtime dependencies) |
| DevDeps | `typescript`, `vitest` |
| tsconfig | Extends `../../tsconfig.base.json`, outputs to `dist/` with declarations + source maps |

---

## Breaking Change Notes

| Consumer type | Migration required | Effort |
|---|---|---|
| `db.get()` callers | None — identical signature | Zero |
| `db.save()` callers | None — identical signature | Zero |
| `db.update()` callers | None — identical signature | Zero |
| `db.remove()` callers | None — identical signature | Zero |
| `db.saveEdge()` callers | None — identical signature | Zero |
| `db.query()` callers | **AQL → SQL migration required** | Per-call rewrite |
| `db.queryOne()` callers | **AQL → SQL migration required** | Per-call rewrite |
| `db.traverse()` callers | **Must replace with recursive CTE SQL** | Full rewrite |
| `ensureCollection()` / `ensureIndex()` callers | No-ops now — safe to keep or remove | Zero |
