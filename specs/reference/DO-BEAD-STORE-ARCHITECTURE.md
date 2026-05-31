# Durable Object Store Architecture

Date: 2026-05-31
Status: Proposed
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

### 4.1 SQLite schema — execution plane (beads)

```sql
CREATE TABLE beads (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
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
| `DELETE` | `/beads/:id` | Delete bead |
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

`workers/gascity-supervisor/src/index.ts` — inject `GC_BEAD_STORE_URL` as the DO binding stub URL when starting the Container:
```typescript
GC_BEAD_STORE_URL: env.BEAD_STORE.idFromName(cityName).toString()
// or the DO's fetch URL via env.BEAD_STORE.get(id)
```

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

**Rollback:** switch `city.toml` back to `provider = "bd"`. Both stores implement the same interface. No data migration needed — the DO store is authoritative from the moment it's switched to.

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

**Acceptance:** FK violation on invalid `emission_bead_id` returns 409; CTE walk completes 10-hop chain in < 100ms; Tx is atomic across both planes.

### WP-DO-2: DoStore Go client
**File:** `internal/beads/dostore.go` in `Wescome/gascity`
- Implement `beads.Store` interface
- All 20 methods → HTTP round-trips
- 10s default timeout per call
- Retry once on 5xx (idempotent reads/writes)

**Acceptance:** `go test ./internal/beads/...` passes with DoStore against a local DO emulator.

### WP-DO-3: Config wiring
**Files:** `internal/config/`, `cmd/gc/city_runtime.go`
- Add `provider = "do"` to city config parser
- Add `[beads.do]` block: `url_env`, `token_env`
- Wire `NewDoStore` in store factory

**Acceptance:** `city.toml` with `provider = "do"` starts a city using DoStore.

### WP-DO-4: Worker binding + deploy
**Files:** `workers/gascity-supervisor/src/index.ts`, `wrangler.jsonc`, `workers/ff-pipeline/wrangler.jsonc`
- Add `FactoryStore` DO binding to gascity-supervisor
- Inject `GC_BEAD_STORE_URL` into Container env
- Add Service Binding from ff-pipeline → gascity-supervisor for `/artifacts/*` access
- Add DO migration tag
- Replace `createClientFromEnv(env)` (ArangoDB) in ff-pipeline with `FactoryStore` artifact client

**Acceptance:** `wrangler deploy` succeeds on both Workers. ff-pipeline reads/writes artifacts via DO. Container reads/writes beads via DO.

### WP-DO-5: Switch + cleanup
- Set `factory/city.toml` to `provider = "do"`
- Migrate existing ArangoDB documents → DO artifact routes (one-time backfill script)
- Remove ArangoDB (`ff-arango` Worker + Container) — ff-pipeline no longer references it
- Remove adoption barrier code (`cmd/gc/adoption_barrier.go` — gut to no-op)
- Remove Dolt + bd from Dockerfile
- Update `entrypoint.sh` (no Dolt identity setup needed)
- Remove `@factory/arango-client` usages from ff-pipeline

**Acceptance:** Container image ~40MB smaller. No adoption phase in startup logs. `adopting_sessions` phase completes in < 100ms. Zero ArangoDB references in codebase. ff-arango Worker deleted.

---

## 10. Cost

| Resource | Rate | Factory estimate |
|----------|------|-----------------|
| DO requests | $0.15/million | ~10k-100k/day → < $0.50/mo |
| DO storage (one SQLite DB) | $0.20/GB-month | < 50MB → $0.01/mo |
| ff-arango Container | eliminated | $0 saved |
| ArangoDB Oasis | eliminated | $0 saved |
| DoltHub | never provisioned | $0 saved |
| **Total** | | **< $1/month** |

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

---

## 12. Non-Goals

- Migrating historical bead data from bd/Dolt to DO (start fresh — in-flight molecules are short-lived)
- Multi-city DO sharing (one DO per city, isolated)
- Replacing the DO with D1 (D1 adds network hop + eventual consistency; DO SQLite is synchronous and local)
- DoltHub (never provisioned — DO is the target for both beads and artifacts)
- Splitting into two SQLite instances (CF DO exposes one `ctx.storage.sql`; two instances would break cross-boundary FK enforcement)
