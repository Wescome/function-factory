# Durable Object Store Architecture

Date: 2026-05-31
Status: Approved — Architect reviewed 2026-05-31
Scope: Replace bd/Dolt bead store AND ArangoDB artifact store with a single Cloudflare Durable Object, one SQLite database, cross-boundary foreign keys between execution plane (beads) and knowledge plane (artifacts)
Repos: `Wescome/gascity` (branch: `factory`) + `function-factory/workers/gascity-supervisor/`

> **This is a single self-contained implementation spec.** A coding agent reading
> only this file has everything needed to build WP-DO-1 through WP-DO-5. No other
> document is required. All collection inventory, complete SQL DDL, the Go and
> TypeScript interfaces, migration phases, acceptance criteria, and invariants are
> contained here.

---

## 1. Problem Statement

The current `bd`/Dolt bead store runs inside the Gas City Container on an ephemeral filesystem. This causes:
- **Adoption hang** — Dolt cold-starts under contention, blocking `adopting_sessions` indefinitely
- **State loss** — Container restart wipes all bead state (molecules, steps, metadata)
- **Startup complexity** — adoption barrier, per-op timeouts, aggregate deadlines, all compensating for Dolt cold-start

These are symptoms of one root cause: stateful storage inside a stateless Container.

Separately, Factory artifacts (specifications, verdicts, lineage edges, Gas City
completion/fidelity records, etc.) live in ArangoDB (the `ff-arango` Worker +
Container, formerly ArangoDB Oasis). This is a second external store with its own
cold-start, its own operational surface, and no structural link to the bead
(execution) plane. Execution trace and knowledge trace are two disconnected
systems joined only by convention.

This spec retires **both** stores into one Cloudflare Durable Object.

## 2. Solution

One Cloudflare Durable Object, one SQLite database, two table namespaces:

- **Execution plane** (`beads`, `deps`) — Gas City operational state
- **Knowledge plane** (`specifications`, `verdicts`, `lineage_edges`, etc.) — Factory artifact store, replaces ArangoDB

One DO instance keyed by city name. One `ctx.storage.sql`. Real SQLite foreign keys cross the boundary — every Factory artifact references the bead that produced it. Zero external services. Zero `ctx.storage.sql2` (CF DO exposes one SQLite per DO instance).

## 3. Architecture

```
Gas City Container (stateless)          ff-pipeline Worker
    │                                       │
    │  HTTP (Worker proxy)                  │  Service Binding → /artifacts/*
    │                                       │
    └──────────────► gascity-supervisor Worker ◄──────────
                              │
                              │  DO binding (FACTORY_STORE)
                              ▼
                     FactoryStore DO
                     └── SQLite (one DB, two namespaces)
                         ├── execution plane: beads, deps
                         └── knowledge plane: specifications, verdicts,
                                              lineage_edges, completion_events,
                                              fidelity_verdicts, dispatch_log,
                                              specs_functions, ...
                                              (FKs → beads.id)
```

The DO exposes two route namespaces — `/beads/*` and `/artifacts/*` — both backed by the same SQLite database. The Go `DoStore` calls `/beads/*` (via the supervisor Worker proxy). The ff-pipeline Worker calls `/artifacts/*` directly via Service Binding.

**Key benefit:** cross-boundary foreign keys are real SQLite constraints — every verdict and lineage edge references the bead that produced it. Execution trace and knowledge trace are structurally linked, not logically inferred.

---

## 4. Collection Inventory

The knowledge plane must hold **all** collections currently in ArangoDB. This is
the complete inventory. Each collection is migrated in priority order:

- **P0** — operational-critical; the Factory cannot run a molecule lifecycle
  without it (Gas City dispatch/completion, core specs, verdicts, lineage).
- **P1** — Factory pipeline collections produced during synthesis/verification.
- **P2** — secondary collections (consultations, candidates, mentor rules, etc.).
- **P3** — telemetry and memory; high volume, low criticality.

### 4.1 Document collections

| Collection | Migration Priority | Notes |
|---|---|---|
| `specifications` | P0 | IS-*, ES-*, PRS-*, BC-*, FP-*, WG-*, PRD-* etc — full validated artifact in `payload` |
| `verification_processes` | P0 | Gate1/Gate2a/Gate2b/Gate3 |
| `verdicts` | P0 | PASS/FAIL/ESCALATE |
| `lineage_edges` | P0 | 430+ edges, replaces all Arango edge collections (typed by `edge_kind`) |
| `completion_events` | P0 | Gas City — `bead_id` unique index, `fn_id`, `factory_attempt` |
| `fidelity_verdicts` | P0 | Gas City — `bead_id`, `function_id`, `overall` |
| `dispatch_log` | P0 | Gas City dispatch events |
| `specs_functions` | P0 | FN-* with `state` field for Gas City dispatch (drives autonomy monitor) |
| `run_envelopes` | P1 | FF-RUN-ARTIFACT-SPEC |
| `divergences` | P1 | |
| `hypotheses` | P1 | |
| `function_proposals` | P1 | FP-* |
| `workgraphs` | P1 | WG-* |
| `pressures` | P1 | PRS-* |
| `capabilities` | P1 | BC-* |
| `prds` | P1 | PRD-* |
| `invariants` | P1 | |
| `merge_readiness_packs` | P1 | MRP — complex prEvidence/ciEvidence in `payload` |
| `specs_signals` | P1 | SIG-* external signals |
| `completion_ledgers` | P1 | keyed by `executableSpecificationId` |
| `consultation_requests` | P2 | CRP-* |
| `candidate_sets` | P2 | |
| `elucidation_artifacts` | P2 | |
| `crps` | P2 | |
| `vcrs` | P2 | |
| `mrps` | P2 | legacy MRP collection (distinct from `merge_readiness_packs`) |
| `mentor_rules` | P2 | `status="active"`, rule text |
| `agents` | P2 | |
| `assurance_graph` | P2 | |
| `specs_incidents` | P2 | INC-* |
| `memory_entries` | P3 | semantic/episodic/curated |
| `orl_telemetry` | P3 | operational metrics |

### 4.2 Edge collections collapsed into `lineage_edges`

All Arango edge collections collapse into the single `lineage_edges` table, typed
by the `edge_kind` column:

- `lineage_edges` — `edge_kind ∈ { "materialized-from", "produced_by", "verified_by", "derived_from", "spec_to_verdict", "vp_to_verdict", "candidate_to_elucidate", "amendment_to_hypothesis" }`

One exception is broken out into its own table because it is a state-change log,
not a provenance edge:

- `lifecycle_transitions` — artifact state changes (`draft → accepted → monitored`, etc.). Separate table; see §5.2.

---

## 5. DO Design

### 5.0 One database, two namespaces

```typescript
export class FactoryStore extends DurableObject {
  private db: SqlStorage  // ctx.storage.sql — one SQLite instance
}
```

One `ctx.storage.sql`. Both `/beads/*` and `/artifacts/*` routes operate on `this.db`. Foreign keys across the boundary are real SQLite constraints enforced at write time.

**VACUUM strategy — required, not optional.** SQLite `DELETE` frees pages to a freelist but never shrinks the file. The knowledge plane (artifacts) is append-only and permanent — it grows monotonically. Without vacuum, deleted bead rows keep consuming DO storage ($0.20/GB-month). `PRAGMA auto_vacuum = INCREMENTAL` must be set **before the first `CREATE TABLE`** (cannot be changed after). Periodic `PRAGMA incremental_vacuum` runs on a DO alarm (weekly or when `page_count * page_size > threshold`).

**CF DO SQLite compatibility note:** Confirm `PRAGMA auto_vacuum = INCREMENTAL` is honored by the DO SQLite backend before writing it into WP-DO-1 acceptance criteria — CF may not expose all SQLite PRAGMA tuning. If unavailable, the alarm-driven `incremental_vacuum` pattern is the fallback.

### 5.1 SQLite schema — execution plane (beads)

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

### 5.2 SQLite schema — knowledge plane (artifacts)

Cross-boundary foreign keys on `emission_bead_id` tie every artifact to the bead that produced it. `PRAGMA foreign_keys = ON` enforced on every connection. Execution plane tables (§5.1) must be created **before** these tables in `initSchema()` because every artifact FK references `beads(id)`.

```sql
-- ============================================================
-- P0: Gas City operational collections
-- ============================================================
CREATE TABLE completion_events (
  id               TEXT PRIMARY KEY,
  bead_id          TEXT NOT NULL UNIQUE,
  fn_id            TEXT NOT NULL,
  factory_attempt  INTEGER NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_ce_bead ON completion_events(bead_id);
CREATE INDEX idx_ce_fn   ON completion_events(fn_id);

CREATE TABLE fidelity_verdicts (
  id               TEXT PRIMARY KEY,
  bead_id          TEXT NOT NULL,
  function_id      TEXT NOT NULL,
  overall          TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  produced_at      TEXT NOT NULL,
  payload          TEXT NOT NULL  -- JSON
);
CREATE INDEX idx_fv_bead ON fidelity_verdicts(bead_id);
CREATE INDEX idx_fv_fn   ON fidelity_verdicts(function_id, overall);

CREATE TABLE dispatch_log (
  id               TEXT PRIMARY KEY,
  ep_id            TEXT NOT NULL,
  fn_id            TEXT NOT NULL,
  is_id            TEXT NOT NULL,
  es_id            TEXT NOT NULL,
  form_id          TEXT,
  factory_attempt  INTEGER NOT NULL,
  outcome          TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  dispatched_at    TEXT NOT NULL,
  payload          TEXT NOT NULL  -- JSON
);
CREATE INDEX idx_dl_ep ON dispatch_log(ep_id);
CREATE INDEX idx_dl_fn ON dispatch_log(fn_id);

-- ============================================================
-- P0: Factory specification collections
-- ============================================================
CREATE TABLE specifications (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  payload          TEXT NOT NULL,   -- JSON: full validated artifact
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead that produced this spec
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_spec_kind   ON specifications(kind);
CREATE INDEX idx_spec_status ON specifications(kind, status);

CREATE TABLE verification_processes (
  id               TEXT PRIMARY KEY,
  spec_id          TEXT NOT NULL REFERENCES specifications(id),
  kind             TEXT NOT NULL,   -- "Gate1" | "Gate2a" | "Gate2b" | "Gate3"
  status           TEXT NOT NULL,   -- "pending" | "running" | "complete"
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead that ran this VP
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  payload          TEXT NOT NULL    -- JSON
);
CREATE INDEX idx_vp_spec ON verification_processes(spec_id);

CREATE TABLE verdicts (
  id               TEXT PRIMARY KEY,
  vp_id            TEXT NOT NULL REFERENCES verification_processes(id),
  spec_id          TEXT NOT NULL REFERENCES specifications(id),
  outcome          TEXT NOT NULL,   -- "PASS" | "FAIL" | "ESCALATE"
  coverage_pct     REAL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead that produced this verdict
  produced_at      TEXT NOT NULL,
  payload          TEXT NOT NULL    -- JSON
);
CREATE INDEX idx_verdict_spec ON verdicts(spec_id);
CREATE INDEX idx_verdict_vp   ON verdicts(vp_id);
CREATE INDEX idx_verdict_bead ON verdicts(emission_bead_id);

CREATE TABLE lineage_edges (
  id               TEXT PRIMARY KEY,
  from_id          TEXT NOT NULL,
  from_kind        TEXT NOT NULL,
  to_id            TEXT NOT NULL,
  to_kind          TEXT NOT NULL,
  edge_kind        TEXT NOT NULL,   -- "materialized-from" | "produced_by" | "verified_by" | "derived_from" | "spec_to_verdict" | "vp_to_verdict" | "candidate_to_elucidate" | "amendment_to_hypothesis"
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),  -- bead during which this edge was emitted
  created_at       TEXT NOT NULL,
  source_ref       TEXT             -- original Arango _id for migration traceability
);
CREATE INDEX idx_le_from          ON lineage_edges(from_id);
CREATE INDEX idx_le_to            ON lineage_edges(to_id);
CREATE INDEX idx_le_emission_bead ON lineage_edges(emission_bead_id);

CREATE TABLE lifecycle_transitions (
  id               TEXT PRIMARY KEY,
  from_id          TEXT NOT NULL,   -- artifact that transitioned
  to_state         TEXT NOT NULL,
  from_state       TEXT,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  ts               TEXT NOT NULL
);
CREATE INDEX idx_lt_from ON lifecycle_transitions(from_id);
CREATE INDEX idx_lt_ts   ON lifecycle_transitions(ts);

-- ============================================================
-- P0: Gas City function state (drives autonomy monitor)
-- ============================================================
CREATE TABLE specs_functions (
  id               TEXT PRIMARY KEY,   -- FN-*
  name             TEXT NOT NULL,
  domain           TEXT NOT NULL,
  purpose          TEXT,
  state            TEXT NOT NULL DEFAULT 'draft',  -- "draft" | "accepted" | "monitored"
  status           TEXT NOT NULL DEFAULT 'active', -- "draft" | "active" | "superseded"
  source_refs      TEXT NOT NULL,  -- JSON array
  function_type    TEXT,
  confidence       REAL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  payload          TEXT NOT NULL   -- JSON: full artifact
);
CREATE INDEX idx_fn_state  ON specs_functions(state);
CREATE INDEX idx_fn_domain ON specs_functions(domain, state);

-- ============================================================
-- P1: Factory pipeline collections (all follow same pattern)
-- ============================================================
CREATE TABLE run_envelopes (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  payload          TEXT NOT NULL,   -- JSON
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE divergences (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'divergence',
  payload          TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE hypotheses (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'hypothesis',
  payload          TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE specs_signals (
  id               TEXT PRIMARY KEY,   -- SIG-*
  source           TEXT NOT NULL,
  subtype          TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  source_refs      TEXT NOT NULL,      -- JSON array
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL,
  payload          TEXT NOT NULL       -- JSON: full signal document
);
CREATE INDEX idx_sig_status ON specs_signals(status);
CREATE INDEX idx_sig_source ON specs_signals(source, status);

CREATE TABLE merge_readiness_packs (
  id                TEXT PRIMARY KEY,   -- MRP-*
  proposal_id       TEXT NOT NULL,
  function_id       TEXT NOT NULL,
  es_id             TEXT NOT NULL,
  readiness_verdict TEXT NOT NULL,     -- "ready" | "blocked"
  emission_bead_id  TEXT REFERENCES beads(id),
  created_at        TEXT NOT NULL,
  payload           TEXT NOT NULL      -- JSON: full MRP document
);
CREATE INDEX idx_mrp_fn ON merge_readiness_packs(function_id);

CREATE TABLE completion_ledgers (
  id               TEXT PRIMARY KEY,   -- keyed by executableSpecificationId
  results          TEXT NOT NULL,      -- JSON: atomId → {decision, confidence, ...}
  emission_bead_id TEXT REFERENCES beads(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- ============================================================
-- P2/P3: Generic-pattern collections
-- ============================================================
-- All remaining collections follow this generic pattern. Each gets its own table
-- named after the collection, with:
--   id               TEXT PRIMARY KEY,
--   kind             TEXT NOT NULL,           -- collection-specific discriminator
--   payload          TEXT NOT NULL,           -- JSON: full document
--   agent_id         TEXT NOT NULL,
--   emission_bead_id TEXT REFERENCES beads(id),
--   created_at       TEXT NOT NULL,
--   updated_at       TEXT NOT NULL
--
-- Collections using this generic shape:
--   function_proposals, workgraphs, pressures, capabilities, prds, invariants,
--   consultation_requests, candidate_sets, elucidation_artifacts, crps, vcrs,
--   mrps (legacy), mentor_rules, agents, assurance_graph, specs_incidents,
--   memory_entries, orl_telemetry
--
-- Example (template — repeat per collection):
-- CREATE TABLE function_proposals (
--   id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
--   agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id),
--   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
-- );
```

**`emission_bead_id` semantics:** nullable (artifacts produced outside a molecule execution set it to NULL). When set, it is the exact bead ID at the moment the artifact was emitted — never inferred, never reconstructed.

**`mentor_rules` query note:** the autonomy/governance path queries `mentor_rules WHERE json_extract(payload, '$.status') = 'active'`; if this becomes hot, promote `status` to a top-level indexed column (same lift as the generic-pattern tables above).

### 5.3 DO HTTP API

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

`DELETE /beads/:id` is tombstone-only. Any request mode that attempts a true hard delete must return **409**.

**Artifact routes** (`/artifacts/*`) — called by ff-pipeline Worker directly via Service Binding:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/artifacts/:collection` | Insert document |
| `GET` | `/artifacts/:collection/:id` | Get document |
| `PATCH` | `/artifacts/:collection/:id` | Update document |
| `GET` | `/artifacts/:collection?query=...` | Query collection |
| `POST` | `/artifacts/lineage` | Add lineage edge |
| `GET` | `/artifacts/lineage?from=...&to=...` | Walk lineage |
| `POST` | `/artifacts/tx` | Artifact transaction |

A write to `/artifacts/:collection` with an invalid `emission_bead_id` (no matching bead) fails the SQLite FK check and the route returns **409**. A `payload` write exceeding the 1MB column limit (§5.9) returns **413**.

### 5.5 CTE lineage walk (replaces AQL graph traversal)

The `GET /artifacts/lineage` endpoint supports a recursive CTE walk — benchmark criterion: 10-hop chain < 100ms. SQLite recursive CTEs are natively supported.

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

### 5.6 Query encoding (beads)

The `GET /beads` endpoint accepts a `query` param (JSON-encoded `ListQuery`). The DO translates to SQL. Key query types:

- `ListOpen` → `WHERE status = 'open'` (tombstones and closed beads excluded)
- `Ready` → `WHERE status = 'open' AND issue_type NOT IN (...)` (exclusion list from `readyExcludeTypes`)
- `Children` → `WHERE parent_id = ?`
- `ListByLabel` → `WHERE EXISTS (SELECT 1 FROM json_each(labels) WHERE value = ?)`
- `ListByAssignee` → `WHERE assignee = ? AND status = ?`
- `ListByMetadata` → `WHERE json_extract(metadata, '$.key') = ?` per filter key

### 5.7 ID generation

DO generates IDs sequentially using a SQLite counter: `SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INT)), 0) + 1`. Format: `do-<n>` (e.g. `do-1`, `do-42`). Atomic under SQLite serialization — no races. Both planes share one counter.

### 5.8 Tx implementation

The DO's `POST /tx` endpoint accepts a list of operations and executes them inside a SQLite `BEGIN TRANSACTION / COMMIT`. The Go `DoStore.Tx()` serializes the callback's writes into a batch request. Rollback on any operation failure. The same applies to `POST /artifacts/tx` — one SQLite transaction across artifact writes, including cross-plane writes (an artifact insert plus its `lineage_edges` insert in one atomic unit).

**Tx audit result (2026-05-31): clear.** `beads.Store.Tx` has zero production callers today and the callback surface used in conformance tests is write-only (`Update`, `SetMetadataBatch`, `Close`). There are no read-modify-write patterns to refactor before cutover.

Future guardrail: if new Tx callers are introduced that depend on reads and then writes in the same logical unit, re-run Tx audit and add compare-and-swap/optimistic-locking where needed.

### 5.9 SQLite payload limits

DO SQLite enforces per-row and per-query size limits. Large `payload`, `metadata`, or `description` blobs can hit them.

- **Max row size:** SQLite's theoretical ceiling is ~1GB per row, but CF DO SQLite may enforce a lower limit. Assume **1MB max per column** as a safe working limit until CF documents otherwise.
- **`payload` and `metadata` columns** that may exceed 1MB must be chunked, or stored in R2 with a reference key (the R2 object key) written into the DO row instead of the inline blob. The DO row then carries a pointer, not the payload.
- **`description` text fields:** truncate at 64KB in the API layer before the write reaches SQLite. Truncation happens explicitly in the route handler, never silently inside SQLite.
- A `payload` write that exceeds the 1MB limit returns **413** from the route — never a silent truncation.

---

## 6. Go Implementation (`DoStore`)

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

**Interface coverage:** implements all 21 methods of `beads.Store` by mapping each to the corresponding DO HTTP endpoint. No local state — every call is a round-trip to the DO (through the supervisor Worker proxy, §7).

`WaitForParentProjection` is not part of `beads.Store`; it belongs to optional `ParentProjectionWaiter`. `DoStore` may omit it because SQLite single-writer visibility is immediate (no projection lag), or implement a no-op if compatibility convenience is desired.

**Round-trip latency:** < 1ms (same CF PoP, internal routing). No Dolt cold-start in the bead store path.

---

## 7. City Config

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

## 8. Worker Implementation

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
    this.db.exec(`CREATE TABLE IF NOT EXISTS beads ( ... )`)        // §5.1
    this.db.exec(`CREATE TABLE IF NOT EXISTS deps ( ... )`)         // §5.1
    // Knowledge plane — all collections from §5.2
    this.db.exec(`CREATE TABLE IF NOT EXISTS specifications ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS verification_processes ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS verdicts ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS lineage_edges ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS lifecycle_transitions ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS completion_events ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS fidelity_verdicts ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS dispatch_log ( ... )`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS specs_functions ( ... )`)
    // ... remaining P1/P2/P3 collections
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

### 8.1 ArtifactClient (TypeScript)

The ff-pipeline Worker uses an `ArtifactClient` to talk to the DO's `/artifacts/*`
routes. It **replaces `@factory/arango-client`** for all artifact reads/writes.
Calls go to the FactoryStore DO via the Service Binding.

```typescript
// workers/ff-pipeline/src/artifact-client.ts
// Replaces @factory/arango-client for all artifact reads/writes.
// Calls /artifacts/* routes on FactoryStore DO via Service Binding.

export class ArtifactClient {
  constructor(private stub: DurableObjectStub) {}

  async insert(collection: string, doc: Record<string, unknown>): Promise<void>
  async get<T>(collection: string, id: string): Promise<T | null>
  async patch(collection: string, id: string, fields: Partial<Record<string, unknown>>): Promise<void>
  async query<T>(collection: string, params: Record<string, unknown>): Promise<T[]>
  async addLineageEdge(edge: {
    from_id: string; from_kind: string
    to_id: string; to_kind: string
    edge_kind: string; agent_id: string
    emission_bead_id?: string; source_ref?: string
  }): Promise<void>
  async walkLineage(fromId: string, maxDepth?: number): Promise<LineageEdge[]>
}
```

All methods validate input against Zod schemas before sending (the same Zod schemas the Arango write path validated against — see INV-RETIRE-005). FK violations (invalid `emission_bead_id`) surface as **409** from the DO and are rethrown as `ArtifactFKError`. Payload-too-large surfaces as **413** and is rethrown as `ArtifactTooLargeError`.

---

## 9. Migration Path (provider switch)

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

## 10. Migration Phases (ArangoDB → DO)

Section 9 covers the bead-store provider switch. This section covers the parallel,
data-bearing migration of the **knowledge plane** out of ArangoDB and into the DO.
Adapted from the original retirement spec for the DO target (not Dolt). Each phase
ends with a verification process that must pass before the next phase begins
(INV-RETIRE-004).

**Phase 0 — DO infrastructure (WP-DO-1 + WP-DO-2 + WP-DO-3 + WP-DO-4).**
Deploy FactoryStore DO. Initialize schema (all tables from §5.2). Scaffold
`ArtifactClient` (§8.1). Smoke-test: insert one synthetic Verdict row via
`POST /artifacts/verdicts`, read it back via `GET /artifacts/verdicts/:id`, and
assert round-trip equality.
*Verification:* **VP-DO-INFRA-001** — smoke-test round-trip passes.

**Phase 1 — Dual-write P0 collections.**
Every write to Arango also writes to the DO. Arango remains authoritative for
reads. P0 collections: `specifications`, `verification_processes`, `verdicts`,
`lineage_edges`, `completion_events`, `fidelity_verdicts`, `dispatch_log`,
`specs_functions`. A `DualWriteAdapter` wraps the artifact write path: on a DO
write failure it logs the failed write to R2 under
`do-write-failures/<timestamp>.json` and does **NOT** fail the Arango write
(Arango is still authoritative; the DO is shadow).
*Verification:* **VP-DUAL-WRITE-P0-001** — after 24h of dual-write, run a
round-trip check: for each document written to Arango, assert an identical payload
exists in the DO. Zero mismatches.

**Phase 2 — Historical backfill (all collections).**
A one-time migration script reads every Arango collection and inserts each
document into the DO via `POST /artifacts/*`. It preserves original IDs,
timestamps, `agent_id`s, and `source_ref`s on lineage edges (written into the
`source_ref` column for traceability, §5.2).
*Verification:* **VP-BACKFILL-001** — round-trip check passes on all collections;
zero missing lineage edges. Any missing edge triggers an INV-RETIRE-002
escalation to the Architect.

**Phase 3 — Read migration.**
Switch reads collection-by-collection from Arango to the DO, starting with P0.
The Arango write path remains live throughout (still dual-writing).
*Verification:* **VP-READ-MIGRATION-001** — all Workers pass integration tests;
zero new Arango read calls introduced.

**Phase 4 — CTE benchmark (Arango retirement gate).**
Run 5 representative 10-hop lineage chains via `GET /artifacts/lineage` (the CTE
endpoint, §5.5). All 5 must complete in < 100ms.
PASS → proceed to Phase 5. FAIL → retain Arango as a **derived read projection
for lineage only**, refreshed by a 15-minute materialization cron; the DO stays
authoritative for writes.
*Verification:* **VP-CTE-BENCHMARK-001**.

**Phase 5 — Arango retirement (WP-DO-5, conditional on Phase 4 PASS).**
Remove all Arango read/write calls. Remove the `DualWriteAdapter`. Delete the
`ff-arango` Worker and Container. Deprecate `@factory/arango-client`.
*Verification:* **VP-ARANGO-RETIRED-001** — `grep -ri "arangodb" workers/ packages/`
returns zero results (excluding tombstone comments).

---

## 11. Work Packages

### WP-DO-1: FactoryStore DO (TypeScript)
**File:** `workers/gascity-supervisor/src/factory-store-do.ts`
- `FactoryStore` class, one `ctx.storage.sql`, `PRAGMA foreign_keys = ON`
- Execution plane schema (beads, deps) created first
- Knowledge plane schema — **all collections from §5.2** with `emission_bead_id TEXT REFERENCES beads(id)` on every artifact table
- All 14 bead HTTP routes (`/beads/*`, `/deps/*`, `/tx`, `/ping`)
- Artifact HTTP routes (`/artifacts/*`) — insert/get/patch/query/lineage-walk/tx
- CTE lineage walk endpoint (`GET /artifacts/lineage`)
- Single shared Tx endpoint (both planes, one SQLite transaction)
- Sequential ID generation (one counter, both planes share it)
- `PRAGMA auto_vacuum = INCREMENTAL` set before first `CREATE TABLE` (verify CF DO SQLite support)
- DO alarm registered for weekly `PRAGMA incremental_vacuum`

**Acceptance:** FK violation on invalid `emission_bead_id` returns 409; CTE walk completes 10-hop chain in < 100ms; Tx is atomic across both planes; `PRAGMA auto_vacuum` setting confirmed at DB creation; `payload` column writes > 1MB return **413** from the DO route, not a silent truncation.

### WP-DO-2: DoStore Go client
**File:** `internal/beads/dostore.go` in `Wescome/gascity`
- Implement `beads.Store` interface
- All 21 methods → HTTP round-trips
- 10s default timeout per call
- Retry once on 5xx (idempotent reads/writes)

**Acceptance:** `go test ./internal/beads/...` passes with DoStore against a local DO emulator. **Tx conformance test suite:** run the existing `beads.Store` test suite against `DoStore`. All callers that invoke `Tx` must be audited for read-modify-write patterns (per §5.8) before cutover; any read-modify-write caller is refactored to compare-and-swap / optimistic locking first.

### WP-DO-3: Config wiring
**Files:** `internal/config/`, `cmd/gc/city_runtime.go`
- Add `provider = "do"` to city config parser
- Add `[beads.do]` block: `url_env`, `token_env`
- Wire `NewDoStore` in store factory

**Acceptance:** `city.toml` with `provider = "do"` starts a city using DoStore.

### WP-DO-4: Worker binding + deploy
**Files:** `workers/gascity-supervisor/src/index.ts`, `wrangler.jsonc`, `workers/ff-pipeline/wrangler.jsonc`, `workers/ff-pipeline/src/artifact-client.ts`
- Add `FactoryStore` DO binding to gascity-supervisor
- Add internal proxy route `GET/POST /internal/bead-store/:city/*` to gascity-supervisor — resolves the DO stub via `env.FACTORY_STORE.get(env.FACTORY_STORE.idFromName(city))`, validates the `GC_SUPERVISOR_TOKEN` bearer, and forwards the request to the DO (Container cannot call the DO directly)
- Inject `GC_BEAD_STORE_URL = https://gascity-supervisor.koales.workers.dev/internal/bead-store/<city>` (the Worker URL prefix, NOT a DO object ID) into Container env
- Add Service Binding from ff-pipeline → gascity-supervisor for `/artifacts/*` access
- Scaffold `ArtifactClient` (§8.1) in ff-pipeline
- Add DO migration tag
- Replace `createClientFromEnv(env)` (ArangoDB) in ff-pipeline with the `ArtifactClient`

**Acceptance:** `wrangler deploy` succeeds on both Workers. ff-pipeline reads/writes artifacts via the DO `ArtifactClient`. Container reads/writes beads via DO. Synthetic Verdict round-trip (VP-DO-INFRA-001) passes.

### WP-DO-5: Switch + cleanup
- Set `factory/city.toml` to `provider = "do"`
- Migrate existing ArangoDB documents → DO artifact routes (one-time backfill script, Phase 2)
- Remove ArangoDB (`ff-arango` Worker + Container) — ff-pipeline no longer references it
- Gut the Dolt cold-start waiting logic in `cmd/gc/adoption_barrier.go`. Retain any session consistency checks that are not Dolt-specific. Do **not** remove the adoption phase from the startup FSM — remove only the Dolt-dependent blocking operations within it.
- Remove Dolt + bd from Dockerfile
- Update `entrypoint.sh` (no Dolt identity setup needed)
- Remove `@factory/arango-client` usages from ff-pipeline

**Acceptance:** Container image ~40MB smaller. Adoption phase remains in startup FSM but Dolt-specific blocking logic is removed. `adopting_sessions` phase completes in < 100ms. Zero ArangoDB references in codebase (VP-ARANGO-RETIRED-001). ff-arango Worker deleted.

---

## 12. Cost

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

**Storage ceiling.** CF DO has a **10GB per-DO storage ceiling on the paid plan**. At current artifact volume this is not a near-term risk, but it must be monitored — one DO per city means a single city's combined execution + knowledge plane cannot exceed 10GB without a sharding redesign (see G2 throughput watch in §15).

**VACUUM affects billing.** The VACUUM strategy (§5.0) directly affects storage billing: without incremental vacuum, deleted bead rows keep consuming the $0.20/GB-month storage charge and count against the 10GB ceiling. The append-only knowledge plane already grows monotonically; reclaiming freed execution-plane pages is the only lever on storage growth.

---

## 13. Acceptance Criteria

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
11. Every collection in the §4 inventory has a DO table and passes a round-trip check (VP-BACKFILL-001)
12. Every migration phase (§10) produced a passing verification process before the next phase started (INV-RETIRE-004)

---

## 14. Non-Goals

- Migrating historical bead data from bd/Dolt to DO (start fresh — in-flight molecules are short-lived; this is distinct from the **artifact** backfill in §10 Phase 2, which IS in scope)
- Multi-city DO sharing (one DO per city, isolated)
- Replacing the DO with D1 (D1 adds network hop + eventual consistency; DO SQLite is synchronous and local)
- DoltHub (never provisioned — DO is the target for both beads and artifacts)
- Splitting into two SQLite instances (CF DO exposes one `ctx.storage.sql`; two instances would break cross-boundary FK enforcement — see G2 escape hatch in §15)

---

## 15. Architectural Guardrails (Architect review 2026-05-31)

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

---

## 16. Invariants

These invariants govern the ArangoDB → DO migration. They are adapted for the DO
target and carry the force of the Factory's standing rules: a coding agent must
not violate them, and a violation is a blocking error, not a warning.

**INV-RETIRE-001 — Fail-closed migration.**
Until a collection's data has been verified round-trip in the DO (hash
comparison), the corresponding Arango collection remains live and writable. New
writes go to both substrates in dual-write mode. Never cut over reads before the
round-trip check passes.

**INV-RETIRE-002 — Lineage never reconstructed.**
If a lineage edge cannot be migrated with its original `source_ref`, `agent_id`,
and `created_at` intact, it is escalated to the Architect — never silently dropped
or approximated.

**INV-RETIRE-003 — Arango retirement is gate-locked.**
The final Arango collection is set read-only only after the CTE benchmark
(WP-DO-1 acceptance §11.7 / §10 Phase 4 — 10-hop < 100ms) produces a PASS verdict.
A benchmark miss keeps Arango as a derived read projection.

**INV-RETIRE-004 — Every migration phase produces a verdict.**
Each phase (and each WP) closes with a verification process that confirms the
phase is complete before the next begins. No phase starts without the prior phase
confirmed.

**INV-RETIRE-005 — No schema drift across substrates.**
During dual-write (§10 Phase 1), the DO write path validates against the same Zod
schemas as the Arango write path. Schema divergence between substrates is a
blocking error.
