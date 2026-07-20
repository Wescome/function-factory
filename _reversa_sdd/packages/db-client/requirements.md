# Requirements — packages/db-client

> Unit: @factory/db-client
> Phase 4 · Writer · Generated 2026-06-10 (NEW module — D1 migration, ArangoDB shim)

---

## JTBD

When a Cloudflare Worker needs to persist or query Factory artifacts, I want a thin client with a stable API surface, so that all 59 importing files require no signature changes even though the underlying storage has migrated from ArangoDB to Cloudflare D1 SQLite.

---

## Functional Requirements

### FR-01: Document Get
`get(collection: string, key: string): Promise<T | null>` MUST execute `SELECT json FROM documents WHERE collection=? AND key=? LIMIT 1` and return the deserialized document or `null` if not found.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-02: Document Save (Upsert)
`save(collection: string, doc: Record<string,unknown>): Promise<T>` MUST resolve or generate a `_key`, then upsert via `INSERT ... ON CONFLICT(collection, key) DO UPDATE SET json=excluded.json`. Returns the doc with `_key` attached. Last-writer-wins — no optimistic concurrency.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-03: Document Update (Shallow Merge)
`update(collection: string, key: string, patch: Record<string,unknown>): Promise<T>` MUST read the existing document via `get()`, shallow-merge patch over it (`{ ...existing, ...patch }`), and upsert via the same SQL as `save()`. If no existing doc: `{ ...patch }` (no error thrown).
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-04: Document Remove
`remove(collection: string, key: string): Promise<void>` MUST execute `DELETE FROM documents WHERE collection=? AND key=?`.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-05: SQL Query
`query(sql: string, params?: unknown[]): Promise<T[]>` MUST prepare the SQL, bind params (`?` positional placeholders), call `.all()`, and return `result.results ?? []`. **Breaking change from AQL:** callers must pass SQL with `?` placeholders (not AQL with `bindVars`).
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-06: SQL QueryOne
`queryOne(sql: string, params?: unknown[]): Promise<T | null>` MUST delegate to `query()` and return `results[0] ?? null`.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-07: Edge Save
`saveEdge(collection, from, to, data?): Promise<void>` MUST execute `INSERT INTO edges (collection, from_id, to_id, data) VALUES (?,?,?,?)`. Serializes `data` to JSON only when `Object.keys(data).length > 0` — otherwise stores `null`.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-08: traverse() Hard Throw
`traverse()` MUST throw synchronously with message `"traverse() not supported in D1 backend — use recursive CTE via query()"`. All call sites must be migrated to recursive CTE SQL.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-09: No-Op Schema Helpers
`ensureCollection()` and `ensureIndex()` MUST return `Promise.resolve()` immediately without any DB call. DDL is handled via migrations, not runtime.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-10: Health Check (ping)
`ping(): Promise<boolean>` MUST execute `SELECT 1` and return `true` on success, `false` on any thrown error.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-11: Validation Hook
`setValidator(fn)` MUST install a per-client validation function called before every `save()`. If the function returns violations with `severity === 'violation'`: throw `Error: Artifact validation failed...` (blocks save). If `severity === 'warning'`: `console.warn` with `[artifact-validator]` prefix (does not block).
- Priority: **Should**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

### FR-12: Factory Functions
- `createD1Client(db: D1Database): ArangoClient` — direct D1 binding
- `createClientFromEnv(env: { DB: D1Database }): ArangoClient` — env binding pattern (primary entry point)
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/db-client/src/index.ts`

---

## Non-Functional Requirements

### NFR-01: Zero Runtime Dependencies
The package MUST have zero runtime dependencies. D1 interfaces are inlined as TypeScript shims (`D1Database`, `D1PreparedStatement`) — no `@cloudflare/workers-types` at runtime.
- 🟢 CONFIRMADO — `packages/db-client/package.json` (devDependencies only)

### NFR-02: API Surface Preservation
All public method signatures MUST be preserved unchanged from the ArangoDB client. The only breaking change is `query()` / `queryOne()` — which now accept SQL + `params[]` instead of AQL + `bindVars`.
- 🟢 CONFIRMADO — ~59 importing files, ~140 call sites, only query callers need migration

### NFR-03: traverse() Call Sites Not Yet Audited
No audit of remaining `traverse()` call sites exists in this SDD. Any call site that has not been migrated to recursive CTE SQL will throw at runtime.
- 🔴 LACUNA — `packages/db-client` module header notes this gap

### NFR-04: Last-Writer-Wins Upsert
`save()` and `update()` use `ON CONFLICT ... DO UPDATE` with no optimistic concurrency. Concurrent writes to the same key will result in the last write winning.
- 🟢 CONFIRMADO

---

## Acceptance Criteria

**Scenario: Document round-trip**
```
Dado: db = createClientFromEnv({ DB: d1 })
Quando: db.save('signals', { _key: 'SIG-001', type: 'market', title: 'X' })
   then db.get('signals', 'SIG-001')
Then: Returns { _key: 'SIG-001', type: 'market', title: 'X' }
```

**Scenario: Upsert (last-writer-wins)**
```
Dado: 'signals/SIG-001' exists with title: 'X'
Quando: db.save('signals', { _key: 'SIG-001', title: 'Y' })
Then: Document in D1 has title: 'Y'
```

**Scenario: Auto-generated key**
```
Dado: db.save('signals', { type: 'market' }) (no _key supplied)
Quando: save() runs
Then: Document key is 16-char uppercase hex string (e.g., 'A3F2...')
```

**Scenario: traverse() throws**
```
Dado: Any call to db.traverse(...)
Quando: executed
Then: Throws Error: "traverse() not supported in D1 backend — use recursive CTE via query()"
```

**Scenario: Violation blocks save**
```
Dado: setValidator returns { violations: [{ severity: 'violation', message: 'required field missing', constraint: 'C1' }] }
Quando: db.save('signals', doc) called
Then: Error thrown: "Artifact validation failed for signals: required field missing"; no D1 write
```

**Scenario: ping succeeds**
```
Dado: D1 binding is functional
Quando: db.ping()
Then: true
```
