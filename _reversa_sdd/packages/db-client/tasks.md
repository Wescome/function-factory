# Tasks — packages/db-client

> Unit: @factory/db-client
> Phase 4 · Writer · Generated 2026-06-10 (NEW module — D1 migration)

---

## Implementation Tasks

### T-01: Implement ArangoClient Class with D1 Backend
**Source:** `packages/db-client/src/index.ts`
**Behavior:** Single class with `D1Database` constructor argument. All methods async (except `traverse`). Store `db: D1Database` and optional `validator` function as instance fields.
**Criterion for done:** `createD1Client(db)` and `createClientFromEnv({ DB: db })` both return an `ArangoClient` instance with all methods present.
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement get()
**Source:** `packages/db-client/src/index.ts:get()`
**Behavior:** `SELECT json FROM documents WHERE collection=? AND key=? LIMIT 1` — parse JSON or return null.
**Criterion for done:** `db.get('signals', 'SIG-001')` returns deserialized doc; missing key returns null.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement save() with Key Generation and Upsert
**Source:** `packages/db-client/src/index.ts:save()`
**Behavior:**
- If `doc._key` present: use it; else generate 16-char uppercase hex via `crypto.randomUUID().replace(/-/g,'').slice(0,16).toUpperCase()`
- Run validator if set; throw on violation-severity errors
- `INSERT INTO documents ... ON CONFLICT DO UPDATE SET json=excluded.json`
- Return doc with `_key` attached
**Criterion for done:** Save with no _key generates 16-char hex; save with _key='SIG-001' preserves key; duplicate key overwrites.
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement update() with Shallow Merge
**Source:** `packages/db-client/src/index.ts:update()`
**Behavior:** `existing = await get(collection, key)`. `merged = existing ? { ...existing, ...patch } : { ...patch }`. Call `save(collection, merged)`.
**Criterion for done:** Existing doc gets patch fields merged; missing doc creates from patch alone.
**Confidence:** 🟢 CONFIRMADO

### T-05: Implement remove()
**Source:** `packages/db-client/src/index.ts:remove()`
**Behavior:** `DELETE FROM documents WHERE collection=? AND key=?`. Void return.
**Criterion for done:** After remove, get() returns null for the deleted key.
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement query() and queryOne()
**Source:** `packages/db-client/src/index.ts:query()`, `queryOne()`
**Behavior:**
- `query`: prepare SQL, bind params (skip bind if params empty/absent), call `.all()`, return `result.results ?? []`
- `queryOne`: delegates to query(), returns `results[0] ?? null`
**Criterion for done:** SQL `SELECT * FROM documents WHERE collection=?` with params `['signals']` returns all signals; non-existent query returns []; queryOne returns null on empty.
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement saveEdge()
**Source:** `packages/db-client/src/index.ts:saveEdge()`
**Behavior:**
- `INSERT INTO edges (collection, from_id, to_id, data) VALUES (?,?,?,?)`
- `data`: `Object.keys(data).length > 0` → `JSON.stringify(data)`; else → `null`
**Criterion for done:** Edge with data `{ type: 'derived-from' }` stores JSON; edge with `{}` stores null in data column.
**Confidence:** 🟢 CONFIRMADO

### T-08: Implement traverse() Hard Throw
**Source:** `packages/db-client/src/index.ts:traverse()`
**Behavior:** Synchronous throw: `throw new Error('traverse() not supported in D1 backend — use recursive CTE via query()')`
**Criterion for done:** Any call to `db.traverse(...)` throws immediately without hitting D1.
**Confidence:** 🟢 CONFIRMADO

### T-09: Implement ping()
**Source:** `packages/db-client/src/index.ts:ping()`
**Behavior:** Execute `SELECT 1`, return true on success, false on any error (catch-all).
**Criterion for done:** Healthy D1 → true; D1 error → false (no throw).
**Confidence:** 🟢 CONFIRMADO

### T-10: Implement setValidator()
**Source:** `packages/db-client/src/index.ts:setValidator()`
**Behavior:**
- Store validator function on instance
- In save(): if validator set, call it; two-pass over violations:
  - `severity === 'violation'` → collect error messages → throw `Error: Artifact validation failed for ${collection}: ${messages}`
  - `severity === 'warning'` → `console.warn('[artifact-validator] ...')`
**Criterion for done:** Violation blocks save with correct error message; warning logs but save proceeds.
**Confidence:** 🟢 CONFIRMADO

### T-11: Implement Factory Functions
**Source:** `packages/db-client/src/index.ts`
**Behavior:**
- `createD1Client(db: D1Database): ArangoClient` — `new ArangoClient(db)`
- `createClientFromEnv(env: { DB: D1Database }): ArangoClient` — `new ArangoClient(env.DB)`
**Criterion for done:** Both factory functions return ArangoClient instances with identical capabilities.
**Confidence:** 🟢 CONFIRMADO

### T-12: Export Legacy Types for Backward Compatibility
**Source:** `packages/db-client/src/index.ts` exports
**Behavior:** Export `ArangoConfig`, `ArangoQueryResult<T>`, `ArangoValidationResult`, `ArangoCollectionType`, `ArangoIndexOptions` as types. These are deprecated runtime-use types but must remain exported for consumers that import them.
**Criterion for done:** `import { ArangoConfig } from '@factory/db-client'` compiles without error in existing consumers.
**Confidence:** 🟢 CONFIRMADO
