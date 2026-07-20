# Tasks — gascity-supervisor

> Unit: gascity-supervisor (Gas City Container Host)
> Phase 4 · Writer · Generated 2026-06-10

---

## Implementation Tasks

### T-01: Implement Worker Auth Gate (Bearer Check)
**Source:** `workers/gascity-supervisor/src/index.ts:108-148` (pattern used across all routes)
**Behavior:** For all non-public routes, check `Authorization: Bearer ${env.GC_SUPERVISOR_TOKEN}`. Return 401 `{ error: "unauthorized" }` on mismatch. Fence route (`/__supervisor/fence`) is the only route without auth.
**Criterion for done:** Request with wrong bearer returns 401; request with correct bearer proceeds.
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement Telemetry Queue Ingestion Route
**Source:** `workers/gascity-supervisor/src/index.ts:108-148`
**Behavior:**
- Validate body is JSON array; max 50 events
- If TELEMETRY_QUEUE unbound: 503 `{ error: "telemetry_queue_unbound" }`
- If valid: `env.TELEMETRY_QUEUE.send(events)`, return 200 `{ ok: true }`
**Criterion for done:** Valid 10-event batch succeeds; 51-event batch returns 400; unbound queue returns 503.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement Bead Store Proxy Route
**Source:** `workers/gascity-supervisor/src/index.ts:170-200`
**Behavior:**
- Parse city and doPath from `/internal/bead-store/{city}/{...path}`
- If no slash after city segment: 400 `{ error: "invalid_path" }`
- Strip Authorization header; inject X-FF-Internal: factory-store
- Route to `FACTORY_STORE.idFromName(city)` DO
- Forward body for non-GET/HEAD methods
**Criterion for done:** Request to /internal/bead-store/factory/beads reaches FactoryStore DO with correct headers.
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement Keepalive Start/Stop/Fence
**Source:** `workers/gascity-supervisor/src/index.ts:46-74`
**Behavior:**
- `POST /v0/keepalive/start`: read refcount, increment, persist, renewActivityTimeout(), return `{ ok, refcount }`
- `POST /v0/keepalive/stop`: read refcount, decrement (floor 0), persist, renewActivityTimeout() only if next > 0, return `{ ok, refcount }`
- `GET /__supervisor/fence`: return `{ active: refcount > 0, refcount }` without auth check
**Criterion for done:** Start increments count; stop decrements count; fence reflects current count; renewActivityTimeout called only when appropriate.
**Confidence:** 🟢 CONFIRMADO

### T-05: Implement onActivityExpired Override
**Source:** `workers/gascity-supervisor/src/index.ts:30-37`
**Behavior:** Read keepalive_refcount. If > 0: renewActivityTimeout() and return. If 0: call super.onActivityExpired().
**Criterion for done:** Container with refcount=2 does not sleep when timer fires; container with refcount=0 sleeps normally.
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement onStop Cleanup
**Source:** `workers/gascity-supervisor/src/index.ts:39-41`
**Behavior:** Delete keepalive_refcount from DO storage on container stop. Swallow errors.
**Criterion for done:** After container restart, keepalive_refcount is absent from DO storage (refcount starts at 0).
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement Request Proxy to Container
**Source:** `workers/gascity-supervisor/src/index.ts:76-100`
**Behavior:**
- Inject `X-GC-Request: true` header
- Rewrite URL: protocol=http, hostname=localhost, port=9443
- Omit body on GET/HEAD
- Call `this.containerFetch(forwarded, 9443)`
- On error: return 503 `{ error: "container_not_ready", detail }`
**Criterion for done:** POST to supervisor routes to gc daemon at localhost:9443 with correct headers; container error returns 503.
**Confidence:** 🟢 CONFIRMADO

### T-08: Implement FactoryStore Schema Initialization
**Source:** `workers/gascity-supervisor/src/factory-store-do.ts:15-27`
**Behavior:**
- Enable `PRAGMA foreign_keys = ON`
- Attempt `PRAGMA auto_vacuum = INCREMENTAL` (swallow error)
- Run `initSchema()` to create all tables
- Apply legacy migration: UPDATE beads SET status='open' WHERE status=''
- Set alarm for vacuum: `Date.now() + VACUUM_INTERVAL_MS`
**Criterion for done:** All tables created; legacy status migration runs; 7-day vacuum alarm set.
**Confidence:** 🟢 CONFIRMADO

### T-09: Implement FactoryStore Bead CRUD
**Source:** `workers/gascity-supervisor/src/factory-store-do.ts:108-370`
**Behavior:**
- `createBead()`: generate nextID (MAX query), insert with defaults, return created bead
- `getBead(id)`: SELECT by id, 404 if missing
- `patchBead(id, opts)`: apply status/assignee/priority/parent field updates; merge metadata (Object.assign); Set-semantic label merge
- `closeBead(id)` / `reopenBead(id)`: status transitions
- `tombstoneBead(id)`: status='deleted', ephemeral=0 (no row delete)
- `queryBeads(params)`: dynamic WHERE (see filter precedence in design); in-memory label/metadata filter; in-memory sort + limit
**Criterion for done:** createBead returns bead with do-{N} ID; tombstone does not delete row; queryBeads with status=open matches empty-string rows.
**Confidence:** 🟢 CONFIRMADO

### T-10: Implement FactoryStore Artifact Collection CRUD
**Source:** `workers/gascity-supervisor/src/factory-store-do.ts:370-475`
**Behavior:**
- `insertCollection(collection, doc)`: INSERT into named table; enforcePayloadLimit before write
- `queryCollection(collection, params)`: SELECT with optional filters from query params
- `getCollection(collection, id)`: SELECT by id, 404 if missing
- `patchCollection(collection, id, patch)`: read-modify-write with enforcePayloadLimit; 404 if missing
- `artifactTx(ops)`: wrap batch insertCollection calls in SQLite transaction; ROLLBACK on error
**Criterion for done:** Payload > 1 MB returns 413; artifactTx with error rolls back all inserts.
**Confidence:** 🟢 CONFIRMADO

### T-11: Implement FactoryStore Lineage Walk
**Source:** `workers/gascity-supervisor/src/factory-store-do.ts:462-475`
**Behavior:** Recursive CTE traversal of `lineage_edges` upward from `to_id = ?` up to depth 10. Return all ancestor edges with their depth.
**Criterion for done:** Artifact with 5-hop lineage chain returns 5 edges; depth > 10 is capped.
**Confidence:** 🟢 CONFIRMADO

### T-12: Implement FactoryStore Transaction Operations
**Source:** `workers/gascity-supervisor/src/factory-store-do.ts:282-297`
**Behavior:**
- `runTx(ops)`: wrap in SQLite transaction; apply update/set_metadata_batch/close ops; ROLLBACK on error
- `closeAll()`: set all non-closed beads to status='closed' in one statement
**Criterion for done:** runTx with failing op rolls back all prior ops in the batch; closeAll transitions all open beads.
**Confidence:** 🟢 CONFIRMADO
