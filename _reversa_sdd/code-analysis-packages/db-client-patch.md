## Module 6: packages/db-client (D1-backed Database Client)

**Files:** `packages/db-client/src/index.ts`, `packages/db-client/src/index.test.ts`
**Package:** `@factory/db-client` v0.1.0
**Role:** Thin document/edge persistence client for Cloudflare Workers. Previously backed ArangoDB over HTTP; now backed by Cloudflare D1 (SQLite). All public method signatures are preserved — ~59 importing files and ~140 call sites require no signature changes (only query/queryOne callers must port AQL → SQL).

> **Change type:** New module (ArangoDB HTTP client replaced by D1 SQLite client — drop-in API shim)

---

### 6.1 Control Flow

**`ArangoClient` class** — single class, all methods async (except `traverse`, which throws synchronously).

#### Document operations

| Method | Signature | Behavior |
|--------|-----------|----------|
| `get` | `(collection: string, key: string) → Promise<T \| null>` | `SELECT json FROM documents WHERE collection=? AND key=? LIMIT 1` — deserializes JSON or returns null. 🟢 CONFIRMADO |
| `save` | `(collection: string, doc: Record<string,unknown>) → Promise<T>` | Runs optional validation, resolves/generates `_key`, upserts via `INSERT … ON CONFLICT … DO UPDATE SET json=excluded.json`. Returns doc with key attached. 🟢 CONFIRMADO |
| `update` | `(collection: string, key: string, patch: Record<string,unknown>) → Promise<T>` | Reads existing doc via `get()`, shallow-merges patch over it (missing doc → patch only), upserts via same SQL as `save`. 🟢 CONFIRMADO |
| `remove` | `(collection: string, key: string) → Promise<void>` | `DELETE FROM documents WHERE collection=? AND key=?`. 🟢 CONFIRMADO |

#### Query operations

| Method | Signature | Behavior |
|--------|-----------|----------|
| `query` | `(sql: string, params?: unknown[]) → Promise<T[]>` | Prepares SQL, binds params (skips bind if params empty/absent), calls `.all()`, returns `result.results ?? []`. 🟢 CONFIRMADO |
| `queryOne` | `(sql: string, params?: unknown[]) → Promise<T \| null>` | Delegates to `query()`, returns `results[0] ?? null`. 🟢 CONFIRMADO |

> **Breaking change (query / queryOne):** Consumers that previously passed AQL strings and `bindVars` objects must now pass SQL with `?` positional placeholders and a `params: unknown[]` array. 🟢 CONFIRMADO — documented inline in module header.

#### Edge operations

| Method | Signature | Behavior |
|--------|-----------|----------|
| `saveEdge` | `(collection, from, to, data?) → Promise<void>` | `INSERT INTO edges (collection, from_id, to_id, data) VALUES (?,?,?,?)`. Serializes `data` to JSON if non-empty, otherwise binds `null`. 🟢 CONFIRMADO |
| `traverse` | `(_startVertex, _edgeCollection, _direction, _minDepth, _maxDepth) → Promise<T[]>` | **Throws synchronously** — `traverse() not supported in D1 backend — use recursive CTE via query()`. Callers are responsible for replacing with recursive CTE SQL. 🟢 CONFIRMADO |

#### Schema helpers (no-ops)

| Method | Behavior |
|--------|----------|
| `ensureCollection` | Returns `Promise.resolve()` immediately — no DB call. Tables created via migrations. 🟢 CONFIRMADO |
| `ensureIndex` | Returns `Promise.resolve()` immediately — no DB call. Indexes created via migrations. 🟢 CONFIRMADO |

#### Health check

| Method | Behavior |
|--------|----------|
| `ping` | Executes `SELECT 1`, returns `true` on success, `false` on any thrown error (catch-all). 🟢 CONFIRMADO |

#### Validation hook

`setValidator(fn)` — installs a per-client validation function called before every `save()`.
- If `fn` returns violations with `severity === 'violation'`: throws `Error: Artifact validation failed for ${collection}: ${messages}` — **blocks the save**. 🟢 CONFIRMADO
- If `fn` returns violations with `severity === 'warning'`: logs via `console.warn` with prefix `[artifact-validator]` — **does not block**. 🟢 CONFIRMADO

---

### 6.2 Algorithms

**Key generation in `save()`:**
```
if doc._key != null:
    key = String(doc._key)         // preserve caller-supplied key
else:
    key = crypto.randomUUID()
           .replace(/-/g, '')       // strip hyphens
           .slice(0, 16)            // first 16 hex chars
           .toUpperCase()           // uppercase
```
Result: 16-character uppercase hex string (e.g. `A3F2...`). Uses Web Crypto API — available natively in Cloudflare Workers without import. 🟢 CONFIRMADO

**Shallow merge in `update()`:**
- Reads existing document via `get()` first (one DB round-trip).
- If existing doc found: `merged = { ...existing, ...patch }` — patch fields overwrite, existing non-patch fields preserved.
- If no existing doc: `merged = { ...patch }` — creates from patch alone (no error thrown). 🟡 INFERIDO (no explicit test for missing-doc creation path, but code clearly branches on `existing ? ... : ...`)

**Upsert pattern (shared by `save` and `update`):**
```sql
INSERT INTO documents (collection, key, json) VALUES (?, ?, ?)
ON CONFLICT(collection, key) DO UPDATE SET json=excluded.json
```
Guarantees last-writer-wins — no optimistic concurrency. 🟢 CONFIRMADO

**Edge data serialization in `saveEdge()`:**
- Serializes `data` to JSON only when `Object.keys(data).length > 0`.
- Empty `{}` default → stores `null` in `data` column. 🟢 CONFIRMADO

**Validation severity filter in `save()`:**
- Two-pass over `result.violations` array: first pass `.filter(v => v.severity === 'violation')` for error messages; second pass `.filter(v => v.severity === 'warning')` for warn logging. 🟢 CONFIRMADO

---

### 6.3 Data Structures

#### D1 Type Shims (exported interfaces — no runtime deps on `@cloudflare/workers-types`)

**`D1PreparedStatement`:**
```typescript
{
  bind(...values: unknown[]): D1PreparedStatement   // fluent builder
  first<T>(): Promise<T | null>                     // single row
  run<T>(): Promise<{ results: T[] }>               // mutation result
  all<T>(): Promise<{ results: T[] }>               // multi-row query
}
```
🟢 CONFIRMADO — structurally compatible with Cloudflare's actual `D1PreparedStatement`.

**`D1Database`:**
```typescript
{
  prepare(query: string): D1PreparedStatement
}
```
🟢 CONFIRMADO

#### Legacy Type Exports (kept for backward compatibility)

**`ArangoConfig`** (deprecated — not used by D1 backend):
```typescript
{
  url: string
  database: string
  auth: { type: 'jwt'; token: string }
       | { type: 'basic'; username: string; password: string }
  fetcher?: typeof fetch | undefined   // @deprecated
}
```
🟢 CONFIRMADO — exported with `@deprecated` JSDoc on `fetcher` field.

**`ArangoQueryResult<T>`:**
```typescript
{
  result: T[]
  hasMore: boolean
  count?: number     // optional
}
```
🟢 CONFIRMADO — kept for consumers that import this type.

**`ArangoValidationResult`:**
```typescript
{
  valid: boolean
  violations: Array<{
    constraint: string
    severity: string    // 'violation' | 'warning' (interpreted by save())
    message: string
    field?: string      // optional
  }>
}
```
🟢 CONFIRMADO — used by `setValidator` callback contract.

**`ArangoCollectionType`:** `'document' | 'edge'` — 🟢 CONFIRMADO

**`ArangoIndexOptions`:**
```typescript
{
  type: 'hash' | 'persistent' | 'skiplist'
  fields: string[]
  unique?: boolean
  sparse?: boolean
  name?: string
}
```
🟢 CONFIRMADO

#### D1 Schema Contract (not enforced in code — must exist via migrations)

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
🟢 CONFIRMADO — documented in module header; tables are prerequisite (not created by client).

---

### 6.4 Factory Functions (module-level)

| Export | Signature | Use case |
|--------|-----------|----------|
| `createD1Client` | `(db: D1Database) → ArangoClient` | Worker holds a D1 binding directly. 🟢 CONFIRMADO |
| `createClientFromEnv` | `(env: { DB: D1Database }) → ArangoClient` | Worker env binding pattern — destructures `env.DB`. 🟢 CONFIRMADO |

`createClientFromEnv` is the primary entry point used by `workers/ff-pipeline/src/pipeline.ts` (`createClientFromEnv(this.env)`). 🟢 CONFIRMADO

---

### 6.5 Metadata

**Package coordinates:**
- Name: `@factory/db-client`
- Version: `0.1.0`
- Type: `"module"` (ESM)
- Main/types entry: `src/index.ts` (source-direct — no build step required at import time)
- Build: `tsc` → `dist/`
- Test runner: `vitest run --passWithNoTests`

**Zero runtime dependencies:** `devDependencies` only (`typescript`, `vitest`). No `@cloudflare/workers-types` dep — D1 interfaces are inlined as shims. 🟢 CONFIRMADO

**tsconfig:** Extends `../../tsconfig.base.json`. Outputs to `dist/` with declarations, declaration maps, and source maps. 🟢 CONFIRMADO

**Known call-site impact:**
- ~59 files import from `@factory/db-client` across the monorepo.
- ~140 total call sites per module header comment.
- `query()` / `queryOne()` callers are the only ones with a breaking change: AQL → SQL migration required. All other method signatures are unchanged.
- `traverse()` call sites will throw at runtime — must be replaced with recursive CTE SQL queries. 🔴 LACUNA — no audit of remaining `traverse()` call sites exists in this SDD.

---

### 6.6 Architectural Patterns Observed

| Pattern | Location | Confidence |
|---------|----------|-----------|
| ArangoDB API shim over D1 SQLite (adapter pattern) | `ArangoClient` class | 🟢 CONFIRMADO |
| Upsert via `ON CONFLICT … DO UPDATE` (last-writer-wins) | `save()`, `update()` | 🟢 CONFIRMADO |
| Inline type shims — zero external type deps | `D1Database`, `D1PreparedStatement` | 🟢 CONFIRMADO |
| Optional validator hook (pre-save guard) | `setValidator()` / `save()` | 🟢 CONFIRMADO |
| Fail-hard on hard violations, warn-only on soft violations | `save()` validation block | 🟢 CONFIRMADO |
| `traverse()` stubbed as hard throw with migration note | `traverse()` | 🟢 CONFIRMADO |
| No-op schema helpers (migration-driven DDL, not runtime) | `ensureCollection()`, `ensureIndex()` | 🟢 CONFIRMADO |
| Factory functions for two common Worker binding patterns | `createD1Client`, `createClientFromEnv` | 🟢 CONFIRMADO |
