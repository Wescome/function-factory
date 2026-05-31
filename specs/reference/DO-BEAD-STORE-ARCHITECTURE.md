# Durable Object Bead Store Architecture

Date: 2026-05-31
Status: Proposed
Scope: Replace bd/Dolt bead store with Cloudflare Durable Object + SQLite
Repos: `Wescome/gascity` (branch: `factory`) + `function-factory/workers/gascity-supervisor/`

---

## 1. Problem Statement

The current `bd`/Dolt bead store runs inside the Gas City Container on an ephemeral filesystem. This causes:
- **Adoption hang** — Dolt cold-starts under contention, blocking `adopting_sessions` indefinitely
- **State loss** — Container restart wipes all bead state (molecules, steps, metadata)
- **Startup complexity** — adoption barrier, per-op timeouts, aggregate deadlines, all compensating for Dolt cold-start

These are symptoms of one root cause: stateful storage inside a stateless Container.

## 2. Solution

Replace the `bd`/Dolt bead store with a Cloudflare Durable Object backed by native SQLite storage.

- Each Gas City city gets one DO instance (keyed by city name)
- The DO holds a persistent SQLite database — survives Container restarts, process kills, redeploys
- Gas City's Container becomes purely stateless compute; it reads/writes the DO over HTTP
- No adoption phase — beads are always there; the Container just reconnects

## 3. Architecture

```
Gas City Container (stateless)
    │
    │  HTTP (internal CF routing, < 1ms)
    ▼
BeadStore DO (persistent SQLite)
    │
    └── SQLite: beads, deps, metadata, indexes
```

The DO exposes a simple REST API. The Go `DoStore` implements `beads.Store` by calling that API. The Container never touches a filesystem for bead state.

## 4. DO Design

### 4.1 SQLite schema

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

### 4.2 DO HTTP API

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

### 4.3 Query encoding

The `GET /beads` endpoint accepts a `query` param (JSON-encoded `ListQuery`). The DO translates to SQL. Key query types:

- `ListOpen` → `WHERE status != 'closed'`
- `Ready` → `WHERE status = 'open' AND issue_type NOT IN (...)` (exclusion list from `readyExcludeTypes`)
- `Children` → `WHERE parent_id = ?`
- `ListByLabel` → `WHERE json_each(labels) LIKE ?` or `EXISTS (SELECT 1 FROM json_each(labels) WHERE value = ?)`
- `ListByAssignee` → `WHERE assignee = ? AND status = ?`
- `ListByMetadata` → `WHERE json_extract(metadata, '$.key') = ?` per filter key

### 4.4 ID generation

DO generates IDs sequentially using a SQLite counter: `SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INT)), 0) + 1`. Format: `do-<n>` (e.g. `do-1`, `do-42`). Atomic under SQLite serialization — no races.

### 4.5 Tx implementation

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
  "bindings": [{ "name": "BEAD_STORE", "class_name": "BeadStore" }]
},
"migrations": [{ "tag": "v1", "new_classes": ["BeadStore"] }]
```

---

## 7. Worker Implementation

**File:** `workers/gascity-supervisor/src/bead-store-do.ts`

```typescript
export class BeadStore extends DurableObject {
  private db: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.db = ctx.storage.sql
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS beads ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS deps ( ... )`)
    // indexes
  }

  async fetch(request: Request): Promise<Response> {
    // route to handlers
  }
}
```

~300 lines TypeScript. SQL queries map 1:1 to Store interface methods.

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

### WP-DO-1: DO + SQLite (TypeScript)
**File:** `workers/gascity-supervisor/src/bead-store-do.ts`
- `BeadStore` class with SQLite schema
- All 14 HTTP routes
- JSON query decoding → SQL
- Tx endpoint (SQLite transaction)
- ID generation (sequential counter)

**Acceptance:** all Store interface methods reachable via HTTP, correct SQLite semantics, Tx is atomic.

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
**Files:** `workers/gascity-supervisor/src/index.ts`, `wrangler.jsonc`
- Add `BeadStore` DO binding
- Inject `GC_BEAD_STORE_URL` into Container env
- Add DO migration tag

**Acceptance:** `wrangler deploy` succeeds, DO binding resolves from Container.

### WP-DO-5: Switch + cleanup
- Set `factory/city.toml` to `provider = "do"`
- Remove adoption barrier code (`cmd/gc/adoption_barrier.go` — or gut it to a no-op)
- Remove Dolt + bd from Dockerfile
- Update `entrypoint.sh` (no Dolt identity setup needed)

**Acceptance:** Container image ~40MB smaller. No adoption phase in startup logs. `adopting_sessions` phase completes in < 100ms.

---

## 10. Cost

| Resource | Rate | Factory estimate |
|----------|------|-----------------|
| DO requests | $0.15/million | ~10k-100k/day → < $0.50/mo |
| DO storage (SQLite) | $0.20/GB-month | < 10MB → $0.00/mo |
| **Total** | | **< $1/month** |

---

## 11. Acceptance Criteria

1. `adopting_sessions` completes in < 100ms on every Container start
2. Bead state survives Container restart — molecules in progress resume correctly
3. All `beads.Store` interface methods pass existing test suite with `DoStore`
4. No Dolt binary in Container image
5. R2 push loop no longer needed (DO storage is inherently persistent)

---

## 12. Non-Goals

- Migrating historical bead data from bd/Dolt to DO (start fresh — in-flight molecules are short-lived)
- Multi-city DO sharing (one DO per city, isolated)
- Replacing the DO with D1 (D1 adds network hop + eventual consistency; DO SQLite is synchronous and local)
