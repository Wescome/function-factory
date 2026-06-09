# Tessera on Cloudflare — Production Architecture Spec

**Spec ID:** TESSERA-CF-DO-SPEC
**Version:** v0.2
**Date:** 2026-05-31
**Status:** Draft — Architect rewrite of v0.1 after gap review (19 gaps: 5 critical, 9 high, 5 medium)
**Scope:** Full cloud-native Tessera. Zero local dependency. GitHub push triggers indexing; agents query from anywhere via MCP.
**Reference rigor:** Matches `DO-BEAD-STORE-ARCHITECTURE.md` (VACUUM, FK enforcement, payload limits, row-level billing, 10GB ceiling, shard triggers, migration gates).

> **This is a single self-contained implementation spec.** A coding agent reading
> only this file has everything needed to build WP-T1 through WP-T6. Every
> architectural claim cites the ground-truth source it was derived from. Ground
> truth is the live Tessera codebase at `Wescome/tessera`, not the v0.1 draft.

### Ground-truth sources (all claims trace here)

| Tag | File | What it proves |
|-----|------|----------------|
| **GT-IMPACT** | `tessera/src/mcp/local/local-backend.ts:2548–2970` | Real impact = **breadth-first traversal in application code**, not a single recursive CTE. Upstream/downstream queries, Class/Interface seeding, risk thresholds. |
| **GT-CONF** | `tessera/src/mcp/local/local-backend.ts:124–155` | `IMPACT_RELATION_CONFIDENCE` floors per relation type; fallback 0.5. |
| **GT-RELSET** | `tessera/src/mcp/local/local-backend.ts:105–122`, `tessera-shared/src/lbug/schema-constants.ts` | `VALID_RELATION_TYPES`, 20 `REL_TYPES`, single `CodeRelation` rel table. |
| **GT-SCHEMA** | `tessera/src/core/lbug/schema.ts`, `tessera-shared/src/lbug/schema-constants.ts` | 31 node tables, one `CodeRelation` rel table, `CodeEmbedding` FLOAT[384] table, content column on Function/Class/Method/etc. |
| **GT-CTX480** | `tessera/src/mcp/local/local-backend.ts:1724–1800` | Class/Interface have **no direct** CALLS/IMPORTS edges — they point at Constructor (via HAS_METHOD) and File (via DEFINES). BFS seeding fix #480. |
| **GT-SEARCH** | `tessera/src/core/search/hybrid-search.ts` | BM25 (LadybugDB FTS) + semantic merged via **RRF, K=60**. Semantic is optional; FTS always available. |
| **GT-EMBED** | `tessera/src/core/embeddings/embedder.ts`, `http-client.ts` | Native `onnxruntime-node` + `@huggingface/transformers`, snowflake-arctic-embed-xs, **384-dim**. Already has an **OpenAI-compatible HTTP `/v1/embeddings` escape hatch** (`TESSERA_EMBEDDING_URL`/`_MODEL`/`_DIMS`). |
| **GT-TOOLS** | `tessera/src/mcp/tools.ts` | The real **13-tool** MCP surface (not 6). |
| **GT-XREPO** | `tessera/src/core/group/cross-impact.ts`, `bridge-schema.ts`, `bridge-db.ts` | Cross-repo bridge already exists: separate LadybugDB, `Contract` nodes, `ContractLink` edges, `MAX_SUPPORTED_CROSS_DEPTH = 1`, two-phase (local walk + bridge fan-out). |
| **GT-DOBEAD** | `function-factory/specs/reference/DO-BEAD-STORE-ARCHITECTURE.md` | Reference rigor: VACUUM, FK, 1MB column limit, 10GB ceiling, shard trigger p95 > 50ms, row-level billing. |

---

## 1. Problem Statement

Tessera runs on a developer's machine. Consequences:

- ff-pipeline Workers and GasCity Containers cannot reach it — they run in Cloudflare, Tessera runs on `localhost:4747`.
- The index is personal — only the machine that ran `tessera analyze` holds it.
- Autonomous agents have no graph intelligence (no impact analysis before edits).
- Index freshness depends on a human remembering to re-run `analyze`.

**Root cause:** stateful intelligence inside a stateless developer environment — the same root cause the bead store spec (GT-DOBEAD §1) identified.

**The fix:** move persistent, queryable graph state into a Cloudflare Durable Object. Trigger indexing from git events, not from a human CLI call.

**What v0.1 got wrong (this rewrite corrects):**
1. Modeled impact as one recursive SQL CTE. The real engine (GT-IMPACT) is an **application-level BFS** with Class/Interface seeding and per-relation confidence. A single CTE cannot reproduce it.
2. Assumed tree-sitter and onnxruntime "just run" on Workers. Native `onnxruntime-node` (GT-EMBED) **cannot** run on Workers — it dlopens `.node`/`.so`. tree-sitter-wasm has a **different async API** than the native binding.
3. Listed 6 MCP tools. There are **13** (GT-TOOLS), including a **write** tool (`rename`) that a read-only DO cannot serve.
4. Assumed gascity indexes in one 30s Worker invocation. At ~78k nodes / ~277k edges this is false and dangerous — and it implies a row-write cost (§11) that v0.1 never modeled.
5. Treated incremental indexing as V1 while also saying "full rebuild on first index" — a contradiction. V1 is **full rebuild on every push** (§4, H7).

---

## 2. Use Cases (from 2026-05-31 session)

Every Tessera operation performed this session — production requirements.

| # | Use Case | Tool (GT-TOOLS) | Called By | Frequency |
|---|----------|-----------------|-----------|-----------|
| UC-1 | Impact analysis before editing a symbol | `impact` | Agent, human | Every edit |
| UC-2 | Hybrid (BM25 + semantic) query for concepts | `query` | Agent, human | Every research task |
| UC-3 | 360° view of a symbol | `context` | Agent, human | Every unfamiliar symbol |
| UC-4 | Cross-repo contract validation | `impact` (`@group`), `group_*` | Agent, human | Architecture review |
| UC-5 | Raw graph query (Cypher) | `cypher` | Human | Exploration |
| UC-6 | Uncommitted-change impact | `detect_changes` | Agent, CI | Pre-commit |
| UC-7 | MCP protocol access | all tools | Agent (Claude Code, GasCity) | Primary interface |
| UC-8 | List indexed repos + stats | `list_repos` | Human, CI | Ops |
| UC-9 | API route / shape analysis | `route_map`, `shape_check`, `api_impact` | Agent, human | Web-repo edits |
| UC-10 | Multi-file coordinated rename (**write**) | `rename` | Human, agent | Refactor |

**The critical path is UC-1 and UC-7.** Agents must run impact analysis before any symbol edit, via MCP, from inside a CF Worker or Container. UC-10 (`rename`) is the only **write** use case and demands a separate architecture (§8.4, C5).

---

## 3. Architecture

```
GitHub
  │  push webhook (HMAC)
  ▼
Tessera Worker (tessera.koales.workers.dev)
  │
  ├── POST /webhook/github
  │       └─ validate HMAC, resolve repo → DO,
  │          call IndexerCoordinator.startOrDebounce(repo, ref, commit)
  │
  ├── IndexerCoordinator DO (one per repo)              ◄── §4
  │       state machine: IDLE → DEBOUNCE → FETCHING →
  │                       PARSING → COMMITTING → DONE | FAILED
  │       persisted cursor (file manifest + offset)
  │       alarm-driven batches (no single 30s invocation)
  │       debounce: ≤ 1 index per ref per 10 min (§11, H9)
  │          │  staged ingest (start/nodes/edges/commit/abort)
  │          ▼
  ├── TesseraStore DO (one per repo)                    ◄── §5
  │       ctx.storage.sql (one SQLite DB)
  │       PRAGMA auto_vacuum = INCREMENTAL (pre-CREATE)
  │       ├── nodes        (NO inline content — offsets only, H8)
  │       ├── edges        (CodeRelation flattened: type, confidence, step)
  │       ├── communities  (V2)
  │       ├── processes
  │       ├── nodes_fts    (FTS5 — BM25)
  │       ├── embeddings   (V2 only — see §7 C3/C4)
  │       └── meta
  │
  ├── POST /mcp ──► MCP JSON-RPC handler (13 tools, §8)
  │
  ├── Installation-Token Cache DO (or KV)               ◄── §9 H6
  │       GitHub App installation token, ~55-min TTL
  │
  ├── R2: tessera-grammars  (tree-sitter WASM grammars, §4.6)
  ├── R2: tessera-archives  (per-commit source archive; content fetched on demand, H8)
  └── (V2) Bridge DO        (cross-repo Contract/ContractLink, §8 M3)

Callers:
  ff-pipeline Worker ──► Tessera Worker (CF service binding)
  GasCity Container ───► gascity-supervisor /internal/tessera/* ──► Tessera Worker (binding)
  Claude Code (MCP) ───► Tessera Worker (HTTPS, MCP protocol)
  CI / GitHub Actions ─► Tessera Worker (HTTPS)
```

**Two DO classes, one per repo each.** `TesseraStore` holds the queryable graph. `IndexerCoordinator` owns the indexing state machine and the debounce window. Keeping them separate means a long-running index never blocks a query (independent write serialization — same reasoning as GT-DOBEAD §15 G2).

---

## 4. Indexing Pipeline

### 4.1 V1 indexing policy: full rebuild on every push (H7)

**Decision (removes the v0.1 contradiction):** V1 performs a **full re-index on every push** to a watched ref. No incremental delta merge in V1. The TesseraStore swaps a freshly built graph atomically (`/ingest/commit`, §5.5). Incremental indexing is **V2** with the delta-merge algorithm specified in §4.7.

Rationale: incremental indexing requires re-running community detection and process detection over the merged graph anyway (those are global algorithms), and correct delta merge needs stable node identity across commits. V1 buys correctness and simplicity; §11 shows the cost is bounded once debounce (H9) is in place.

### 4.2 Trigger: GitHub webhook

`POST /webhook/github` receives `push` events. Validates HMAC SHA-256 (`X-Hub-Signature-256`) against `TESSERA_PUSH_SECRET`. On valid `push` to a watched ref:

```typescript
interface IndexJob {
  repo: string          // "Wescome/gascity"
  ref: string           // "refs/heads/main"
  commit: string        // full 40-char SHA
  installationId: number
}
```

The Worker resolves `env.INDEXER.idFromName(repo)` and calls `IndexerCoordinator.startOrDebounce(job)`. **No CF Queue in V1** — the IndexerCoordinator DO *is* the durable work queue and the debounce gate. (v0.1's `IndexQueue` is removed; a DO alarm loop is the correct primitive because indexing is per-repo serial and must be debounced, not fanned out.)

### 4.3 IndexerCoordinator DO — state machine (H3)

One IndexerCoordinator per repo (`idFromName(repo)`). This is the critical path for gascity (2,164 files, 77,979 nodes, 276,625 edges). It never relies on a single 30s Worker invocation (H4); it advances by alarm ticks.

**States** (persisted in `ctx.storage`):

```
IDLE ──startOrDebounce──► DEBOUNCE ──(debounce window elapsed)──► FETCHING
DEBOUNCE ──(newer push for same ref)──► DEBOUNCE (coalesce; keep newest commit)
FETCHING ──(archive in R2)──► PARSING
PARSING  ──(alarm tick parses N files, streams to TesseraStore)──► PARSING
PARSING  ──(manifest exhausted)──► COMMITTING
COMMITTING ──(TesseraStore /ingest/commit OK)──► DONE ──► IDLE
any ──(error, retries left)──► retry same state (alarm backoff)
any ──(retries exhausted)──► FAILED (DLQ row) ──► IDLE
ABORT requested ──► call /ingest/abort, clear cursor ──► IDLE
```

**Persisted coordinator state:**

```typescript
interface CoordinatorState {
  status: 'IDLE' | 'DEBOUNCE' | 'FETCHING' | 'PARSING' | 'COMMITTING' | 'FAILED'
  repo: string
  ref: string
  commit: string              // commit being indexed (newest coalesced)
  installationId: number
  debounceUntil: number       // epoch ms; alarm fires at this time (H9)
  lastIndexedAt: number       // epoch ms of last successful commit, per ref
  archiveKey: string | null   // R2 key once fetched: archives/<repo>/<commit>.tar.gz
  manifest: string[]          // ordered list of source file paths to parse
  cursor: number              // index into manifest of next file to parse (PARSING)
  batchSize: number           // files per alarm tick (default 150; tuned §4.4)
  attempt: number             // retry counter for current state
  lockHeld: boolean           // per-repo ingest lock (H2)
}
```

**Idempotency + lock (H2):**
- `startOrDebounce(job)` is **idempotent per commit**. If `status !== 'IDLE'` and a push arrives:
  - same `ref`, newer `commit` → coalesce: update `commit`/`installationId`, reset `debounceUntil = now + 10min`, stay in DEBOUNCE; if already past DEBOUNCE, set a `pendingCommit` and let the in-flight run finish, then immediately re-debounce the pending one.
  - same `ref`, same `commit` already DONE within debounce window → no-op.
- **Per-repo ingest lock:** `lockHeld` guards FETCHING→COMMITTING. A second `startOrDebounce` cannot enter FETCHING while the lock is held; it parks in `pendingCommit`. The lock is the IndexerCoordinator's single-writer guarantee (one index per repo at a time).
- On entry to FETCHING, the coordinator calls `TesseraStore POST /ingest/start { commit }`, which **truncates any prior staging rows for the same commit** (idempotent restart after a crash mid-parse — re-running PARSING from `cursor` is safe because staging for this commit is owned exclusively by this run).

**Crash recovery (H2):** All state lives in `ctx.storage`. On DO eviction/restart mid-PARSING, the next alarm resumes from `cursor`. If the coordinator was killed between alarms, the **stale-staging reaper** (below) bounds the blast radius.

**Stale-staging reaper (H2):** A separate maintenance alarm (registered at DO init, fires hourly) checks: if `status ∈ {FETCHING, PARSING, COMMITTING}` and `now - stateEnteredAt > 2h` (TTL), the run is declared stale: call `/ingest/abort`, write a DLQ row (below), release the lock, return to IDLE. This prevents a wedged ingest from holding the lock forever.

**DLQ (H2):** Exhausted retries (`attempt > maxAttempts`, default 5, exponential backoff 30s→8m) write to a `dlq` table in the coordinator's own `ctx.storage.sql`:

```sql
CREATE TABLE dlq (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo        TEXT NOT NULL,
  ref         TEXT NOT NULL,
  commit_sha  TEXT NOT NULL,
  failed_state TEXT NOT NULL,
  error       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```
DLQ rows are surfaced via `GET /repos/:repo/index-status` for ops (UC-8). A DLQ entry never auto-retries; an operator re-triggers via `POST /repos/:repo/reindex`.

**Abort path (H2):** `POST /repos/:repo/reindex/abort` sets an abort flag the next alarm observes → `/ingest/abort`, clear cursor/manifest/archiveKey, release lock, IDLE.

### 4.4 Per-alarm batch loop (H3, H4)

Each PARSING alarm tick:

1. Load `CoordinatorState`. Take `manifest.slice(cursor, cursor + batchSize)`.
2. For each file in the slice: fetch its bytes from the R2 archive (range read or per-file object, §4.6), run the **parser-layer port** (§4.5), extract nodes + intra-file edges.
3. Accumulate, then stream to TesseraStore: `POST /ingest/nodes` (≤ 1,000 nodes/request) and `POST /ingest/edges` (≤ 5,000 edges/request). Cross-file edges that cannot resolve within this batch are buffered as **unresolved-reference rows** in staging and resolved at COMMITTING (§4.5 step 3).
4. `cursor += batchSize`. If `cursor >= manifest.length` → COMMITTING; else schedule next alarm immediately (`storage.setAlarm(Date.now())`).
5. Wrap each tick in a wall-clock budget (`MAX_TICK_MS = 20_000`, under the 30s CPU ceiling). If a tick approaches budget before the slice completes, persist partial `cursor` and yield (set alarm now). `batchSize` is adaptive: if a tick used < 10s, raise `batchSize` by 25% (cap 400); if it exceeded budget, halve it (floor 25).

**gascity sizing (H3):** 2,164 files at `batchSize=150` ≈ 15 ticks for parse, plus FETCHING + COMMITTING. Streaming 77,979 nodes at 1,000/request ≈ 78 ingest calls; 276,625 edges at 5,000/request ≈ 56 calls. End-to-end target < 5 min wall clock (alarms fire back-to-back).

### 4.5 Graph construction (parser-layer port, H4/H5 — see WP-T2)

The core ingestion pipeline in `tessera/src/core/ingestion/` is language-agnostic by contract (CLAUDE.md: shared pipeline must not name languages; uses `LanguageProvider` hooks). WP-T2 ports the **parser layer only** — the `LanguageProvider` that wraps tree-sitter — from native bindings to WASM.

1. **Entity extraction** per file → nodes (Function, Class, Interface, Method, Struct, …; 31 node kinds, GT-SCHEMA). Each node stores `start_line`/`end_line` and offsets, **not** the source body (H8, §5).
2. **Intra-file relations** resolved during parse (DEFINES, HAS_METHOD, HAS_PROPERTY).
3. **Cross-file relation resolution** (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) at COMMITTING, once all symbols are staged: resolve unresolved-reference rows against the full staged symbol table, emit `CodeRelation` rows with `type`, `confidence`, `step` (GT-RELSET/GT-SCHEMA).
4. **Community detection** — Leiden. **V1: skipped** (Open Question Q1; not required for UC-1/3/5). **V2.**
5. **Process / execution-flow detection** — graph algorithm, no native dep. Runs on the staged graph at COMMITTING. **V2** (Q2). Until then, impact's process-enrichment block (GT-IMPACT process queries) returns empty `affected_processes` — risk scoring degrades gracefully to depth/module signals.

### 4.6 Source archive handling (H6)

`IndexerCoordinator` FETCHING state:
- GitHub App token from the **Installation-Token Cache DO** (§9). Never minted per-file.
- `GET https://api.github.com/repos/:owner/:repo/tarball/:ref` → **follow the 302 redirect** to `codeload.github.com`.
- **Stream** the `.tar.gz` (do not buffer the whole archive in memory — Workers have ~128MB). Decompress and write each source file as an individual R2 object `archives/<repo>/<commit>/<path>` (so per-file random access during PARSING and on-demand content fetch later, H8).
- **Cap the archive at 500MB**; abort with a DLQ entry if exceeded (parity with GT-DOBEAD payload discipline).
- Binary / non-source files (by extension allowlist from the LanguageProvider) are skipped, not stored.

**Rate-limit budget (H6):** one tarball fetch per index per repo. Installation token cached ~55-min TTL (GitHub installation tokens live 60 min). At debounce ≤ 1 index/ref/10min and ~20 pushes/day/repo coalesced down, archive fetches stay well under GitHub's 5,000 req/hr/installation. Token mint calls ≈ 1/hr/installation.

### 4.7 Incremental indexing (V2 — specified, not built in V1, H7)

V2 delta-merge algorithm (documented now so V1 doesn't paint into a corner):
1. From the push payload, get changed file paths (`added`/`modified`/`removed`).
2. For `removed`+`modified`: delete all nodes whose `file_path` matches, cascade-delete their edges (FK `ON DELETE CASCADE`, §5).
3. For `added`+`modified`: parse those files, insert nodes/intra-file edges.
4. Re-resolve cross-file edges **touching** changed symbols only (incoming and outgoing).
5. Re-run community + process detection on the **full** merged graph (these are global; no correct partial form). This is why V2, not V1.
6. Atomic swap as in §5.5.

---

## 5. TesseraStore DO

One `TesseraStore` per repo, one `ctx.storage.sql`. Co-located with compute, synchronous, durable (GT-DOBEAD §14 rationale for DO SQLite over D1).

### 5.1 VACUUM + PRAGMA (H8, parity GT-DOBEAD §5.0)

```typescript
constructor(ctx, env) {
  super(ctx, env)
  this.db = ctx.storage.sql
  // MUST run before the first CREATE TABLE — cannot be changed after.
  this.db.exec('PRAGMA auto_vacuum = INCREMENTAL')
  this.db.exec('PRAGMA foreign_keys = ON')
  this.initSchema()
}
```

The live graph is **replaced** on every commit (full rebuild, §4.1), so the staging→live swap frees large page ranges every push. Without incremental vacuum the file never shrinks and storage billing (§11) climbs on a repo that is logically constant-size. A DO alarm runs `PRAGMA incremental_vacuum` after each successful `/ingest/commit` and weekly as a backstop.

**CF DO SQLite compatibility note (carry into WP-T1 acceptance):** confirm `PRAGMA auto_vacuum = INCREMENTAL` is honored by the DO SQLite backend before relying on it. If unsupported, the fallback is to rebuild the live tables in place (`DELETE` + `INSERT` inside one transaction) and run a periodic full `VACUUM` on the maintenance alarm. Same open compatibility caveat as GT-DOBEAD §5.0.

### 5.2 Schema — nodes (NO inline content, H8)

The CLI graph stores full source `content` on Function/Class/Method/etc. (GT-SCHEMA). **The DO must not.** Storing function bodies inline blows the 1MB-per-column working limit (GT-DOBEAD §5.9) and inflates row-write billing. Store the **offset range only**; fetch the body from the R2 archive on demand.

```sql
CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,          -- stable UID from analysis
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,             -- one of 31 node kinds (GT-SCHEMA)
  file_path  TEXT,
  start_line INTEGER,
  end_line   INTEGER,
  -- NO content column. Body lives in R2: archives/<repo>/<commit>/<file_path>,
  -- sliced [start_line, end_line] on demand (context include_content, GT-CTX480).
  module     TEXT,                      -- functional area label (community), nullable in V1
  is_exported INTEGER,
  properties TEXT                       -- JSON: returnType, parameterCount, etc. — capped 64KB
);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_kind ON nodes(kind);
CREATE INDEX idx_nodes_file ON nodes(file_path);
CREATE INDEX idx_nodes_name_kind ON nodes(name, kind);   -- disambiguation (GT-IMPACT resolver)
```

`properties` JSON > 64KB is truncated in the route handler before the write (never silently inside SQLite), parity GT-DOBEAD §5.9. A single oversize property write returns **413**.

### 5.3 Schema — edges (CodeRelation flattened)

The CLI uses one `CodeRelation` rel table with `type`/`confidence`/`reason`/`step` (GT-SCHEMA, GT-RELSET). Flatten it to a SQLite edge table:

```sql
CREATE TABLE edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,             -- one of 20 REL_TYPES (GT-RELSET)
  confidence REAL,                      -- stored value from analysis; floors applied at query (§6.4)
  reason     TEXT,                      -- e.g. ACCESSES reason 'read'|'write'
  step       INTEGER                    -- STEP_IN_PROCESS ordering
);
CREATE INDEX idx_edges_source       ON edges(source_id);
CREATE INDEX idx_edges_target       ON edges(target_id);   -- REQUIRED for upstream traversal (§6.1)
CREATE INDEX idx_edges_type         ON edges(type);
CREATE INDEX idx_edges_target_type  ON edges(target_id, type);  -- upstream BFS hot path
CREATE INDEX idx_edges_source_type  ON edges(source_id, type);  -- downstream BFS hot path
```

`ON DELETE CASCADE` makes the V2 delta-merge (§4.7) and full-rebuild swap safe — deleting a node removes its edges without orphans, enforced by `PRAGMA foreign_keys = ON` (parity GT-DOBEAD §5.2 FK discipline).

### 5.4 Schema — processes, FTS, meta

```sql
CREATE TABLE processes (             -- V2 (process detection is V2, §4.5)
  id            TEXT PRIMARY KEY,
  label         TEXT,
  heuristic_label TEXT,
  process_type  TEXT,
  step_count    INTEGER,
  entry_point_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  terminal_id    TEXT REFERENCES nodes(id) ON DELETE SET NULL
);

-- BM25 keyword search (GT-SEARCH). External-content FTS5 over nodes.
-- name + properties only — NO source body (bodies are in R2, H8).
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  name, properties, file_path,
  content=nodes, content_rowid=rowid
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: commit, indexed_at, repo, stats_json, schema_version,
--       semantic_enabled ('false' in V1), node_count, edge_count
```

**embeddings table is V2 only** (§7 C3/C4). When semantic search ships:
```sql
-- V2: dimensions fixed by the chosen Workers AI / HTTP model (§7), NOT 384 unless that model emits 384.
CREATE TABLE embeddings (
  node_id   TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  vec       BLOB NOT NULL,        -- float32 little-endian, length = dims*4
  dims      INTEGER NOT NULL,
  content_hash TEXT
);
```

### 5.5 Staged ingest + atomic swap (full-rebuild, §4.1)

Staging tables mirror live (`nodes_staging`, `edges_staging`). Protocol:
- `POST /ingest/start { commit }` — **truncate** `*_staging` for idempotent restart (H2). Record `commit` in coordinator-owned staging meta.
- `POST /ingest/nodes` — batch ≤ 1,000 rows into `nodes_staging`.
- `POST /ingest/edges` — batch ≤ 5,000 rows into `edges_staging` (unresolved cross-file refs allowed; resolved at commit).
- `POST /ingest/commit` — in ONE SQLite transaction: resolve cross-file edges, `DELETE FROM nodes; DELETE FROM edges; INSERT … SELECT FROM *_staging;` rebuild `nodes_fts`, update `meta`, truncate staging. Then fire the `incremental_vacuum` alarm.
- `DELETE /ingest/abort` — truncate staging, leave live untouched.

The swap is atomic: queries during indexing see the previous commit until `commit` succeeds, then see the new one. No partial graph is ever queryable (parity GT-DOBEAD Tx atomicity §5.8).

### 5.6 HTTP routes

**Ingest (IndexerCoordinator → TesseraStore):** `POST /ingest/start|nodes|edges|commit`, `DELETE /ingest/abort`.

**Query (Worker → TesseraStore):**
```
GET  /meta                 — commit, stats, indexed_at, semantic_enabled
POST /impact               — { target, direction, maxDepth, relationTypes, minConfidence, includeTests }
POST /context              — { name?, uid?, kind?, file_path?, include_content? }
POST /query                — { query, limit }   (BM25; +semantic in V2)
POST /cypher               — { query }           (read-only, see §8 cypher mapping)
POST /detect_changes       — { changedFiles: [{ path, addedLines, removedLines }] }
POST /route_map | /tool_map | /shape_check | /api_impact
```

### 5.7 SQLite limits (H8, parity GT-DOBEAD §5.9)

- **1MB per-column working limit** assumed until CF documents otherwise. `properties` capped 64KB in handler.
- **No inline content** — the single largest source of row bloat is eliminated by design (§5.2).
- **10GB per-DO ceiling** (paid plan). One DO per repo. Monitor `page_count * page_size` on the maintenance alarm; emit to `meta.stats_json`.
- **Shard trigger:** if **p95 write latency > 50ms** under normal ingest, evaluate splitting (§12 G2) — the exact trigger as GT-DOBEAD §15 G2.

---

## 6. Impact Analysis (C1, C2, M1)

> The v0.1 single recursive CTE is **wrong** and is discarded. The real engine (GT-IMPACT, `_runImpactBFS` at local-backend.ts:2548) is an **application-level breadth-first traversal**: it seeds a frontier, expands one depth level per query, dedupes via a `visited` set, applies Class/Interface seeding, and scores risk from direct-count / processes / modules. The DO reproduces this exactly. Two CTEs below are the **per-depth expansion** primitive the BFS calls each level — not a single self-recursive query.

### 6.1 Direction semantics (C1)

**upstream = "what depends on this" = reverse traversal:** find nodes whose edges point **at** the target. **downstream = "what this depends on" = forward traversal.** (GT-IMPACT:2630–2633.)

Per-depth expansion, given a frontier of node ids `$frontier` and a relation set `$rels`:

**Upstream (reverse — callers/importers point AT the frontier):**
```sql
-- Seed level (depth 1): edges whose TARGET is the symbol.
SELECT e.source_id AS node_id, n.name, n.kind, n.file_path,
       e.type AS rel_type, e.confidence
FROM edges e
JOIN nodes n ON n.id = e.source_id
WHERE e.target_id IN (/* $frontier */)
  AND e.type IN (/* $rels */)
  AND (:minConfidence = 0 OR e.confidence >= :minConfidence);
```

**Downstream (forward — what the frontier calls/imports):**
```sql
SELECT e.target_id AS node_id, n.name, n.kind, n.file_path,
       e.type AS rel_type, e.confidence
FROM edges e
JOIN nodes n ON n.id = e.target_id
WHERE e.source_id IN (/* $frontier */)
  AND e.type IN (/* $rels */)
  AND (:minConfidence = 0 OR e.confidence >= :minConfidence);
```

The DO runs this once per depth (`depth = 1..maxDepth`, `maxDepth` clamp 1–32, default 3 — GT-TOOLS impact schema), carrying a `visited: Set<string>` to dedupe and a `nextFrontier` built from newly-seen ids, identical to GT-IMPACT:2625–2675. Default relation set is usage-based with `ACCESSES` excluded (GT-TOOLS:386); the full valid set is in §6.4.

> A single self-recursive CTE *can* compute reachability, but it cannot host the Class/Interface seeding (§6.2) or the per-edge confidence/floor logic (§6.4) the way the BFS does, and it would not match the reference engine's row-by-row dedup/cap behavior. The per-depth-CTE-inside-app-BFS keeps DO behavior bit-identical to local Tessera.

### 6.2 Class / Interface indirection (C2 — port of GT-CTX480 / GT-IMPACT:2580–2623)

**Class and Interface nodes have no direct CALLS/IMPORTS edges.** Callers reference the **Constructor** (reached via `HAS_METHOD`) and the owning **File** (reached via `DEFINES`). If the target resolves to a Class or Interface, **seed the BFS frontier** with the Constructor(s) and owning File *before* depth 1:

```sql
-- Seed 1: constructors of the class (HAS_METHOD), so CALLS edges are found.
SELECT e.target_id AS seed_id
FROM edges e
JOIN nodes c ON c.id = e.target_id AND c.kind = 'Constructor'
WHERE e.source_id = :targetId AND e.type = 'HAS_METHOD';

-- Seed 2: owning file (DEFINES), so IMPORTS edges are found.
SELECT e.source_id AS seed_id
FROM edges e
JOIN nodes f ON f.id = e.source_id AND f.kind = 'File'
WHERE e.target_id = :targetId AND e.type = 'DEFINES';
```

Seeds are added to `frontier` and `visited` but the **File seed is never added to `impacted`** — it is the definition container, not an upstream dependent (GT-IMPACT:2577–2579). The BFS then discovers `IMPORTS` (on the File) and `CALLS` (on the Constructor) naturally. The resolver must surface `kind: 'Class' | 'Interface'` so this seed fires (GT-IMPACT:1532, the disambiguation preserves the Class/Constructor preference).

**Acceptance must name the seeded callers** (§15 AC-IMPACT-2).

### 6.3 Symbol resolution + disambiguation

`/impact` and `/context` first resolve `target`/`name` to a node id. If multiple nodes share the name, return ranked candidates (kind-priority: Class/Interface/Function > Method > Constructor; GT-IMPACT:1429–1463) rather than silently picking one — matching `status: 'ambiguous'` (GT-IMPACT:1692). `target_uid`/`uid` skips resolution.

### 6.4 Relation set + confidence floors (M1)

Full valid relation set for impact (GT-RELSET, `VALID_RELATION_TYPES`): `CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, HAS_PROPERTY, METHOD_OVERRIDES, OVERRIDES (legacy alias), METHOD_IMPLEMENTS, ACCESSES, HANDLES_ROUTE, FETCHES, HANDLES_TOOL`. **Default** traversal: `CALLS, IMPORTS, EXTENDS, IMPLEMENTS` (usage-based; `ACCESSES` excluded by default — GT-TOOLS:386). Callers opt in `HAS_METHOD`/`HAS_PROPERTY`/`ACCESSES` for class-member/field analysis.

**Confidence floors per relation type (M1 — port of GT-CONF `IMPACT_RELATION_CONFIDENCE`):**

| Relation | Floor |
|----------|-------|
| CALLS | 0.90 |
| IMPORTS | 0.90 |
| EXTENDS | 0.85 |
| IMPLEMENTS | 0.85 |
| METHOD_OVERRIDES | 0.85 |
| METHOD_IMPLEMENTS | 0.85 |
| HAS_METHOD | 0.95 |
| HAS_PROPERTY | 0.95 |
| ACCESSES | 0.80 |
| CONTAINS | 0.95 |
| (unknown) | 0.50 |

Rule (GT-IMPACT:2649–2654): **prefer the stored `edges.confidence`** when present and > 0; otherwise apply the floor for that relation type. `minConfidence` filters at query time on the stored value.

### 6.5 Risk scoring (exact thresholds, GT-IMPACT:2933–2948)

Let `directCount` = depth-1 count, `processCount` = affected processes, `moduleCount` = affected modules, `total` = total impacted.

- **CRITICAL** if `directCount ≥ 30 OR processCount ≥ 5 OR moduleCount ≥ 5 OR total ≥ 200`
- **HIGH** if `directCount ≥ 15 OR processCount ≥ 3 OR moduleCount ≥ 3 OR total ≥ 100`
- **MEDIUM** if `directCount ≥ 5 OR total ≥ 30`
- **LOW** otherwise

Depth labels: d=1 WILL BREAK, d=2 LIKELY AFFECTED, d=3 MAY NEED TESTING (GT-TOOLS:329–333). **V1 caveat:** with processes V2-deferred (§4.5), `processCount = 0`; risk is computed from directCount/moduleCount/total only and never *under*-reports relative to those signals.

---

## 7. Search (C3/C4 — explicit semantic decision)

### 7.1 The hard constraint

The Tessera embedder uses **native `onnxruntime-node`** via `@huggingface/transformers` (GT-EMBED:17, 36–53), which `dlopen`s `.node`/`.so` binaries and probes the filesystem (`ldconfig`, CUDA libs). **This cannot run on Cloudflare Workers** — Workers have no native addon loader and no filesystem. v0.1 said "tree-sitter-wasm runs in the Worker" and implied embeddings come along; that is false for the embedder.

### 7.2 Decision: V1 = BM25-only; V2 = semantic via the existing OpenAI-compatible HTTP escape hatch

**Chosen: option (c) for V1 + option (b) for V2.**

- **V1 ships BM25-only.** BM25 (LadybugDB FTS → DO FTS5) is always available and needs no embeddings (GT-SEARCH:120–122 — "FTS is always available… Semantic is optional"). `query` merges via RRF (K=60) with an **empty semantic list** in V1, which mathematically reduces to BM25 ranking (GT-SEARCH:46–113 — RRF over one source returns that source's order). `meta.semantic_enabled = 'false'`.

- **V2 adds semantic through the embedder's existing HTTP path**, not a Worker-native model. The codebase **already has** an OpenAI-compatible `/v1/embeddings` client (GT-EMBED `http-client.ts`: `TESSERA_EMBEDDING_URL`, `_MODEL`, `_DIMS`, `_API_KEY`). Cloudflare **Workers AI exposes an OpenAI-compatible embeddings endpoint**, so the Indexer points the same env vars at Workers AI (or any external embedding service) and re-embeds during ingest. The DO stores vectors in the `embeddings` table (§5.4) and does cosine top-k in SQL or via Vectorize.

**Why this over the alternatives:**
- *(a) Workers AI with re-embed-everything as the V1 path* — rejected for V1 because it couples V1 delivery to picking a model, fixing new dimensions (snowflake-arctic is 384; a Workers AI model like `bge-base-en-v1.5` is 768), re-embedding every node on every full rebuild (§11 cost), and building vector search — all before the critical path (UC-1 impact) ships. Deferred to V2 deliberately.
- *(b) external embedding service* — this **is** the V2 mechanism, via the existing HTTP client. No new code path invented; we reuse `http-client.ts`.

**V2 dimension decision (must be fixed before V2 build):** the V2 embedding model fixes `EMBEDDING_DIMS`. If Workers AI `@cf/baai/bge-base-en-v1.5` is chosen → **768-dim**, and the `embeddings.dims` column + any Vectorize index are created at 768. Re-embedding the whole graph on each full rebuild is accepted (bounded by debounce, §11). This is a P0 open question for V2 (§14 Q-S1).

### 7.3 BM25 spec (V1, GT-SEARCH)

- `query` → `nodes_fts` MATCH with FTS5 BM25 ranking over `name, properties, file_path`.
- Results carried into RRF (`1/(K + rank)`, K=60). With V1's empty semantic list the output equals BM25 order; the RRF plumbing is built in V1 so V2 only adds the semantic input list — zero change to the merge code (GT-SEARCH `mergeWithRRF`).
- `query` returns process-grouped results in the full engine; with processes V2-deferred (§4.5), V1 `query` returns symbol-level FTS hits grouped by file/module, with a documented `processes: []` until §4.5 ships. (UC-2 partially served in V1: keyword retrieval works; semantic + process grouping land in V2.)

---

## 8. MCP Endpoint — all 13 tools (C5, GT-TOOLS)

`POST /mcp`, JSON-RPC over HTTP, bearer auth (§9). Every tool gets a status. **The full surface is 13 tools, not 6.**

| # | Tool | V1 / V2 / Removed | Notes |
|---|------|-------------------|-------|
| 1 | `list_repos` | **V1** | Enumerate TesseraStore DOs + `meta` stats (UC-8). |
| 2 | `query` | **V1 (BM25), V2 (semantic)** | §7. RRF plumbing in V1; semantic list empty until V2. |
| 3 | `context` | **V1** | §6.2 Class/Interface incoming expansion ported (GT-CTX480). `include_content` slices body from R2. |
| 4 | `cypher` | **V1 (translated subset), V2 (full)** | §8.1. Read-only. |
| 5 | `impact` | **V1** | §6. Critical path (UC-1). Local single-repo walk only in V1; `@group` cross fan-out is V2 (M3). |
| 6 | `detect_changes` | **V1** | §8.2. Caller sends diff hunks; DO maps lines→symbols→processes. |
| 7 | `rename` | **V2 (write — separate architecture)** | §8.4. Cannot be a read-only DO query. |
| 8 | `route_map` | **V1** | Reads Route nodes + HANDLES_ROUTE/FETCHES edges. Requires web-repo indexing. |
| 9 | `tool_map` | **V1** | Reads Tool nodes + HANDLES_TOOL edges. |
| 10 | `shape_check` | **V1** | Route `responseKeys` vs consumer accesses. |
| 11 | `api_impact` | **V1** | Composition of route_map + shape_check + impact. |
| 12 | `group_list` | **V2** | Cross-repo group config — requires Bridge DO (M3). |
| 13 | `group_sync` | **V2 (write)** | Rebuilds Contract Registry — write op, Bridge DO (M3). |

**Transparent swap:** Claude Code MCP config `localhost:4747` → `https://tessera.koales.workers.dev` is zero-code for all **V1** tools. `rename`, `group_list`, `group_sync` return a structured "not available in cloud V1" error until V2, so the swap degrades explicitly, never silently.

### 8.1 `cypher` mapping (translated subset → full)

The CLI runs Cypher on LadybugDB (GT-TOOLS:140). DO SQLite has no Cypher. **V1** supports a **translated subset**: the common `MATCH (a)-[:CodeRelation {type:'X'}]->(b) …` patterns are parsed into the equivalent SQL over `nodes`/`edges` (the same patterns the impact/context engines already issue). Arbitrary Cypher returns `unsupported_in_cloud_v1` with the SQL-equivalent hint. **V2** ships a fuller translator. All `cypher` execution is **read-only** — writes (`CREATE`, `SET`, `DELETE`, `MERGE`) are rejected at parse time (parity GT-DOBEAD read-only discipline).

### 8.2 `detect_changes` mapping

Cloud has no local git working tree, so the **caller** computes the diff and sends hunks `{path, addedLines, removedLines}` (already the `/detect_changes` route shape, §5.6). The DO maps changed line ranges to overlapping `nodes` (`start_line ≤ line ≤ end_line`), then runs the impact BFS (§6) from those symbols and the process-enrichment (V2). The CLI's working-tree scopes (`unstaged`/`staged`/`compare`) are a **client-side** concern (GitHub Action or Claude Code computes them); the DO only consumes hunks.

### 8.4 `rename` — write coordination architecture (C5)

`rename` is **destructive** (GT-TOOLS:290 `DESTRUCTIVE_TOOL_ANNOTATIONS`) and edits source **across files**. A read-only TesseraStore DO cannot do this. **Architecture (V2):**

```
Agent → POST /mcp rename {symbol, new_name, repo, dry_run}
  │
  ├─ TesseraStore: resolve symbol → graph references (high-confidence edits)
  │                + nodes_fts/text candidates (lower-confidence) → edit plan
  │
  ├─ dry_run=true (DEFAULT, GT-TOOLS:301): return the edit plan, tagged
  │     'graph' (high) vs 'text_search' (low). No writes. This part is V1-capable
  │     (read-only plan), but exposed only with the executor below to avoid a
  │     half-tool.
  │
  └─ dry_run=false: hand the plan to an ephemeral Rename Worker:
        1. fetch the commit archive (R2 / GitHub)
        2. apply edits in-memory
        3. open a GitHub PR via the App (contents:write + pull_requests:write —
           a scope NOT held by the indexer, §9)
        4. return PR URL. The push then re-indexes via the normal webhook (§4).
```

Rename never mutates the graph directly — it mutates **source**, and the resulting push re-indexes. This keeps the DO read-only and makes rename auditable (a PR), not a silent file write. Requires an **elevated GitHub App permission set** (§9), which is why it is V2 and gated behind explicit auth.

---

## 9. Auth (H6 token caching)

| Token / Key | Used for | Holders | Scope |
|-------------|----------|---------|-------|
| `TESSERA_PUSH_SECRET` | `/webhook/github` HMAC SHA-256 | GitHub webhook config | — |
| `TESSERA_QUERY_TOKEN` | All `/mcp` + query routes | ff-pipeline, GasCity supervisor, Claude Code, CI | read |
| GitHub App key (indexer) | Fetch repo tarballs | Installation-Token Cache DO | `contents:read`, `metadata:read` |
| GitHub App key (rename) | Open rename PRs (V2) | Rename Worker only | `contents:write`, `pull_requests:write` |

**Installation-Token Cache (H6):** a dedicated cache DO (or KV namespace) keyed by `installationId` holds the minted GitHub App installation token with a **~55-min TTL** (tokens live 60 min; refresh at 55). The indexer reads the cached token; it mints a new one only on miss. This caps token-mint calls at ~1/hr/installation and keeps tarball fetches inside GitHub's 5,000 req/hr/installation budget (§4.6).

GitHub App installed on the `Wescome` org. The read scope and the write scope are **separate App permission sets** — the indexer never holds write; only the V2 Rename Worker does.

---

## 10. CF Integration (ff-pipeline + GasCity)

### ff-pipeline Worker (service binding)
```jsonc
"services": [{ "binding": "TESSERA", "service": "tessera-worker" }]
```
```typescript
const impact = await env.TESSERA.fetch(new Request(
  'https://tessera/repos/function-factory/impact',
  { method: 'POST',
    headers: { Authorization: `Bearer ${env.TESSERA_QUERY_TOKEN}` },
    body: JSON.stringify({ target: 'dispatchOperatorStage', direction: 'upstream' }) }))
```

### GasCity Container (supervisor proxy — same pattern as GT-DOBEAD §7)
A Container cannot call a DO or a service binding directly. Route through the supervisor Worker, exactly as the bead store does (GT-DOBEAD §7):
```
Container ──► gascity-supervisor /internal/tessera/* ──► Tessera Worker (binding)
```
```
TESSERA_URL=https://gascity-supervisor.koales.workers.dev/internal/tessera
TESSERA_QUERY_TOKEN=<token>
```
The supervisor validates the same `GC_SUPERVISOR_TOKEN`-class bearer it already validates for `/internal/*` and forwards to the Tessera Worker binding. No new credential pattern is introduced (parity GT-DOBEAD §7).

---

## 11. Cost Model (row-level billing + debounce requirement, H9)

CF DO SQLite bills **per row read and per row written**, not just storage (GT-DOBEAD §12). This is the gap v0.1 never modeled, and it makes debounce a **V1 requirement**.

### 11.1 gascity full-rebuild write cost

One full rebuild of gascity (§4.1) writes, per push:
- ~77,979 node rows
- ~276,625 edge rows
- FTS5 index rows for ~78k nodes (name/properties tokens) — order ~78k+ writes
- staging then live (the swap is `INSERT … SELECT`, counted again on the live insert)

Conservatively **~500k+ row writes per full rebuild**.

| Scenario | Writes | DO write cost @ $1.00/M rows |
|----------|--------|------------------------------|
| 1 full rebuild | ~500k | ~$0.0005 |
| **Naive: 20 pushes/day, no debounce** | ~10M/day → ~300M/mo | **~$300/mo from gascity alone** |
| **Debounced: ≤ 1 index/ref/10min** | bounded to ≤ 144 rebuilds/day/ref → ~72M/mo worst case, realistically ≪ | **≪ $72/mo; typically < $10/mo** |

### 11.2 Debounce is a V1 requirement (H9)

The IndexerCoordinator enforces **at most one index per ref per 10 minutes** (`debounceUntil`, §4.3). Rapid pushes to the same ref coalesce to the newest commit. Without this, gascity alone could cost ~$300/mo in row writes — unacceptable. With it, gascity's contribution stays in the low single-digit dollars under normal push cadence. This is **not** a V2 optimization; it ships in WP-T1/WP-T3.

| Resource | Rate | Estimate (debounced) |
|----------|------|----------------------|
| DO requests | $0.15/M | ingest + queries → < $1/mo |
| Row writes | $1.00/M | debounced rebuilds → low single digits/mo |
| Row reads | $0.001/M | impact/query traffic → cents/mo |
| Storage | $0.20/GB-mo | no inline content (H8) → small; monitor vs 10GB ceiling |
| R2 (archives + grammars) | $0.015/GB-mo | per-commit source → small; lifecycle-expire old commits |
| **Total (V1, debounced)** | | **single-digit to low-double-digit $/mo; revisit at 10x push volume** |

---

## 12. SQLite Limits + VACUUM (consolidated, parity GT-DOBEAD §5.0/§5.9/§15)

- `PRAGMA auto_vacuum = INCREMENTAL` **before first CREATE TABLE** (§5.1); fallback if CF unsupported = in-place rebuild + periodic full VACUUM. **WP-T1 acceptance must confirm.**
- `PRAGMA foreign_keys = ON`; edges `ON DELETE CASCADE` (§5.3).
- **No inline source content** — bodies in R2 (§5.2, H8). Biggest row-bloat source removed by design.
- 1MB per-column working limit; `properties` capped 64KB → **413** on overflow.
- 10GB per-DO ceiling — one DO per repo; monitor on maintenance alarm.
- **Shard trigger: p95 write latency > 50ms** under normal ingest → evaluate splitting TesseraStore (§12 escape hatch) — identical trigger to GT-DOBEAD §15 G2.
- `incremental_vacuum` runs after each `/ingest/commit` (the full-rebuild swap frees large page ranges every push) and weekly as backstop.

---

## 13. Work Packages

### WP-T1: TesseraStore DO
**Repo:** `Wescome/tessera` — new `workers/tessera-worker/`
- `TesseraStore` class; `ctx.storage.sql`; `PRAGMA auto_vacuum = INCREMENTAL` (pre-CREATE) + `foreign_keys = ON`.
- Schema §5.2–5.4: `nodes` (**no content column**), `edges` (CASCADE FKs, target_id + composite indexes), `nodes_fts` (FTS5), `processes` (V2-empty), `meta`. No `embeddings` table in V1.
- Staged ingest + atomic swap (§5.5): start (truncate staging), nodes, edges, commit (resolve cross-file edges, swap, rebuild FTS), abort.
- **Impact BFS (§6):** explicit upstream (reverse) + downstream (forward) per-depth expansion; `visited` dedup; Class/Interface seeding (§6.2); confidence floors (§6.4); risk thresholds (§6.5).
- `context` with Class/Interface incoming expansion (GT-CTX480); `query` (FTS5 BM25 + RRF plumbing); `cypher` (translated read-only subset); `detect_changes` (hunks→symbols→impact); `route_map`/`tool_map`/`shape_check`/`api_impact`; `/meta`.
- `incremental_vacuum` alarm post-commit + weekly.

**Acceptance:**
- **AC-IMPACT-1 (C1 directions):** `impact(target:'notifyWorkflowComplete', direction:'upstream')` returns the reverse-traversal callers (nodes whose edges point AT it), risk LOW, with correct d=1 caller set matching local Tessera for the same commit. `direction:'downstream'` returns its callees. The two result sets are **not** equal.
- **AC-IMPACT-2 (C2 class seeding):** `impact` on a Class target returns callers that reference its **Constructor** (via HAS_METHOD seed) and importers of its **owning File** (via DEFINES seed); the owning File itself is **absent** from `impacted`. Test must **name the expected callers** from a fixture repo (e.g. for `class UserService`, the seeded callers include every site that does `new UserService(...)` and every module that `import`s its file).
- **AC-IMPACT-3 (M1 floors):** an edge with no stored confidence is scored at its relation-type floor (CALLS 0.90, ACCESSES 0.80, …); a stored confidence > 0 is preferred over the floor. `minConfidence` filters on the stored value.
- **AC-RISK:** thresholds match §6.5 exactly (CRITICAL ≥30 direct, etc.).
- **AC-SEARCH:** FTS query `"bd silent fallback dolt unreachable"` returns `doBd` in top 5 (BM25-only). RRF over an empty semantic list equals BM25 order.
- **AC-LIMITS (H8):** `properties` write > 64KB → 413; no `content` column exists on `nodes`; `auto_vacuum` setting confirmed at DB creation (or documented fallback active).
- **AC-SWAP:** during ingest, queries see the prior commit until `/ingest/commit`; no partial graph is ever queryable.

### WP-T2: Parser-layer port + graph construction (H4/H5)
**Scope is a parser-layer port, not a green-field parser.** Port the `LanguageProvider` wrapper from native tree-sitter to **tree-sitter-wasm**, preserving the language-agnostic core pipeline (`tessera/src/core/ingestion/`, CLAUDE.md contract).
- tree-sitter-wasm: **async init** (`await Parser.init()`), grammars via `Parser.Language.load(<wasm>)` from R2 `tessera-grammars` — a **different API** from the native synchronous binding (H5). Document the API delta in the port.
- TypeScript + Go minimum (covers active repos). Entity extraction → 31 node kinds; intra-file edges at parse; cross-file resolution at COMMITTING (§4.5) with `confidence` per GT-CONF.
- Stream to TesseraStore via staged ingest. **No** community/process detection in V1 (§4.5 steps 4–5 are V2).
- Drop the v0.1 "single 30s invocation for gascity" assumption entirely (H4).

**Acceptance:**
- **AC-PARSE-1:** parsing a fixed TS fixture file in the WASM provider yields the **same node + edge set** as the native CLI provider for that file (modulo content column).
- **AC-PARSE-2:** the WASM provider initializes via `await Parser.init()` and loads the TS + Go grammars from R2 (proves the async-API port, H5).
- **AC-PARSE-3:** indexing gascity through IndexerCoordinator (not a single Worker call) produces ≥ 77,979 nodes and ≥ 276,625 edges in TesseraStore.

### WP-T3: GitHub webhook + IndexerCoordinator (H2, H3, H9)
- `POST /webhook/github` — HMAC validate, build `IndexJob`, call `IndexerCoordinator.startOrDebounce`.
- `IndexerCoordinator` DO: full state machine (§4.3), persisted cursor (manifest + offset), per-alarm batch loop with adaptive `batchSize` (§4.4), terminal COMMITTING→DONE, retry/backoff, FAILED→DLQ.
- **Debounce ≤ 1 index/ref/10min** with coalescing (§4.3, H9 — V1 requirement).
- Per-repo **ingest lock**; **idempotent** `/ingest/start` (truncate prior staging for same commit, H2).
- **Stale-staging reaper** alarm (TTL 2h) + **abort** path + **DLQ** table (H2).
- Archive: stream tarball, follow 302, 500MB cap, per-file R2 objects (§4.6, H6).

**Acceptance:**
- **AC-IDX-1:** `git push` to a watched ref triggers a full re-index; index reflects the new commit within 5 min, no human action.
- **AC-IDX-2 (H9 debounce):** 10 pushes to the same ref within 10 min coalesce to **one** index of the newest commit (verify row-write count ≈ a single rebuild, not 10×).
- **AC-IDX-3 (H2 crash):** killing the IndexerCoordinator mid-PARSING and resuming completes the index from `cursor` with no duplicate nodes (idempotent staging).
- **AC-IDX-4 (H2 reaper/DLQ):** a wedged ingest (force a stuck state) is reaped after the 2h TTL, lock released, a DLQ row written; abort endpoint clears state to IDLE.
- **AC-IDX-5 (H3 scale):** gascity indexes via alarm ticks (never a single 30s invocation), end-to-end < 5 min.

### WP-T4: MCP endpoint (13 tools)
- `POST /mcp` JSON-RPC; bearer auth; repo addressing by name.
- V1 tools (§8 table): `list_repos, query, context, cypher(subset), impact, detect_changes, route_map, tool_map, shape_check, api_impact`.
- V2/removed tools return structured "not available in cloud V1" (`rename, group_list, group_sync`) — explicit degradation, never silent.

**Acceptance:**
- **AC-MCP-1:** Claude Code config swap `localhost:4747`→cloud is transparent for all 10 V1 tools (identical results on a shared fixture repo).
- **AC-MCP-2:** `rename`/`group_list`/`group_sync` return the explicit not-available error, not a 500 or a wrong answer.

### WP-T5: ff-pipeline + GasCity integration
- Service binding in ff-pipeline `wrangler.jsonc` (§10).
- `/internal/tessera/*` proxy in gascity-supervisor (same pattern as GT-DOBEAD §7 bead-store proxy); inject `TESSERA_URL` + `TESSERA_QUERY_TOKEN` into Container env.

**Acceptance:**
- **AC-INT-1:** ff-pipeline calls `impact('dispatchOperatorStage','upstream')` via service binding and gets the correct HIGH/CRITICAL result.
- **AC-INT-2:** GasCity Container calls the same via supervisor proxy with identical result.

### WP-T6: Semantic search + rename + cross-repo (V2)
- **Semantic (§7):** point the embedder HTTP client (`TESSERA_EMBEDDING_URL/_MODEL/_DIMS`) at Workers AI / external service; create `embeddings` table at the model's dimension; re-embed on rebuild; cosine top-k; feed the semantic list into the existing RRF merge.
- **Rename (§8.4):** read-only plan in TesseraStore + ephemeral Rename Worker that opens a PR (elevated GitHub App scope, §9).
- **Cross-repo (M3):** Bridge DO holding `Contract`/`ContractLink` (port GT-XREPO `bridge-schema.ts`); `group_list`/`group_sync`; `impact` `@group` Phase-2 fan-out (`MAX_SUPPORTED_CROSS_DEPTH = 1`, GT-XREPO).

**Acceptance:**
- **AC-V2-SEM:** `query` returns semantic-only hits (term not present lexically) in top results; RRF merge unchanged from V1 code.
- **AC-V2-RENAME:** `rename(dry_run:false)` opens a PR with graph-tagged + text-tagged edits; no direct file write; the merged push re-indexes.
- **AC-V2-XREPO:** `impact('@group/...')` returns local walk + one-hop bridge fan-out matching the CLI group result.

---

## 14. Open Questions (re-ranked — P0 blockers first)

**P0 — block V1 design sign-off:**
- **Q-P0-1 (auto_vacuum):** Does CF DO SQLite honor `PRAGMA auto_vacuum = INCREMENTAL` set before first CREATE TABLE? If not, the §5.1 fallback (in-place rebuild + periodic full VACUUM) is mandatory. Verify before WP-T1.
- **Q-P0-2 (tree-sitter-wasm parity):** Do the WASM TS + Go grammars produce the same node/edge extraction as the native bindings (AC-PARSE-1)? The async API delta (`Parser.init`, `Language.load`) is the main port risk (H5).
- **Q-P0-3 (row-write budget):** Confirm the ~500k-writes/rebuild estimate (§11) against a real gascity rebuild and confirm debounce holds cost < $10/mo. If a rebuild is materially larger, tighten the debounce window or revisit full-rebuild-per-push (§4.1).
- **Q-P0-4 (DO CPU/wall budget per tick):** Validate `MAX_TICK_MS=20s` and adaptive `batchSize` against the 30s CPU ceiling on real files (§4.4).

**P1:**
- **Q-S1 (V2 embedding dims):** Pick the V2 model (Workers AI `bge-base-en-v1.5` = 768, or external). Fixes `embeddings.dims` and any Vectorize index. Required before WP-T6 semantic.
- **Q-1 (Leiden in CF, V2):** Port to TS (~500 lines) or compile to WASM. Communities power `module`-based risk signals (§6.5) and `query` grouping; skipped V1 (Q from v0.1, retained).
- **Q-2 (process detection in CF, V2):** Graph algorithm, no native dep; runs on the staged graph at COMMITTING. Needed for `affected_processes` and full `detect_changes`.

**P2:**
- **Q-3 (cross-repo, V2):** Bridge DO vs. lightweight symbol→repo lookup. M3 resolves to Bridge DO porting GT-XREPO.

---

## 15. Acceptance Criteria (full system)

1. `git push` to any watched ref → full re-index, queryable within 5 min, no human action (AC-IDX-1).
2. Debounce holds: ≤ 1 index/ref/10min; rapid pushes coalesce (AC-IDX-2, H9).
3. `impact` upstream = reverse traversal, downstream = forward; results differ; d=1 callers match local Tessera (AC-IMPACT-1, C1).
4. Class/Interface impact seeds from Constructor (HAS_METHOD) and File (DEFINES); named callers verified; File absent from impacted (AC-IMPACT-2, C2).
5. Confidence floors applied per relation type; stored confidence preferred (AC-IMPACT-3, M1).
6. Risk thresholds match §6.5 exactly.
7. V1 search is BM25-only via FTS5 + RRF; semantic explicitly deferred to V2 with the HTTP embedder path specified (C3/C4).
8. All 10 V1 MCP tools transparent on config swap; 3 V2 tools degrade explicitly (AC-MCP-1/2, C5).
9. `rename` never writes through the DO; V2 opens a PR via an ephemeral Worker with elevated scope (C5).
10. gascity (≥77,979 nodes / ≥276,625 edges) indexes via IndexerCoordinator alarm ticks, never a single 30s invocation (AC-IDX-5, AC-PARSE-3, H3/H4).
11. No inline source content in the DO; bodies fetched from R2; `properties` capped 64KB → 413 (H8).
12. `auto_vacuum = INCREMENTAL` confirmed or documented fallback active; `incremental_vacuum` alarm firing (H8).
13. Crash mid-index resumes from cursor with no duplicates; reaper + DLQ + abort all exercised (AC-IDX-3/4, H2).
14. Archive streamed (not buffered), 302 followed, 500MB cap; installation token cached ~55-min TTL (H6).
15. Row-write cost modeled and within budget under debounce (§11, H9).
16. ff-pipeline (binding) and GasCity (supervisor proxy) both run `impact` correctly (AC-INT-1/2).
17. Index survives DO restart (DO SQLite durable).
18. Zero local `tessera analyze`/`serve` required for any V1 production use case.

---

## 16. Non-Goals

- Running `tessera analyze` locally (replaced by webhook-triggered cloud indexing; local still works for dev).
- **Incremental indexing in V1** (full rebuild per push; incremental is V2 §4.7, H7).
- **Semantic search in V1** (BM25-only; semantic V2 via HTTP embedder, §7 C3/C4).
- **`rename`, `group_list`, `group_sync` in cloud V1** (write/bridge ops; V2, §8).
- Community + process detection in V1 (V2, §4.5).
- Native `onnxruntime-node` or native tree-sitter on Workers (impossible; §7.1/§4.5, GT-EMBED).
- Full Cypher language support in V1 (translated read-only subset; §8.1).
- Multi-tenant beyond the `Wescome` org (one GitHub App installation).
- D1 instead of DO SQLite (network hop + eventual consistency; DO SQLite is synchronous, co-located — GT-DOBEAD §14).
- Cross-DO graph JOINs (one DO per repo; cross-repo is the Bridge DO, M3 §8/WP-T6).

---

## 17. Architectural Guardrails (Architect, 2026-05-31)

**G1 — Read-only DO invariant.** `TesseraStore` is read-only to agents. The only writers are the IndexerCoordinator (ingest) and the maintenance alarm (vacuum). No agent-facing route mutates the graph. `rename` mutates **source via PR**, never the DO (§8.4). Any new write tool must route through a Worker that opens a PR, not through the DO.

**G2 — Single-DO throughput / shard trigger.** One TesseraStore per repo serializes ingest and query on one SQLite writer. **If p95 write latency > 50ms under normal ingest, evaluate splitting** (e.g. separate query-replica DO, or move ingest to a staging DO that ships a snapshot) — identical trigger to GT-DOBEAD §15 G2. Escape hatch: a read-replica DO loses synchronous freshness; document the staleness window before splitting.

**G3 — Debounce is load-bearing, not an optimization.** Removing or widening the debounce window directly multiplies row-write billing (§11). Any change to `debounceUntil` requires a cost re-estimate. Treat the 10-min window as an architectural constant tied to the cost model (H9).

**G4 — Parser parity gate.** The WASM parser port (WP-T2) must produce graphs bit-equivalent (modulo content) to the native CLI for the same commit (AC-PARSE-1). A parity miss is a blocking error, not a warning — divergent extraction silently corrupts every downstream impact/context result. This is the WASM analogue of GT-DOBEAD INV-RETIRE-005 (no schema/behavior drift across substrates).

**G5 — No inline content, ever.** Storing function bodies in the DO is forbidden (H8): it breaks the 1MB column limit, inflates billing, and bloats the 10GB ceiling. Bodies live in R2; the DO stores offsets. Any PR adding a `content` column to `nodes` is rejected.

**G6 — Cross-repo integrity is application-level once split.** When the Bridge DO ships (M3/WP-T6), `ContractLink` edges cross DO boundaries and SQLite FKs cannot enforce them — provider/consumer resolution must validate at emit time in the bridge sync path (GT-XREPO `cross-impact.ts`), mirroring GT-DOBEAD §15's cross-DO FK escape hatch.
