# Tessera on Cloudflare — Production Architecture Spec

**Date:** 2026-05-31
**Status:** Draft
**Scope:** Full cloud-native Tessera. Zero local dependency. GitHub push triggers indexing; agents query from anywhere via MCP.

---

## 1. Problem Statement

Tessera currently runs on a developer's machine. This means:

- ff-pipeline Workers and GasCity Containers cannot reach it — they run in Cloudflare
- The index is personal — only the machine that ran `tessera analyze` has it
- Agents operating autonomously have no graph intelligence
- Index freshness depends on a human remembering to re-run analyze

**Root cause:** stateful intelligence inside a stateless developer environment.

The fix is the same as the bead store fix: move persistent, queryable state into a Durable Object. Trigger indexing from git events, not from a human CLI call.

---

## 2. Use Cases (from 2026-05-31 session)

Every Tessera operation performed this session — these are the production requirements:

| # | Use Case | Called By | Frequency |
|---|----------|-----------|-----------|
| UC-1 | Impact analysis before editing a symbol | Agent, human | Every edit |
| UC-2 | Semantic + BM25 query for concepts | Agent, human | Every research task |
| UC-3 | Context — 360° view of a symbol | Agent, human | Every unfamiliar symbol |
| UC-4 | Cross-repo validation | Agent, human | Architecture review |
| UC-5 | Raw graph query (Cypher-equivalent) | Human | Exploration |
| UC-6 | Index freshness check | Agent, CI | Pre-query |
| UC-7 | MCP protocol access | Agent (Claude Code, GasCity) | Primary interface |
| UC-8 | List indexed repos + stats | Human, CI | Ops |

**The critical path is UC-1 and UC-7.** Agents must be able to run impact analysis before any symbol edit, via MCP, from inside a CF Worker or Container.

---

## 3. Architecture

```
GitHub
  │
  │  push webhook
  ▼
Tessera Worker (tessera.koales.workers.dev)
  │
  ├── /webhook/github ──► IndexQueue (CF Queue)
  │                            │
  │                            │  consume
  │                            ▼
  │                       Indexer Worker
  │                         1. fetch repo archive from GitHub API
  │                         2. parse with tree-sitter-wasm (TypeScript, Go, etc.)
  │                         3. build graph (nodes, edges, communities, processes)
  │                         4. push to TesseraStore DO
  │
  ├── /mcp ─────────────► MCP JSON-RPC handler
  │                            │
  └── /repos/:name/* ─────► TesseraStore DO (one per repo)
                                  └── SQLite
                                      ├── nodes
                                      ├── edges
                                      ├── communities
                                      ├── processes
                                      └── nodes_fts (FTS5)

Callers:
  ff-pipeline Worker ──────────► Tessera Worker (CF service binding)
  GasCity Container ───────────► Tessera Worker (HTTPS, bearer token)
  Claude Code (MCP) ───────────► Tessera Worker (HTTPS, MCP protocol)
  CI / GitHub Actions ─────────► Tessera Worker (HTTPS, push token)
```

**One DO per repo.** Keyed by repo name. Independent indexing, independent blast radius.

---

## 4. Indexing Pipeline

### 4.1 Trigger: GitHub webhook

`POST /webhook/github` — receives `push` events from GitHub. Validates HMAC signature. Enqueues an index job for affected repos.

```typescript
interface IndexJob {
  repo: string        // "Wescome/gascity"
  ref: string         // "refs/heads/main"
  commit: string      // "549f8b7..."
  installationId: number
}
```

### 4.2 Indexer Worker

Consumes `IndexQueue`. For each job:

1. **Fetch archive** — GitHub API `GET /repos/:owner/:repo/tarball/:ref` with GitHub App token. Returns `.tar.gz`. Stream to decompression.

2. **Parse** — tree-sitter-wasm runs in the Worker. Language grammars loaded as WASM modules from R2 (pre-uploaded at deploy time). Supported: TypeScript, JavaScript, Go, Python, Rust. Each file parsed to AST → symbol extraction (functions, classes, interfaces, methods).

3. **Build graph** — same pipeline as local Tessera:
   - Entity extraction per file
   - Cross-file relation resolution (imports, calls, extends)
   - Community detection (Leiden algorithm — reimplemented in TypeScript for CF; or pre-compiled to WASM)
   - Process/execution flow detection

4. **Push to DO** — stream nodes and edges to `TesseraStore` DO via chunked ingest. DO rebuilds SQLite from scratch on new commit.

### 4.3 Incremental indexing

On push, only re-index changed files (diff from GitHub API). Unchanged files retain their nodes and edges. Community detection and process detection re-run on full graph after partial update.

**Full re-index** triggered on: first index, force flag, schema migration.

### 4.4 Large repo handling

`gascity` has 77,979 nodes and 276,625 edges. The Indexer Worker streams results to the DO in batches of 1,000 nodes / 5,000 edges. DO accumulates in a staging table, commits atomically when the stream ends.

CF Worker CPU limit is 30s on Workers Paid. For large repos, the indexer uses a Durable Object to coordinate multi-step indexing (Indexer DO, separate from TesseraStore DO), yielding between file batches via alarm scheduling.

---

## 5. TesseraStore DO

### 5.1 SQLite schema

```sql
-- Core graph
CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  file_path  TEXT,
  start_line INTEGER,
  end_line   INTEGER,
  content    TEXT,
  module     TEXT,
  properties TEXT   -- JSON
);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_kind ON nodes(kind);
CREATE INDEX idx_nodes_file ON nodes(file_path);

CREATE TABLE edges (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES nodes(id),
  target_id  TEXT NOT NULL REFERENCES nodes(id),
  type       TEXT NOT NULL,
  confidence REAL,
  step       INTEGER
);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type   ON edges(type);

-- Full-text search
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  name, content, file_path,
  content=nodes, content_rowid=rowid
);

-- Repo metadata
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: commit, indexed_at, repo, stats_json, schema_version
```

### 5.2 Impact analysis — recursive CTE

```sql
WITH RECURSIVE traversal AS (
  SELECT target_id AS node_id, 0 AS depth
  FROM edges
  WHERE source_id = (SELECT id FROM nodes WHERE name = $target LIMIT 1)
    AND type IN ('CALLS','IMPORTS','EXTENDS','IMPLEMENTS','HAS_METHOD')
  UNION ALL
  SELECT e.target_id, t.depth + 1
  FROM edges e JOIN traversal t ON e.source_id = t.node_id
  WHERE t.depth < $max_depth
)
SELECT n.id, n.name, n.kind, n.file_path, MIN(t.depth) AS depth
FROM traversal t JOIN nodes n ON t.node_id = n.id
GROUP BY n.id ORDER BY depth;
```

Risk scoring: `depth=1` → WILL BREAK; `depth=2` → LIKELY AFFECTED; `depth=3` → MAY NEED TESTING. Risk level: CRITICAL (>10 d=1), HIGH (>5 or process affected), MEDIUM (2–5), LOW (<2).

### 5.3 HTTP routes

**Ingest (Indexer → DO):**
```
POST /ingest/start          — begin staged ingest for commit X
POST /ingest/nodes          — stream node batch
POST /ingest/edges          — stream edge batch
POST /ingest/commit         — swap staging → live, rebuild FTS
DELETE /ingest/abort        — rollback staged ingest
```

**Query (agents → Worker → DO):**
```
GET  /meta                  — commit, stats, indexed_at
POST /impact                — { target, direction, maxDepth, relationTypes }
POST /context               — { name, kind?, uid? }
POST /query                 — { query, limit, repo }
POST /cypher                — { sql } (read-only, blocked writes)
POST /detect_changes        — { changedFiles: [{path, addedLines, removedLines}] }
```

---

## 6. MCP Endpoint

`POST /mcp` on the Tessera Worker. MCP JSON-RPC over HTTP, same tool surface as current `localhost:4747`.

Tools exposed:
- `tessera_query` — BM25 + semantic search
- `tessera_impact` — blast radius analysis
- `tessera_context` — 360° symbol view
- `tessera_cypher` — raw read-only SQL
- `tessera_detect_changes` — map changed file lines to affected symbols and processes
- `tessera_list` — list indexed repos and stats

**Transparent swap:** changing MCP config from `localhost:4747` to `https://tessera.koales.workers.dev` requires zero code changes in Claude Code or any agent.

Auth: `Authorization: Bearer <TESSERA_QUERY_TOKEN>` on every request.

---

## 7. Auth

| Token | Used for | Holders |
|-------|----------|---------|
| `TESSERA_PUSH_TOKEN` | `/webhook/github` (HMAC) | GitHub App |
| `TESSERA_QUERY_TOKEN` | All query/MCP routes | ff-pipeline, GasCity Container, Claude Code |
| GitHub App private key | Fetching repo archives | Indexer Worker only |

GitHub App installed on `Wescome` org. Scopes: `contents:read` (fetch archive), `metadata:read`.

---

## 8. ff-pipeline + GasCity Integration

### ff-pipeline Worker

Add service binding in `wrangler.jsonc`:
```jsonc
"services": [{ "binding": "TESSERA", "service": "tessera-worker" }]
```

Usage:
```typescript
const impact = await env.TESSERA.fetch(new Request('https://tessera/repos/function-factory/impact', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${env.TESSERA_QUERY_TOKEN}` },
  body: JSON.stringify({ target: 'dispatchOperatorStage', direction: 'upstream' })
}))
```

### GasCity Container

Container cannot call DO directly. Route through supervisor Worker proxy (same pattern as bead store):

```
Container ──► supervisor Worker /internal/tessera/* ──► Tessera Worker (service binding)
```

Inject into Container env:
```
TESSERA_URL=https://gascity-supervisor.koales.workers.dev/internal/tessera
TESSERA_QUERY_TOKEN=<token>
```

---

## 9. Wrangler Config

```jsonc
// workers/tessera-worker/wrangler.jsonc
{
  "name": "tessera-worker",
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "TESSERA_STORE", "class_name": "TesseraStore" },
      { "name": "INDEXER", "class_name": "IndexerCoordinator" }
    ]
  },
  "queues": {
    "producers": [{ "binding": "INDEX_QUEUE", "queue": "tessera-index-queue" }],
    "consumers": [{ "queue": "tessera-index-queue", "max_batch_size": 1, "max_retries": 3 }]
  },
  "r2_buckets": [{ "binding": "GRAMMARS", "bucket_name": "tessera-grammars" }],
  "migrations": [{ "tag": "v1", "new_classes": ["TesseraStore", "IndexerCoordinator"] }]
}
```

---

## 10. Work Packages

### WP-T1: TesseraStore DO
**Repo:** `Wescome/tessera` — new `workers/tessera-worker/`
- `TesseraStore` class, full SQLite schema, FTS5
- Staged ingest protocol (start/nodes/edges/commit/abort)
- Impact (recursive CTE), context, query (FTS5 BM25), cypher (read-only SQL), detect_changes
- `/meta` endpoint

**Acceptance:** Impact on `notifyWorkflowComplete` returns LOW risk, 4 impacted, correct d=1 callers. FTS query "bd silent fallback dolt unreachable" returns `doBd` in top 5.

### WP-T2: Indexer Worker + pipeline
- GitHub archive fetch via GitHub App
- tree-sitter-wasm parsing (TypeScript + Go minimum — covers all active repos)
- Graph construction: entity extraction, import/call resolution
- Community detection (Leiden in TypeScript or WASM)
- Stream to TesseraStore DO via staged ingest

**Acceptance:** Push to `Wescome/gascity` main triggers index job. Within 5 minutes, `gascity` graph is queryable with correct stats (≥ 77,979 nodes).

### WP-T3: GitHub webhook + queue
- `POST /webhook/github` — HMAC validation, enqueue IndexJob
- IndexQueue consumer → Indexer Worker
- Re-index only changed files on incremental push; full re-index on first index

**Acceptance:** `git push` to any watched repo triggers re-index automatically. Index reflects new commit within 5 minutes.

### WP-T4: MCP endpoint
- `POST /mcp` — MCP JSON-RPC handler, all 6 tools
- Auth: bearer token
- Repo addressing by name (no path)

**Acceptance:** Claude Code MCP config pointed at `https://tessera.koales.workers.dev` — all tools work identically to `localhost:4747`. Zero local server needed.

### WP-T5: ff-pipeline + GasCity integration
- Service binding in ff-pipeline `wrangler.jsonc`
- Proxy route in gascity-supervisor `/internal/tessera/*`
- Inject `TESSERA_URL` + `TESSERA_QUERY_TOKEN` into Container env

**Acceptance:** ff-pipeline Worker calls `tessera_impact` on `dispatchOperatorStage` via service binding. GasCity Container calls same via supervisor proxy. Both return correct HIGH risk result.

---

## 11. Open Questions

### Q1 — Leiden community detection in CF
The current Tessera uses a native Leiden implementation for community detection (modularity 0.4356 on gascity, 2,186 clusters). Options:
- Compile Leiden to WASM — feasible, community WASM builds exist
- Port to TypeScript — Leiden is well-specified, ~500 lines for the core algorithm
- Skip communities in V1, add in V2 — impact/context/query work without communities

Recommend: skip in V1 (not required for UC-1 through UC-4), add in V2.

### Q2 — Process/execution flow detection in CF
Tessera's process detection (300 flows on gascity) identifies entry points and traces call chains. This is a graph algorithm that runs post-parse. It can run on the DO itself after graph is loaded — no native dependency. Implement in WP-T2 V2.

### Q3 — Indexer Worker CPU budget
CF Workers have a 30s CPU limit. `gascity` has 2,164 files. At ~5ms per file (parse + extract), that's ~11s — within budget for a single Worker invocation on initial index. Incremental (changed files only) will be well under. If a repo exceeds budget, the `IndexerCoordinator` DO coordinates multi-step indexing via alarms.

### Q4 — Cross-repo queries
Each repo is a separate DO — cross-repo JOINs are not possible in SQLite. Cross-repo validation (as done manually in this session) requires separate calls merged in the caller. Document explicitly. If cross-repo impact analysis becomes a frequent use case, a dedicated cross-repo index Worker can maintain a lightweight symbol-name → repo lookup table.

---

## 12. Acceptance Criteria (full system)

1. `git push` to any watched repo triggers re-index, completes within 5 minutes, no human action required
2. `tessera_impact` called from ff-pipeline Worker via service binding returns correct result
3. GasCity Container can call `tessera_impact` via supervisor proxy
4. Claude Code MCP config swap (`localhost:4747` → `https://tessera.koales.workers.dev`) is transparent — zero code changes
5. `gascity` (77,979 nodes, 276,625 edges) indexes successfully and is queryable
6. Impact analysis p95 < 500ms, BM25 query p95 < 200ms
7. Index survives Worker restart — DO SQLite is durable
8. Zero local `tessera analyze` or `tessera serve` required for any production use case

---

## 13. Non-Goals

- Running `tessera analyze` locally (replaced by webhook-triggered cloud indexing)
- Local MCP server (replaced by cloud endpoint — local still works for dev, not required)
- Full Cypher language support (SQLite recursive CTEs cover all production use cases)
- Multi-tenant (single org `Wescome` — one GitHub App installation)
- D1 instead of DO SQLite (D1 adds network hop + eventual consistency; DO SQLite is synchronous, co-located with compute)
