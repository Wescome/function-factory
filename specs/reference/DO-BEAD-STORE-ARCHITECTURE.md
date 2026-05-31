# Durable Object Store Architecture

Date: 2026-05-31
Status: Proposed
Scope: Replace bd/Dolt bead store AND ArangoDB artifact store with a single Cloudflare Durable Object hosting two SQLite databases
Repos: `Wescome/gascity` (branch: `factory`) + `function-factory/workers/gascity-supervisor/`

---

## 1. Problem Statement

The current `bd`/Dolt bead store runs inside the Gas City Container on an ephemeral filesystem. This causes:
- **Adoption hang** — Dolt cold-starts under contention, blocking `adopting_sessions` indefinitely
- **State loss** — Container restart wipes all bead state (molecules, steps, metadata)
- **Startup complexity** — adoption barrier, per-op timeouts, aggregate deadlines, all compensating for Dolt cold-start

These are symptoms of one root cause: stateful storage inside a stateless Container.

## 2. Solution

One Cloudflare Durable Object, two SQLite databases:

- **`beads.db`** — Gas City operational state (molecules, steps, bead metadata)
- **`artifacts.db`** — Factory artifact store (specs, verdicts, lineage, IS/ES/EP — replaces ArangoDB)

One DO instance keyed by city name. Both databases are persistent, survive Container restarts and redeploys. Zero external services.

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
                     ├── beads.db      (Gas City operational state)
                     └── artifacts.db  (Factory specs, verdicts, lineage)
```

The DO exposes two route namespaces — `/beads/*` and `/artifacts/*` — each backed by its own SQLite database. The Go `DoStore` calls `/beads/*`. The ff-pipeline Worker calls `/artifacts/*` directly via DO binding (no round-trip through the Container).

**Key benefit:** a molecule step that reads an IS and writes a bead hits one DO in one PoP. No cross-service latency.

## 4. DO Design

### 4.0 Two databases, one DO

```typescript
export class FactoryStore extends DurableObject {
  private beads: SqlStorage     // ctx.storage.sql  (beads.db)
  private artifacts: SqlStorage // ctx.storage.sql2 (artifacts.db)
}
```

All `/beads/*` routes operate on `beads`. All `/artifacts/*` routes operate on `artifacts`. The two databases never cross — no joins between them.

### 4.1 SQLite schema — beads.db

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

### 4.2 SQLite schema — artifacts.db

Mirrors SPEC-ARANGO-RETIRE-001 §4 exactly — same tables, same indexes, targeting this DO instead of DoltHub.

```sql
CREATE TABLE specifications (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  payload    TEXT NOT NULL,  -- JSON
  agent_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE verification_processes (
  id           TEXT PRIMARY KEY,
  spec_id      TEXT NOT NULL REFERENCES specifications(id),
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  payload      TEXT NOT NULL   -- JSON
);

CREATE TABLE verdicts (
  id           TEXT PRIMARY KEY,
  vp_id        TEXT NOT NULL REFERENCES verification_processes(id),
  spec_id      TEXT NOT NULL REFERENCES specifications(id),
  outcome      TEXT NOT NULL,  -- PASS | FAIL | ESCALATE
  coverage_pct REAL,
  agent_id     TEXT NOT NULL,
  produced_at  TEXT NOT NULL,
  payload      TEXT NOT NULL   -- JSON
);

CREATE TABLE lineage_edges (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL,
  from_kind  TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  to_kind    TEXT NOT NULL,
  edge_kind  TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_ref TEXT
);

CREATE INDEX idx_le_from ON lineage_edges(from_id);
CREATE INDEX idx_le_to   ON lineage_edges(to_id);

-- Remaining collections (function_proposals, pressures, capabilities,
-- invariants, run_envelopes, etc.) follow the same pattern:
-- id, kind, payload JSON, agent_id, created_at, updated_at
```

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
  private beads: SqlStorage      // beads.db — Gas City operational state
  private artifacts: SqlStorage  // artifacts.db — Factory specs, verdicts, lineage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.beads = ctx.storage.sql
    this.artifacts = ctx.storage.sql2  // second SQLite database
    this.initBeadsSchema()
    this.initArtifactsSchema()
  }

  private initBeadsSchema(): void {
    this.beads.exec(`CREATE TABLE IF NOT EXISTS beads ( ... )`)
    this.beads.exec(`CREATE TABLE IF NOT EXISTS deps ( ... )`)
  }

  private initArtifactsSchema(): void {
    this.artifacts.exec(`CREATE TABLE IF NOT EXISTS specifications ( ... )`)
    this.artifacts.exec(`CREATE TABLE IF NOT EXISTS verdicts ( ... )`)
    this.artifacts.exec(`CREATE TABLE IF NOT EXISTS lineage_edges ( ... )`)
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

~500 lines TypeScript total. Bead routes and artifact routes are independent handlers sharing one DO instance.

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
- `FactoryStore` class with two SQLite databases (`beads.db`, `artifacts.db`)
- `beads.db` schema + all 14 bead HTTP routes (`/beads/*`, `/deps/*`, `/tx`, `/ping`)
- `artifacts.db` schema (all collections from SPEC-ARANGO-RETIRE-001 §4) + artifact HTTP routes (`/artifacts/*`)
- CTE lineage walk endpoint (`GET /artifacts/lineage`)
- JSON query decoding → SQL for both databases
- Atomic Tx endpoints for both databases
- ID generation (sequential counter per database)

**Acceptance:** all bead Store interface methods reachable via `/beads/*`; all artifact collections readable/writable via `/artifacts/*`; CTE walk completes 10-hop chain in < 100ms; both Tx endpoints are atomic.

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
| DO storage (both SQLite DBs) | $0.20/GB-month | < 50MB → $0.01/mo |
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
