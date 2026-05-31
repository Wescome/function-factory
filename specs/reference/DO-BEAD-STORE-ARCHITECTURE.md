# Durable Object Store Architecture

Date: 2026-05-31
Status: Approved — Architect reviewed 2026-05-31
Scope: Replace bd/Dolt bead store AND ArangoDB artifact store with a single Cloudflare Durable Object, one SQLite database, cross-boundary foreign keys between execution plane (beads) and knowledge plane (artifacts)
Repos: `Wescome/gascity` (branch: `factory`) + `function-factory/workers/gascity-supervisor/`

---

## 1. Problem Statement

The current `bd`/Dolt bead store runs inside the Gas City Container on an ephemeral filesystem. This causes:
- **Adoption hang** — Dolt cold-starts under contention, blocking `adopting_sessions` indefinitely
- **State loss** — Container restart wipes all bead state (molecules, steps, metadata)
- **Startup complexity** — adoption barrier, per-op timeouts, aggregate deadlines, all compensating for Dolt cold-start

These are symptoms of one root cause: stateful storage inside a stateless Container.

## 2. Solution

One Cloudflare Durable Object, one SQLite database, two table namespaces:

- **Execution plane** (`beads`, `deps`) — Gas City operational state
- **Knowledge plane** (`specifications`, `verdicts`, `lineage_edges`, etc.) — Factory artifact store, replaces ArangoDB

One DO instance keyed by city name. One `ctx.storage.sql`. Real SQLite foreign keys cross the boundary — every Factory artifact references the bead that produced it. Zero external services. Zero `ctx.storage.sql2` (CF DO exposes one SQLite per DO instance).

## 3. Architecture

```
Gas City Container (stateless)          ff-pipeline Worker
    │                                       │
    │  HTTP (Worker proxy)                  │  DO binding
    │                                       │
    └──────────────► gascity-supervisor Worker ◄──────────
                              │
                              │  DO binding
                              ▼
                     FactoryStore DO
                     └── SQLite (one DB, two namespaces)
                         ├── execution plane: beads, deps
                         └── knowledge plane: specifications, verdicts,
                                              lineage_edges, ...
                                              (FKs → beads.id)
```

The DO exposes two route namespaces — `/beads/*` and `/artifacts/*` — both backed by the same SQLite database. The Go `DoStore` calls `/beads/*`. The ff-pipeline Worker calls `/artifacts/*` directly via DO binding.

**Key benefit:** cross-boundary foreign keys are real SQLite constraints — every verdict and lineage edge references the bead that produced it. Execution trace and knowledge trace are structurally linked, not logically inferred.

## 4. DO Design

### 4.0 One database, two namespaces

```typescript
export class FactoryStore extends DurableObject {
  private db: SqlStorage  // ctx.storage.sql — one SQLite instance
}
```

One `ctx.storage.sql`. Both `/beads/*` and `/artifacts/*` routes operate on `this.db`. Foreign keys across the boundary are real SQLite constraints enforced at write time.

**VACUUM strategy — required, not optional.** SQLite `DELETE` frees pages to a freelist but never shrinks the file. The knowledge plane (artifacts) is append-only and permanent — it grows monotonically. Without vacuum, deleted bead rows keep consuming DO storage ($0.20/GB-month). `PRAGMA auto_vacuum = INCREMENTAL` must be set **before the first `CREATE TABLE`** (cannot be changed after). Periodic `PRAGMA incremental_vacuum` runs on a DO alarm (weekly or when `page_count * page_size > threshold`).

**CF DO SQLite compatibility note:** Confirm `PRAGMA auto_vacuum = INCREMENTAL` is honored by the DO SQLite backend before writing it into WP-DO-1 acceptance criteria — CF may not expose all SQLite PRAGMA tuning. If unavailable, the alarm-driven `incremental_vacuum` pattern is the fallback.

### 4.1 SQLite schema — execution plane (beads)

```sql
CREATE TABLE beads (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed' | 'deleted' (tombstone)
  issue_type  TEXT NOT NULL DEFAULT 'task',
  priority    INTEGER,
  created_at  TEXT NOT NULL,
  assignee    TEXT,
  from_       TEXT,
  parent_id   TEXT,
  ref         TEXT,
  needs       TEXT,        -- JSON array
  description TEXT,
  labels      TEXT,        -- JSON array
  metadata    TEXT,        -- JSON object
  ephemeral   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_status       ON beads(status);
CREATE INDEX idx_parent_id    ON beads(parent_id);
CREATE INDEX idx_assignee     ON beads(assignee, status);
CREATE INDEX idx_ephemeral    ON beads(ephemeral);

CREATE TABLE deps (
  issue_id      TEXT NOT NULL,
  depends_on_id TEXT NOT NULL,
  dep_type      TEXT NOT NULL,
  PRIMARY KEY (issue_id, depends_on_id)
);

CREATE INDEX idx_deps_up ON deps(depends_on_id);
```

Labels and metadata stored as JSON columns — SQLite JSON functions (`json_each`, `json_extract`) handle filtering without external index maintenance.

**Bead deletion policy — tombstone-only (recommended, decided now).** Knowledge plane tables carry `emission_bead_id REFERENCES beads(id)`. A hard SQL `DELETE` of a bead that still has artifact references would violate FK integrity (`PRAGMA foreign_keys = ON` rejects it) or, if FKs were off, would orphan lineage. Therefore **bead rows are tombstoned, never hard-deleted via the API**: deletion sets `status = 'deleted'` and `ephemeral = 0` (a tombstone is permanent record, not garbage) and leaves the row — and all artifact FKs pointing at it — intact. Queries (`ListOpen`, `Ready`, etc.) already exclude non-open statuses, so tombstoned beads disappear from operational views without breaking the knowledge plane.

If a true hard delete is ever required (e.g. a privacy purge), it is NOT a routine API operation. It requires either (a) first nulling `emission_bead_id` on every referencing row, or (b) declaring the FKs `ON DELETE SET NULL` and accepting that purged beads sever their artifacts' provenance link. The standing decision is **tombstone-only**; hard delete is an explicit, out-of-band operator action, not a code path the API exposes.

### 4.2 SQLite schema — knowledge plane (artifacts)

Cross-boundary foreign keys on `emission_bead_id` tie every artifact to the bead that produced it. `PRAGMA foreign_keys = ON` enforced on every connection.

```sql
CREATE TABLE specifications (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  status           TEXT NOT NULL,
  payload          TEXT NOT NULL,   -- JSON
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead that produced this spec
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE verification_processes (
  id               TEXT PRIMARY KEY,
  spec_id          TEXT NOT NULL REFERENCES specifications(id),
  kind             TEXT NOT NULL,
  status           TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead that ran this VP
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  payload          TEXT NOT NULL    -- JSON
);

CREATE TABLE verdicts (
  id               TEXT PRIMARY KEY,
  vp_id            TEXT NOT NULL REFERENCES verification_processes(id),
  spec_id          TEXT NOT NULL REFERENCES specifications(id),
  outcome          TEXT NOT NULL,   -- PASS | FAIL | ESCALATE
  coverage_pct     REAL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead that produced this verdict
  produced_at      TEXT NOT NULL,
  payload          TEXT NOT NULL    -- JSON
);

CREATE TABLE lineage_edges (
  id               TEXT PRIMARY KEY,
  from_id          TEXT NOT NULL,
  from_kind        TEXT NOT NULL,
  to_id            TEXT NOT NULL,
  to_kind          TEXT NOT NULL,
  edge_kind        TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead during which this edge was emitted
  created_at       TEXT NOT NULL,
  source_ref       TEXT
);

CREATE INDEX idx_le_from          ON lineage_edges(from_id);
CREATE INDEX idx_le_to            ON lineage_edges(to_id);
CREATE INDEX idx_le_emission_bead ON lineage_edges(emission_bead_id);
CREATE INDEX idx_verdicts_bead    ON verdicts(emission_bead_id);

-- Remaining collections (function_proposals, pressures, capabilities,
-- invariants, run_envelopes, etc.) carry emission_bead_id REFERENCES beads(id)
-- following the same pattern.
```

**`emission_bead_id` semantics:** nullable (artifacts produced outside a molecule execution set it to NULL). When set, it is the exact bead ID at the moment the artifact was emitted — never inferred, never reconstructed.

### 4.3 DO HTTP API

All routes require `Authorization: Bearer <GC_SUPERVISOR_TOKEN>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/beads` | Create bead |
| `GET` | `/beads/:id` | Get bead |
| `PATCH` | `/beads/:id` | Update bead |
| `DELETE` | `/beads/:id` | Tombstone bead — sets `status = 'deleted'`, does NOT issue SQL `DELETE` (preserves artifact FKs) |
| `POST` | `/beads/:id/close` | Close bead |
| `POST` | `/beads/:id/reopen` | Reopen bead |
| `POST` | `/beads/close-all` | CloseAll batch |
| `GET` | `/beads?query=...` | List/Ready/Children/ListByX |
| `POST` | `/beads/:id/metadata` | SetMetadataBatch |
| `POST` | `/tx` | Tx (serialized batch) |
| `GET` | `/deps/:id?direction=down` | DepList |
| `POST` | `/deps` | DepAdd |
| `DELETE` | `/deps/:issue/:depends_on` | DepRemove |
| `GET` | `/ping` | Health check |

**Artifact routes** (`/artifacts/*`) — called by ff-pipeline Worker directly via DO binding:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/artifacts/:collection` | Insert document |
| `GET` | `/artifacts/:collection/:id` | Get document |
| `PATCH` | `/artifacts/:collection/:id` | Update document |
| `GET` | `/artifacts/:collection?query=...` | Query collection |
| `POST` | `/artifacts/lineage` | Add lineage edge |
| `GET` | `/artifacts/lineage?from=...&to=...` | Walk lineage |
| `POST` | `/artifacts/tx` | Artifact transaction |

### 4.5 CTE lineage walk (replaces AQL graph traversal)

The `GET /artifacts/lineage` endpoint supports a recursive CTE walk — same benchmark criterion as SPEC-ARANGO-RETIRE-001 §6: 10-hop chain < 100ms. SQLite recursive CTEs are natively supported.

```sql
WITH RECURSIVE lineage_walk AS (
  SELECT id, from_id, to_id, from_kind, to_kind, edge_kind, 1 AS depth
  FROM lineage_edges WHERE to_id = ?
  UNION ALL
  SELECT le.id, le.from_id, le.to_id, le.from_kind, le.to_kind, le.edge_kind, lw.depth + 1
  FROM lineage_edges le
  JOIN lineage_walk lw ON le.to_id = lw.from_id
  WHERE lw.depth < 10
)
SELECT * FROM lineage_walk;
```

### 4.6 Query encoding (beads.db)

The `GET /beads` endpoint accepts a `query` param (JSON-encoded `ListQuery`). The DO translates to SQL. Key query types:

- `ListOpen` → `WHERE status != 'closed'`
- `Ready` → `WHERE status = 'open' AND issue_type NOT IN (...)` (exclusion list from `readyExcludeTypes`)
- `Children` → `WHERE parent_id = ?`
- `ListByLabel` → `WHERE json_each(labels) LIKE ?` or `EXISTS (SELECT 1 FROM json_each(labels) WHERE value = ?)`
- `ListByAssignee` → `WHERE assignee = ? AND status = ?`
- `ListByMetadata` → `WHERE json_extract(metadata, '$.key') = ?` per filter key

### 4.7 ID generation

DO generates IDs sequentially using a SQLite counter: `SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INT)), 0) + 1`. Format: `do-<n>` (e.g. `do-1`, `do-42`). Atomic under SQLite serialization — no races.

### 4.8 Tx implementation

The DO's `POST /tx` endpoint accepts a list of operations and executes them inside a SQLite `BEGIN TRANSACTION / COMMIT`. The Go `DoStore.Tx()` serializes the callback's writes into a batch request. Rollback on any operation failure.

**Read-modify-write is NOT atomic across the read and the write.** The `/tx` endpoint executes operations atomically. Read operations inside a `Tx` callback are **NOT** batched — `DoStore` executes them immediately (a separate round-trip to the DO) before the batch is assembled. This means a read-modify-write sequence inside `Tx` (read a bead, modify it in Go, write it back via the batch) is **not atomic across the read and the write**: another writer could modify the row between the read round-trip and the `/tx` commit. This limitation must be documented explicitly for every `beads.Store` caller.

**Incompatible callers must be refactored before cutover.** If any existing `beads.Store` caller performs read-modify-write inside `Tx`, `DoStore` is incompatible with that caller as written. Such callers must be refactored to use compare-and-swap semantics (conditional write predicated on the value last read) or optimistic locking (version/etag column checked at write time) before switching to `DoStore`.

### 4.9 SQLite payload limits

DO SQLite enforces per-row and per-query size limits. Large `payload`, `metadata`, or `description` blobs can hit them.

- **Max row size:** SQLite's theoretical ceiling is ~1GB per row, but CF DO SQLite may enforce a lower limit. Assume **1MB max per column** as a safe working limit until CF documents otherwise.
- **`payload` and `metadata` columns** that may exceed 1MB must be chunked, or stored in R2 with a reference key (the R2 object key) written into the DO row instead of the inline blob. The DO row then carries a pointer, not the payload.
- **`description` text fields:** truncate at 64KB in the API layer before the write reaches SQLite. Truncation happens explicitly in the route handler, never silently inside SQLite.

---

## 5. Go Implementation (`DoStore`)

**Package:** `internal/beads/dostore.go` in `Wescome/gascity`

**Struct:**
```go
type DoStore struct {
    baseURL    string        // DO binding URL from city config
    token      string        // GC_SUPERVISOR_TOKEN
    httpClient *http.Client  // with timeout
}
```

**Constructor:**
```go
func NewDoStore(baseURL, token string) *DoStore
```

**Interface coverage:** implements all 20 methods of `beads.Store` by mapping each to the corresponding DO HTTP endpoint. No local state — every call is a round-trip to the DO.

**Round-trip latency:** < 1ms (same CF PoP, internal routing). No cold-start. No adoption phase.

---

## 6. City Config

`factory/city.toml`:

```toml
[beads]
provider = "do"

[beads.do]
url_env = "GC_BEAD_STORE_URL"   # injected by Worker via Container env
token_env = "GC_SUPERVISOR_TOKEN"
```

**Container → DO requests are proxied through the supervisor Worker.** A Container cannot call a Durable Object directly — DO stubs are only reachable from a Worker that holds the binding. `idFromName(city).toString()` returns a DO *object ID* (an opaque hex string), not a fetch URL; injecting it as `GC_BEAD_STORE_URL` would give the Container an unroutable string. The correct pattern is an internal Worker route that resolves the stub and forwards the request.

**Internal proxy route (gascity-supervisor Worker).** Add a route `GET/POST /internal/bead-store/:city/*` that resolves the DO stub and forwards:
```typescript
// workers/gascity-supervisor/src/index.ts (router)
// matches: /internal/bead-store/:city/*  e.g. /internal/bead-store/factory/beads/do-42
if (url.pathname.startsWith('/internal/bead-store/')) {
  // auth: same bearer token the Worker already validates
  if (request.headers.get('Authorization') !== `Bearer ${env.GC_SUPERVISOR_TOKEN}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const rest = url.pathname.slice('/internal/bead-store/'.length) // "factory/beads/do-42"
  const slash = rest.indexOf('/')
  const city = rest.slice(0, slash)                               // "factory"
  const doPath = rest.slice(slash)                                // "/beads/do-42"
  const stub = env.FACTORY_STORE.get(env.FACTORY_STORE.idFromName(city))
  // forward to the DO with the original method, body, headers, and the rewritten path
  return stub.fetch(new Request(new URL(doPath + url.search, 'https://do.internal'), request))
}
```

**Container env.** Inject the Worker's own public URL prefix (not a DO ID) when starting the Container:
```typescript
GC_BEAD_STORE_URL: `https://gascity-supervisor.koales.workers.dev/internal/bead-store/${cityName}`
// e.g. https://gascity-supervisor.koales.workers.dev/internal/bead-store/factory
```
The Go `DoStore` then builds request paths against this prefix (`${GC_BEAD_STORE_URL}/beads/do-42`), and the Worker route strips the prefix, resolves the DO stub by city name, and forwards.

**Auth.** The Container sends `Authorization: Bearer ${GC_SUPERVISOR_TOKEN}` — the same token the Worker already validates on `/internal/*` requests. No new credential is introduced.

`workers/gascity-supervisor/wrangler.jsonc` — add DO binding:
```jsonc
"durable_objects": {
  "bindings": [{ "name": "FACTORY_STORE", "class_name": "FactoryStore" }]
},
"migrations": [{ "tag": "v1", "new_classes": ["FactoryStore"] }]
```

ff-pipeline also binds to the same DO class via a Service Binding to gascity-supervisor, giving it direct access to `/artifacts/*` routes without going through the Container.

---

## 7. Worker Implementation

**File:** `workers/gascity-supervisor/src/factory-store-do.ts`

```typescript
export class FactoryStore extends DurableObject {
  private db: SqlStorage  // one SQLite instance — both planes

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.db = ctx.storage.sql
    this.db.exec('PRAGMA foreign_keys = ON')
    this.initSchema()
  }

  private initSchema(): void {
    // Execution plane first — knowledge plane FKs reference beads(id)
    this.db.exec(`CREATE TABLE IF NOT EXISTS beads ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS deps ( ... )`)
    // Knowledge plane
    this.db.exec(`CREATE TABLE IF NOT EXISTS specifications ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS verdicts ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS lineage_edges ( ... )`)
    // remaining collections
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/beads') || url.pathname.startsWith('/deps') || url.pathname === '/tx' || url.pathname === '/ping') {
      return this.handleBeads(request)
    }
    if (url.pathname.startsWith('/artifacts')) {
      return this.handleArtifacts(request)
    }
    return new Response('not found', { status: 404 })
  }
}
```

~500 lines TypeScript. Both handlers share `this.db`. `foreign_keys = ON` means an artifact write with an invalid `emission_bead_id` fails at the SQLite layer — no application-level enforcement needed. Execution plane tables must be created before knowledge plane tables in `initSchema()`.

---

## 8. Migration Path

1. Ship `DoStore` Go implementation + DO TypeScript alongside existing `BdStore`
2. Add `provider = "do"` to city config parser (no other code changes)
3. Test with `provider = "do"` in a staging city
4. Switch `factory/city.toml` to `provider = "do"`
5. Remove adoption barrier code (no longer needed) — separate cleanup commit
6. Remove bd/Dolt from Dockerfile (no longer needed) — reduces image size by ~40MB

### Cutover gate (between step 3 and step 4)

Step 4 (switching `factory/city.toml` to `provider = "do"`) is a **one-way cutover gate**. Before crossing it:

- **Confirm the DO has received at least one full molecule lifecycle** while running in staging (step 3) — a molecule dispatched, stepped through plan/code/verify, and released, with all beads and emitted artifacts persisted in the DO. This proves the DO store is functionally authoritative before any production traffic depends on it.
- Confirm DO storage is readable after a Container restart (bead state survives, in-flight molecule resumes).

Only once the gate is passed does step 4 proceed.

### Rollback

**Rollback is only valid BEFORE the cutover gate (step 4).** While `provider = "bd"` is still authoritative (steps 1–3), reverting is free: bd holds all live state, the DO is a parallel staging target, and switching the config back loses nothing. Both stores implement the same interface, so no code migration is needed for a pre-cutover rollback.

**After the cutover gate, rollback is NOT a config flip.** Once `provider = "do"` is live and the DO has accepted writes, **bd is empty** — it received nothing after cutover. Switching `city.toml` back to `provider = "bd"` at that point is **state loss**: every bead and artifact created since cutover lives only in the DO. Post-cutover recovery requires restoring state from a **DO export** (export the DO's SQLite contents, replay/import into the target store), not a config toggle. Treat post-cutover rollback as a data-migration operation, never as "flip the provider back."

---

## 9. Work Packages

### WP-DO-1: FactoryStore DO (TypeScript)
**File:** `workers/gascity-supervisor/src/factory-store-do.ts`
- `FactoryStore` class, one `ctx.storage.sql`, `PRAGMA foreign_keys = ON`
- Execution plane schema (beads, deps) created first
- Knowledge plane schema (all collections from SPEC-ARANGO-RETIRE-001 §4) with `emission_bead_id TEXT REFERENCES beads(id)` on every artifact table
- All 14 bead HTTP routes (`/beads/*`, `/deps/*`, `/tx`, `/ping`)
- Artifact HTTP routes (`/artifacts/*`) — insert/get/query/lineage-walk
- CTE lineage walk endpoint (`GET /artifacts/lineage`)
- Single shared Tx endpoint (both planes, one SQLite transaction)
- Sequential ID generation (one counter table, both planes share it)
- `PRAGMA auto_vacuum = INCREMENTAL` set before first `CREATE TABLE` (verify CF DO SQLite support)
- DO alarm registered for weekly `PRAGMA incremental_vacuum`

**Acceptance:** FK violation on invalid `emission_bead_id` returns 409; CTE walk completes 10-hop chain in < 100ms; Tx is atomic across both planes; `PRAGMA auto_vacuum` setting confirmed at DB creation; `payload` column writes > 1MB return **413** from the DO route, not a silent truncation.

### WP-DO-2: DoStore Go client
**File:** `internal/beads/dostore.go` in `Wescome/gascity`
- Implement `beads.Store` interface
- All 20 methods → HTTP round-trips
- 10s default timeout per call
- Retry once on 5xx (idempotent reads/writes)

**Acceptance:** `go test ./internal/beads/...` passes with DoStore against a local DO emulator. **Tx conformance test suite:** run the existing `beads.Store` test suite against `DoStore`. All callers that invoke `Tx` must be audited for read-modify-write patterns (per §4.8) before cutover; any read-modify-write caller is refactored to compare-and-swap / optimistic locking first.

### WP-DO-3: Config wiring
**Files:** `internal/config/`, `cmd/gc/city_runtime.go`
- Add `provider = "do"` to city config parser
- Add `[beads.do]` block: `url_env`, `token_env`
- Wire `NewDoStore` in store factory

**Acceptance:** `city.toml` with `provider = "do"` starts a city using DoStore.

### WP-DO-4: Worker binding + deploy
**Files:** `workers/gascity-supervisor/src/index.ts`, `wrangler.jsonc`, `workers/ff-pipeline/wrangler.jsonc`
- Add `FactoryStore` DO binding to gascity-supervisor
- Add internal proxy route `GET/POST /internal/bead-store/:city/*` to gascity-supervisor — resolves the DO stub via `env.FACTORY_STORE.get(env.FACTORY_STORE.idFromName(city))`, validates the `GC_SUPERVISOR_TOKEN` bearer, and forwards the request to the DO (Container cannot call the DO directly)
- Inject `GC_BEAD_STORE_URL = https://gascity-supervisor.koales.workers.dev/internal/bead-store/<city>` (the Worker URL prefix, NOT a DO object ID) into Container env
- Add Service Binding from ff-pipeline → gascity-supervisor for `/artifacts/*` access
- Add DO migration tag
- Replace `createClientFromEnv(env)` (ArangoDB) in ff-pipeline with `FactoryStore` artifact client

**Acceptance:** `wrangler deploy` succeeds on both Workers. ff-pipeline reads/writes artifacts via DO. Container reads/writes beads via DO.

### WP-DO-5: Switch + cleanup
- Set `factory/city.toml` to `provider = "do"`
- Migrate existing ArangoDB documents → DO artifact routes (one-time backfill script)
- Remove ArangoDB (`ff-arango` Worker + Container) — ff-pipeline no longer references it
- Gut the Dolt cold-start waiting logic in `cmd/gc/adoption_barrier.go`. Retain any session consistency checks that are not Dolt-specific. Do **not** remove the adoption phase from the startup FSM — remove only the Dolt-dependent blocking operations within it.
- Remove Dolt + bd from Dockerfile
- Update `entrypoint.sh` (no Dolt identity setup needed)
- Remove `@factory/arango-client` usages from ff-pipeline

**Acceptance:** Container image ~40MB smaller. No adoption phase in startup logs. `adopting_sessions` phase completes in < 100ms. Zero ArangoDB references in codebase. ff-arango Worker deleted.

---

## 10. Cost

CF DO SQLite bills **per row read and per row write**, not just storage bytes. Artifact-heavy workloads (lineage edges, verdicts, specs) generate significant row writes, so the earlier "$<1/month" figure understated cost. The table below accounts for row-level billing.

| Resource | Rate | Factory estimate |
|----------|------|-----------------|
| DO requests | $0.15/million | ~10k-100k/day → < $0.50/mo |
| DO SQLite row reads | $0.001/million rows read | ~1M reads/day (bead queries during active molecules) → ~$0.03/mo at bootstrap scale |
| DO SQLite row writes | $1.00/million rows written | ~100k writes/day (beads + artifacts) → ~$3/mo at bootstrap scale |
| DO storage (one SQLite DB) | $0.20/GB-month | < 50MB → $0.01/mo |
| ff-arango Container | eliminated | $0 saved |
| ArangoDB Oasis | eliminated | $0 saved |
| DoltHub | never provisioned | $0 saved |
| **Total** | | **$3–10/month at bootstrap scale, revisit at 10x molecule volume** |

**Storage ceiling.** CF DO has a **10GB per-DO storage ceiling on the paid plan**. At current artifact volume this is not a near-term risk, but it must be monitored — one DO per city means a single city's combined execution + knowledge plane cannot exceed 10GB without a sharding redesign (see G2 throughput watch in §13).

**VACUUM affects billing.** The VACUUM strategy (§4.0) directly affects storage billing: without incremental vacuum, deleted bead rows keep consuming the $0.20/GB-month storage charge and count against the 10GB ceiling. The append-only knowledge plane already grows monotonically; reclaiming freed execution-plane pages is the only lever on storage growth.

---

## 11. Acceptance Criteria

1. `adopting_sessions` completes in < 100ms on every Container start
2. Bead state survives Container restart — molecules in progress resume correctly
3. All `beads.Store` interface methods pass existing test suite with `DoStore`
4. No Dolt binary in Container image
5. R2 push loop no longer needed (DO storage is inherently persistent)
6. All ArangoDB artifact reads/writes in ff-pipeline replaced by DO artifact client
7. CTE lineage walk completes 10-hop chain in < 100ms against production DO
8. ff-arango Worker and Container deleted from codebase and CF account
9. Zero references to `@factory/arango-client` in Workers (excluding tombstone comments)
10. `PRAGMA auto_vacuum = INCREMENTAL` confirmed set at DB creation; DO alarm for `incremental_vacuum` registered and firing

---

## 12. Non-Goals

- Migrating historical bead data from bd/Dolt to DO (start fresh — in-flight molecules are short-lived)
- Multi-city DO sharing (one DO per city, isolated)
- Replacing the DO with D1 (D1 adds network hop + eventual consistency; DO SQLite is synchronous and local)
- DoltHub (never provisioned — DO is the target for both beads and artifacts)
- Splitting into two SQLite instances (CF DO exposes one `ctx.storage.sql`; two instances would break cross-boundary FK enforcement)

---

## 13. Architectural Guardrails (Architect review 2026-05-31)

Full Architect assessment: `specs/reference/DO-MIGRATION-RESEARCH.md §8`
Decision record: `.agent/memory/semantic/DECISIONS.md §2026-05-31`


Three conditions attach from the Architect review. These are guardrails, not migration blockers.

**G1 — Rig-store gate.**
Before any formula introduces a `[[rig]]` block, answer the rig-store routing question: does `DoStore` for a rig point to rig-scoped routes within one city DO, or a separate DO keyed by rig name? Track as an open architecture gate. Do not ship a formula with `[[rig]]` declarations until this is resolved. `factory/city.toml` currently has zero `[[rig]]` blocks — this gate is dormant today.

**G2 — Throughput watch (single-DO hotspot).**
DO single-writer serialization is sufficient at `max_active_sessions = 3`. If active sessions scale by ~10x, re-evaluate whether one DO per city remains adequate or whether sharding is needed. `CachingStore` (upstream Gas City, `d0f6ad0d`) can wrap `DoStore` to reduce read round-trips if read latency becomes the constraint before write throughput does.

A subtler risk arrives **before** the ~10x session threshold: one DO per city means a single SQLite writer serializes **both** beads (execution plane) **and** artifacts (knowledge plane). Artifact-heavy molecules emit many lineage edges, verdicts, and specs per step — a write-heavy artifact workload can contend on the single writer and become a throughput bottleneck while session count is still well under the 10x mark.

**Shard trigger (explicit):** *if p95 write latency exceeds 50ms under normal molecule load, evaluate splitting the single DO into separate execution-plane and knowledge-plane DOs.*

**Escape hatch — DO split, and what it costs.** Splitting execution (beads/deps) and knowledge (specifications/verdicts/lineage_edges/...) into two DOs restores independent write serialization per plane. The price is that **cross-DO foreign keys are not enforceable** — SQLite FKs only hold within one DB. `emission_bead_id REFERENCES beads(id)` stops being a DB-level constraint the moment the planes live in different DOs. That integrity must then move to the application layer: **emit-time validation in `webhook-receiver.ts`** (and any artifact-write path) must confirm the referenced bead exists in the execution-plane DO before accepting the artifact write into the knowledge-plane DO, and reject (HTTP 409) on a dangling reference — exactly the guarantee the DB-level FK gives today. Do not split until this application-level integrity check is specified and built; the single-DO design's whole point (structurally linked execution and knowledge traces) depends on it.

**G3 — Operator runbook: re-dispatch replaces `dolt checkout`.**
`dolt checkout` rollback is gone. The sanctioned recovery for corrupted bead state is re-dispatch. The operator runbook must document this explicitly before WP-DO-5 cleanup ships. A molecule whose bead state is corrupt is recovered by closing the bead and dispatching a fresh molecule from the same IS/ES — not by time-traveling the bead store.
