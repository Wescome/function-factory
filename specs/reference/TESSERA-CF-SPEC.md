# Tessera on Cloudflare — Production Architecture Spec

**Spec ID:** TESSERA-CF-SPEC
**Version:** v1.0
**Date:** 2026-06-01
**Status:** Draft — Architect rewrite of TESSERA-CF-DO-SPEC v0.2. The Durable Object substrate is abandoned; graph state lives in **ArangoDB**, the Factory's proven artifact store.
**Scope:** Full cloud-native Tessera. Zero local dependency. GitHub push triggers indexing; agents query from anywhere via MCP.

> **This is a single self-contained implementation spec.** A coding agent reading
> only this file has everything needed to build WP-T1 through WP-T5. Every
> architectural claim cites the ground-truth source it was derived from. Ground
> truth is the live Tessera codebase at `Wescome/tessera` and the live Factory
> ArangoDB client at `function-factory/packages/arango-client`.

### What changed from v0.2 (the DO spec)

| v0.2 (DO) | v1.0 (this spec) | Why |
|-----------|------------------|-----|
| `TesseraStore` Durable Object, one `ctx.storage.sql` per repo | ArangoDB collections namespaced per repo (`tessera_nodes_{repo}`, `tessera_edges_{repo}`) | ArangoDB has run in production for months as the Factory's artifact store. It is proven infrastructure, already self-hosted in a Container, already reachable from every Worker. The DO substrate was a speculative bet; this is not. |
| `IndexerCoordinator` DO state machine (alarm ticks, persisted cursor, debounce gate) | **CF Queue** (`INDEX_QUEUE`) + Indexer Worker that parses and pushes directly to ArangoDB | A queue consumer is the natural CF primitive for serial, debounced, retryable work. No DO alarm loop to hand-roll. |
| Staged ingest protocol (`/ingest/start|nodes|edges|commit|abort`) | **ArangoDB transaction**: delete-all → batch-insert nodes → batch-insert edges → rebuild view → update meta | ArangoDB transactions are atomic. No start/nodes/edges/commit dance to invent. |
| SQLite recursive CTE / app-level BFS over `edges` | **AQL graph traversal** (`INBOUND`/`OUTBOUND`) over the edge collection | AQL native traversal *is* the BFS. Depth, dedup, and direction are first-class. |
| FTS5 virtual table for BM25 | **ArangoSearch view** `tessera_search_{repo}` with BM25 scoring | ArangoSearch is the native full-text/relevance engine; no second substrate. |
| Row-level DO SQLite billing ($/M rows written) drove debounce as a hard cost gate | **Container cost is already paid**; no per-row billing. Debounce stays as write-amplification hygiene, not a billing requirement | Cost model collapses; the operational reason for debounce (avoid hammering the Container with redundant full rebuilds) survives. |
| `PRAGMA auto_vacuum`, 1MB column limit, 10GB DO ceiling, p95>50ms shard trigger | Not applicable. ArangoDB sizing is a Container-resource concern, monitored the same way the artifact store already is | These were SQLite/DO-specific constraints. |

**What carries forward unchanged from v0.2** (all the hard-won correctness fixes):

- C1/C2 impact-direction + Class/Interface seeding correctness — now expressed in AQL.
- M1 confidence floors per relation type (GT-CONF).
- All **13** MCP tools, same V1/V2/removed breakdown (GT-TOOLS).
- The `rename` write architecture (ephemeral Worker + PR; never mutate the graph).
- GitHub App auth, installation-token caching, archive streaming.
- 10-minute debounce (write-amplification hygiene; §10).
- Auth model (`TESSERA_PUSH_TOKEN`, `TESSERA_QUERY_TOKEN`).
- tree-sitter-wasm parser port with the WP-T2 async-API scoping (H5).

### Ground-truth sources (all claims trace here)

| Tag | File | What it proves |
|-----|------|----------------|
| **GT-IMPACT** | `tessera/src/mcp/local/local-backend.ts:2548–2970` (`_runImpactBFS`) | Impact = BFS: frontier expansion per depth, `visited` dedup, Class/Interface seeding, risk thresholds. The AQL traversal in §5 reproduces this. |
| **GT-CONF** | `tessera/src/mcp/local/local-backend.ts:124–162` (`IMPACT_RELATION_CONFIDENCE`, `confidenceForRelType`) | Per-relation confidence floors; fallback 0.5; **stored confidence preferred when > 0**. |
| **GT-RELSET** | `tessera/src/mcp/local/local-backend.ts:105–122` | `VALID_RELATION_TYPES`; single `CodeRelation` rel table flattened to one edge collection. |
| **GT-SCHEMA** | `tessera/src/core/lbug/schema.ts` | 31 node tables (File, Function, Class, Interface, Method, CodeElement, Community, Process, Route, Tool, Section + 20 multi-language kinds), one `CodeRelation` rel table (`type`/`confidence`/`reason`/`step`), `CodeEmbedding` FLOAT[384] table, `content` column on Function/Class/Method/etc. |
| **GT-CTX480** | `tessera/src/mcp/local/local-backend.ts:1724–1800`, `2573–2623` | Class/Interface have **no direct** CALLS/IMPORTS edges — they point at Constructor (via HAS_METHOD) and File (via DEFINES). The seeding fix (#480). |
| **GT-RISK** | `tessera/src/mcp/local/local-backend.ts:2933–2948` | Exact risk thresholds (CRITICAL/HIGH/MEDIUM/LOW). |
| **GT-TOOLS** | `tessera/src/mcp/tools.ts` | The real **13-tool** MCP surface (not 6). One write tool (`rename`), two cross-repo write/read tools (`group_*`). |
| **GT-ARANGO** | `function-factory/packages/arango-client/src/index.ts`, `workers/ff-pipeline/src/index.ts:2626–2700` (`createClientFromEnv`, `checkArango`, `_initDb`) | The live, proven Worker→ArangoDB access path: `fetch()`-based HTTP client, `ensureCollection`, `ensureIndex`, `query` (AQL `/_api/cursor`), `traverse`, basic/JWT auth, optional CF service-binding fetcher. **No transaction helper exists yet** — §4.4 specifies the extension. |

---

## 1. Problem Statement

Tessera runs on a developer's machine. Consequences:

- ff-pipeline Workers and GasCity Containers cannot reach it — they run in Cloudflare, Tessera runs on `localhost:4747`.
- The index is personal — only the machine that ran `tessera analyze` holds it.
- Autonomous agents have no graph intelligence (no impact analysis before edits).
- Index freshness depends on a human remembering to re-run `analyze`.

**Root cause:** stateful intelligence inside a stateless developer environment.

**The fix:** move persistent, queryable graph state into **ArangoDB** — the database the Factory already runs in production for its artifact store (GT-ARANGO). Trigger indexing from git events, not from a human CLI call.

**Why ArangoDB and not a DO (the v0.2 reversal):** the DO spec invented a bespoke SQLite store, a hand-rolled staged-ingest protocol, an alarm-driven coordinator state machine, and a per-row cost model — all unproven, all CF-DO-specific. ArangoDB is already deployed, already reachable from every Worker via the `arango-client` package (GT-ARANGO), already has a graph engine (AQL traversal), a full-text engine (ArangoSearch), and atomic transactions. Tessera's graph is exactly the shape ArangoDB is built for: documents + edges. We reuse proven infrastructure instead of building new.

**What v0.1 (the original) got wrong — still corrected here:**
1. Modeled impact as one recursive SQL CTE. The real engine (GT-IMPACT) is a BFS with Class/Interface seeding and per-relation confidence. **AQL `INBOUND`/`OUTBOUND` traversal reproduces it natively** (§5).
2. Assumed tree-sitter and onnxruntime "just run" on Workers. Native `onnxruntime-node` **cannot** run on Workers. tree-sitter-wasm has a **different async API** (§4.2, H5). Embeddings are V2 via the existing HTTP escape hatch (§6).
3. Listed 6 MCP tools. There are **13** (GT-TOOLS), including a **write** tool (`rename`) — §7.4.
4. Assumed gascity indexes in one 30s Worker invocation. At ~78k nodes / ~277k edges this is false; the Indexer Worker streams in batches over a Queue-driven job (§4).

---

## 2. Use Cases

Production requirements — every Tessera operation agents and humans run.

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

**The critical path is UC-1 and UC-7.** Agents must run impact analysis before any symbol edit, via MCP, from inside a CF Worker or Container. UC-10 (`rename`) is the only **write** use case and demands a separate architecture (§7.4).

---

## 3. Architecture

```
GitHub
  │  push webhook (HMAC SHA-256)
  ▼
Tessera Worker (tessera.koales.workers.dev)
  │
  ├── POST /webhook/github
  │       └─ validate HMAC, build IndexJob, debounce-gate,
  │          send to INDEX_QUEUE (CF Queue)
  │
  ├── POST /mcp ──► MCP JSON-RPC handler (13 tools, §7)
  │       └─ impact / context / query / cypher / detect_changes /
  │          route_map / tool_map / shape_check / api_impact / list_repos
  │          ── all read AQL / ArangoSearch against ArangoDB
  │
  ├── R2: GRAMMARS  (tree-sitter WASM grammars, §4.2)
  │
  └── Installation-Token Cache (KV)  GitHub App token, ~55-min TTL (§8)

INDEX_QUEUE (CF Queue)
  │  consumer = Indexer Worker (same Worker, queue() handler, or a dedicated one)
  ▼
Indexer Worker
  │  1. fetch GitHub App token (cache), stream repo tarball → R2 archive
  │  2. tree-sitter-wasm parse (grammars from R2) → nodes + edges
  │  3. ArangoDB transaction: delete-all {repo} → insert nodes → insert edges
  │  4. rebuild ArangoSearch view → update tessera_meta
  │  (retries via Queue max_retries: 3; each retry is idempotent, §4.5)
  ▼
ArangoDB  (self-hosted Container — the Factory's proven artifact store, GT-ARANGO)
  │  per repo:
  │   ├── tessera_nodes_{repo}    (document collection)
  │   ├── tessera_edges_{repo}    (edge collection: _from/_to + type/confidence/step)
  │   └── tessera_search_{repo}   (ArangoSearch view over the nodes collection)
  └── tessera_meta               (one document per repo: commit, stats, indexed_at)

Callers:
  ff-pipeline Worker ──► Tessera Worker (CF service binding)
  GasCity Container ───► gascity-supervisor /internal/tessera/* ──► Tessera Worker (binding)
  Claude Code (MCP) ───► Tessera Worker (HTTPS, MCP protocol)
  CI / GitHub Actions ─► Tessera Worker (HTTPS)
```

**No Durable Objects.** The Tessera Worker is stateless request/response (webhook intake + MCP query). Durable state lives in ArangoDB. Indexing work is durable because it rides the CF Queue (at-least-once delivery, automatic retry). This is strictly simpler than the two-DO design of v0.2 and rests on infrastructure already in production.

**Per-repo namespacing.** Each repo gets its own pair of collections (`tessera_nodes_gascity`, `tessera_edges_gascity`) and its own ArangoSearch view (`tessera_search_gascity`). Repo isolation is by collection name, so one repo's full rebuild never touches another's data, and per-repo deletes are a collection-scoped truncate. `{repo}` is the sanitized repo slug (e.g. `Wescome/gascity` → `gascity`; collision-safe slug rules in §4.1).

---

## 4. Indexing Pipeline

### 4.1 V1 indexing policy: full rebuild on every push (carried from v0.2 H7)

**Decision:** V1 performs a **full re-index on every push** to a watched ref. No incremental delta merge in V1. The Indexer Worker rebuilds `tessera_nodes_{repo}` and `tessera_edges_{repo}` from scratch inside one transaction (§4.4). Incremental indexing is **V2** (§4.6).

Rationale (unchanged): incremental indexing requires re-running community detection and process detection over the merged graph anyway (global algorithms), and correct delta merge needs stable node identity across commits. V1 buys correctness and simplicity. Debounce (§10) bounds the cost of full rebuilds.

**Repo slug rules.** `{repo}` is derived from the full GitHub name `owner/name`: lowercase, replace any character not in `[a-z0-9]` with `_`, prefix-disambiguate on collision by appending a short hash of the full name. The slug is recorded in the `tessera_meta` document so `list_repos` can map slug ↔ full name (UC-8).

### 4.2 Trigger: GitHub webhook → CF Queue

`POST /webhook/github` receives `push` events. Validates HMAC SHA-256 (`X-Hub-Signature-256`) against `TESSERA_PUSH_TOKEN`. On a valid `push` to a watched ref, it builds an `IndexJob` and, **after the debounce gate (§10)**, sends it to `INDEX_QUEUE`:

```typescript
interface IndexJob {
  repo: string          // full "Wescome/gascity"
  slug: string          // "gascity"
  ref: string           // "refs/heads/main"
  commit: string        // full 40-char SHA
  installationId: number
}
```

The CF Queue is the durable work buffer and the retry mechanism. Configure the consumer with `max_retries: 3` and a dead-letter queue for exhausted jobs (surfaced to ops via `list_repos` index-status, §7).

### 4.3 Parse: Indexer Worker (parser-layer port, WP-T2)

The Indexer Worker is the Queue consumer. Per job:

1. **Fetch source.** Get the GitHub App installation token from the KV cache (§8). `GET https://api.github.com/repos/:owner/:repo/tarball/:ref`, **follow the 302** to `codeload.github.com`, **stream** the `.tar.gz` (do not buffer the whole archive — Workers have ~128MB). Write each source file as an individual R2 object `archives/{slug}/{commit}/{path}` for per-file access during parse and on-demand `include_content` later. **Cap the archive at 500MB**; abort with a DLQ entry if exceeded. Skip binary/non-source files by the LanguageProvider extension allowlist.

2. **Parse (tree-sitter-wasm).** Port the `LanguageProvider` wrapper from native tree-sitter to **tree-sitter-wasm**, preserving the language-agnostic core pipeline (`tessera/src/core/ingestion/`; CLAUDE.md contract: shared pipeline must not name languages). The WASM provider has a **different async API** than the native binding (H5): `await Parser.init()`, grammars via `Parser.Language.load(<wasm>)` loaded from the R2 `GRAMMARS` binding. TypeScript + Go minimum (covers active repos). For large repos, parse in file batches so the Worker stays under the CPU/wall budget; accumulate nodes and edges in memory or stream them to the transaction (§4.4) in chunks.

   - **Entity extraction** per file → nodes (Function, Class, Interface, Method, Struct, …; 31 node kinds, GT-SCHEMA). Each node stores `startLine`/`endLine`, **not** the source body — bodies stay in R2 (carry-forward of v0.2 H8; keeps node documents small).
   - **Intra-file relations** at parse (DEFINES, HAS_METHOD, HAS_PROPERTY).
   - **Cross-file relation resolution** (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) once all symbols are known: resolve references against the full symbol table, emit edges with `type`, `confidence`, `step` (GT-RELSET/GT-CONF).
   - **Community detection** (Leiden) — **V1: skipped** (not required for UC-1/3/5). **V2.**
   - **Process / execution-flow detection** — graph algorithm, no native dep. **V2.** Until then `impact`'s process-enrichment returns empty `affected_processes`; risk degrades gracefully to depth/module signals (§5.5).

3. **Push to ArangoDB** (§4.4).

### 4.4 Ingest: ArangoDB transaction (replaces the staged-ingest dance)

ArangoDB transactions are atomic — there is no need for the start/nodes/edges/commit/abort protocol of v0.2. Per push, the Indexer Worker runs one logical ingest:

1. **Ensure collections + view exist** (idempotent, §4.7): `ensureCollection('tessera_nodes_{slug}')`, `ensureCollection('tessera_edges_{slug}', { type: 'edge' })`, persistent indexes, ArangoSearch view.
2. **Delete all documents** in `tessera_nodes_{slug}` and `tessera_edges_{slug}` (AQL `FOR d IN tessera_nodes_{slug} REMOVE d IN tessera_nodes_{slug}` — or, for a full rebuild, a `truncate` collection call which is faster and atomic at the collection level).
3. **Batch-insert nodes** — **1,000 documents per request** (AQL `FOR n IN @batch INSERT n INTO tessera_nodes_{slug}`).
4. **Batch-insert edges** — **5,000 documents per request** (AQL `FOR e IN @batch INSERT e INTO tessera_edges_{slug}`). `_from`/`_to` are fully-qualified (`tessera_nodes_{slug}/<uid>`).
5. **Rebuild / confirm the ArangoSearch view** `tessera_search_{slug}` so new documents are indexed (links are defined on the collection; a fresh full rebuild re-populates the view as documents are inserted — confirm consolidation completes before declaring the index queryable).
6. **Update `tessera_meta`** document (`_key = {slug}`) with the new `commit`, `indexedAt`, `nodeCount`, `edgeCount`, `slug ↔ repo` mapping, `semanticEnabled: false` (V1).

**Atomicity boundary (real gap — must be implemented in WP-T1):** the existing `arango-client` (GT-ARANGO) exposes `query`, `save`, `saveEdge`, `ensureCollection`, `ensureIndex`, `traverse`, `ping` — **but no transaction primitive.** Two options, decide in WP-T1:

- **(A) Stream Transaction (preferred).** Extend `arango-client` with `beginTransaction(collections)` → `transactionId`, run steps 2–4 as AQL cursors carrying the `x-arango-trx-id` header, then `commitTransaction` / `abortTransaction` (ArangoDB HTTP `/_api/transaction/begin|/{id}|commit`). Steps 2–6 become one atomic unit: queries see the previous commit until commit succeeds, then the new one. **No partial graph is ever queryable.** This is the closest analogue to v0.2's atomic swap and the recommended path.
- **(B) Build-aside swap (fallback if stream transactions are constrained in the Container build).** Insert into shadow collections `tessera_nodes_{slug}__staging` / `__edges__staging`, then atomically rename them over the live collections (or flip the ArangoSearch view links to point at the staging collections, then drop the old). Rename/relink is the atomic cut-over.

Whichever is chosen, the invariant is the same as v0.2 §5.5: **readers never see a partial graph.** WP-T1 acceptance must demonstrate it (AC-SWAP).

### 4.5 Crash recovery

If the Indexer Worker crashes mid-ingest, the collections may be in a partial state (option B) or the open transaction is auto-aborted by ArangoDB on disconnect (option A). Recovery is the same either way: **the CF Queue retries the job** (`max_retries: 3`). Each retry **starts at step 2 (delete-all for this repo)** — the whole ingest is **idempotent**: re-running it produces the same final graph regardless of prior partial state. A partial index is always recoverable by re-running. Exhausted retries land in the DLQ and are surfaced to ops (`list_repos` index-status); an operator re-triggers via `POST /repos/:repo/reindex`.

With **option A (stream transaction)** there is never a queryable partial graph even between a crash and the retry, because the aborted transaction's writes are rolled back. With **option B**, a crash can leave stale staging collections; the next run truncates them first (idempotent), and the live collections still hold the previous good commit until the swap.

### 4.6 Incremental indexing (V2 — specified, not built in V1)

V2 delta-merge (documented so V1 doesn't paint into a corner):
1. From the push payload, get changed paths (`added`/`modified`/`removed`).
2. For `removed`+`modified`: delete nodes whose `filePath` matches (AQL filter delete) and their incident edges (delete edges where `_from`/`_to` reference a deleted node — application-level cascade, since ArangoDB edges don't auto-cascade on vertex delete).
3. For `added`+`modified`: parse and insert new nodes/intra-file edges.
4. Re-resolve cross-file edges touching changed symbols (incoming and outgoing).
5. Re-run community + process detection on the **full** merged graph (global; no correct partial form). This is why it is V2.
6. Atomic cut-over as in §4.4.

### 4.7 Schema bootstrap (WP-T1 `_initTesseraDb` script)

Modeled on the Factory's existing `_initDb` (GT-ARANGO, ff-pipeline `_initDb`). Idempotent setup, run once per repo at first index (or globally for the meta collection):

```typescript
// per repo (slug)
await db.ensureCollection(`tessera_nodes_${slug}`)                 // document
await db.ensureCollection(`tessera_edges_${slug}`, { type: 'edge' })

// indexes for traversal + resolution hot paths
await db.ensureIndex(`tessera_nodes_${slug}`, { type: 'persistent', fields: ['name'] })
await db.ensureIndex(`tessera_nodes_${slug}`, { type: 'persistent', fields: ['kind'] })
await db.ensureIndex(`tessera_nodes_${slug}`, { type: 'persistent', fields: ['filePath'] })
await db.ensureIndex(`tessera_nodes_${slug}`, { type: 'persistent', fields: ['name', 'kind'] })
await db.ensureIndex(`tessera_edges_${slug}`, { type: 'persistent', fields: ['type'] })
// edge _from/_to are auto-indexed by ArangoDB's edge index

// ArangoSearch view (§6)
// POST /_api/view  { name: `tessera_search_${slug}`, type: 'arangosearch',
//   links: { [`tessera_nodes_${slug}`]: { fields: { name:{}, filePath:{}, kind:{}, module:{} },
//            analyzers: ['text_en','identity'] } } }

// global meta (once)
await db.ensureCollection('tessera_meta')
```

`ensureCollection` / `ensureIndex` are already idempotent in the client (409 = already exists, GT-ARANGO). The ArangoSearch view creation needs a thin `ensureView` extension on `arango-client` (WP-T1), since the current client has no view helper.

---

## 5. Impact Analysis (the correctness core — C1, C2, M1, GT-IMPACT)

> v0.2's app-level per-depth BFS is replaced by a **native AQL graph traversal**. AQL `INBOUND`/`OUTBOUND` traversal with `1..@maxDepth` *is* the breadth-first expansion: it walks the edge collection, carries path depth, and dedups via `RETURN DISTINCT`. The Class/Interface seeding and confidence-floor logic that the v0.2 BFS hosted in application code is expressed below as seed queries plus a post-traversal scoring pass — keeping behavior bit-equivalent to local Tessera (GT-IMPACT).

### 5.1 Direction semantics (C1) — the fix that v0.1 got backwards

**upstream = "what depends on this / who breaks if I change the target" = `INBOUND`** traversal: follow edges whose `_to` points **at** the target (callers, importers point AT it).
**downstream = "what this depends on" = `OUTBOUND`** traversal.

(GT-IMPACT:2630–2633 — upstream matches `(caller)-[r]->(n)`; downstream matches `(n)-[r]->(callee)`. In ArangoDB an edge `_from=caller, _to=n` means: from the target `n`, the caller is reached by going **INBOUND**.)

**Upstream AQL (who breaks if I change `@target`):**

```aql
WITH tessera_nodes_{slug}
FOR start IN tessera_nodes_{slug}
  FILTER start.name == @target
  LIMIT 1
  FOR v, e, p IN 1..@maxDepth INBOUND start tessera_edges_{slug}
    FILTER e.type IN @relTypes
    FILTER e.confidence >= @minConfidence
    RETURN DISTINCT {
      node: v,
      depth: LENGTH(p.edges),
      edgeType: e.type,
      confidence: e.confidence
    }
```

**Downstream AQL (what `@target` depends on):** identical but `OUTBOUND`.

- `@maxDepth` clamps 1–32, default 3 (GT-TOOLS impact schema).
- `@relTypes` default is the usage-based set `["CALLS","IMPORTS","EXTENDS","IMPLEMENTS"]` (`ACCESSES` excluded by default, GT-TOOLS:386). Callers opt in `HAS_METHOD`/`HAS_PROPERTY`/`ACCESSES` for member/field analysis. Full valid set §5.4.
- `@minConfidence` defaults to 0 (no filter) when omitted; clamps 0–1. When 0, drop the confidence filter line so floor-only edges still traverse (see §5.4 — the **stored** value is filtered here; the **floor** is applied in scoring).
- The two result sets (`INBOUND` vs `OUTBOUND`) **must not be equal** — that is the C1 regression test (AC-IMPACT-1).

### 5.2 Class / Interface seeding (C2 — port of GT-CTX480 / GT-IMPACT:2573–2623)

**Class and Interface nodes have no direct CALLS/IMPORTS edges.** Callers reference the **Constructor** (reached via `HAS_METHOD`) and the owning **File** (reached via `DEFINES`). When `start.kind IN ["Class","Interface"]`, resolve the seed set *before* the main traversal, then traverse `INBOUND` from each seed:

```aql
// Seed 1: constructors of the class (HAS_METHOD) — so CALLS edges are found.
LET ctorSeeds = (
  FOR m IN 1..1 OUTBOUND @startId tessera_edges_{slug}
    FILTER e.type == "HAS_METHOD" AND m.kind == "Constructor"
    RETURN m._id
)
// Seed 2: owning file (DEFINES) — so IMPORTS edges are found.
LET fileSeeds = (
  FOR f IN 1..1 INBOUND @startId tessera_edges_{slug}
    FILTER e.type == "DEFINES" AND f.kind == "File"
    RETURN f._id
)
// Traverse INBOUND from { startId } ∪ ctorSeeds ∪ fileSeeds.
// The File seed is added to the seed/visited set but the File node itself is
// NEVER returned in `impacted` — it is the definition container, not a
// dependent (GT-IMPACT:2577–2579). The traversal discovers IMPORTS (on the
// File) and CALLS (on the Constructor) naturally.
FOR seed IN APPEND([@startId], APPEND(ctorSeeds, fileSeeds))
  FOR v, e, p IN 1..@maxDepth INBOUND seed tessera_edges_{slug}
    FILTER e.type IN @relTypes
    FILTER v._id != @startId AND v.kind != "File"   // exclude target + file container
    RETURN DISTINCT { node: v, depth: LENGTH(p.edges), edgeType: e.type, confidence: e.confidence }
```

Equivalently, run the constructor/file seed queries first in the Worker (two cheap AQL calls), build the seed array, then issue one traversal seeded from the array — matching the GT-IMPACT structure exactly. **Acceptance must name the seeded callers** (AC-IMPACT-2): for `class UserService`, the seeded callers include every `new UserService(...)` site (via Constructor) and every module that `import`s its file (via File).

### 5.3 Symbol resolution + disambiguation

`impact`/`context` first resolve `target`/`name` to a node. If multiple nodes share the name, return ranked candidates (kind-priority: Class/Interface/Function > Method > Constructor; GT-IMPACT:1429–1463) rather than silently picking one — `status: 'ambiguous'`. `target_uid`/`uid` skips resolution (direct `_key` lookup). `file_path`/`kind` hints narrow the resolver (AQL filter on `filePath`/`kind`).

### 5.4 Relation set + confidence floors (M1 — GT-CONF)

Full valid relation set for impact (GT-RELSET): `CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, HAS_PROPERTY, METHOD_OVERRIDES, METHOD_IMPLEMENTS, ACCESSES, HANDLES_ROUTE, FETCHES, HANDLES_TOOL`. **Default** traversal: `CALLS, IMPORTS, EXTENDS, IMPLEMENTS` (GT-TOOLS:386).

**Confidence floors per relation type (port of GT-CONF `IMPACT_RELATION_CONFIDENCE`):**

| Relation | Floor | Relation | Floor |
|----------|-------|----------|-------|
| CALLS | 0.90 | HAS_METHOD | 0.95 |
| IMPORTS | 0.90 | HAS_PROPERTY | 0.95 |
| EXTENDS | 0.85 | ACCESSES | 0.80 |
| IMPLEMENTS | 0.85 | CONTAINS | 0.95 |
| METHOD_OVERRIDES | 0.85 | (unknown) | 0.50 |
| METHOD_IMPLEMENTS | 0.85 | | |

**Rule (GT-IMPACT:2649–2654, GT-CONF):** prefer the stored `e.confidence` when present and `> 0`; otherwise apply the floor for that relation type. The AQL filter `e.confidence >= @minConfidence` filters on the **stored** value at query time; the **effective** confidence used for display/scoring is computed in the Worker after the traversal returns (`storedConfidence > 0 ? storedConfidence : floor(edgeType)`).

### 5.5 Risk scoring (exact thresholds — GT-RISK:2933–2948)

Let `directCount` = depth-1 count, `processCount` = affected processes, `moduleCount` = affected modules, `total` = total impacted.

- **CRITICAL** if `directCount ≥ 30 OR processCount ≥ 5 OR moduleCount ≥ 5 OR total ≥ 200`
- **HIGH** if `directCount ≥ 15 OR processCount ≥ 3 OR moduleCount ≥ 3 OR total ≥ 100`
- **MEDIUM** if `directCount ≥ 5 OR total ≥ 30`
- **LOW** otherwise

Depth labels: d=1 WILL BREAK, d=2 LIKELY AFFECTED, d=3 MAY NEED TESTING (GT-TOOLS:329–333).

**Process participation** is read from `STEP_IN_PROCESS` edges → `Process` nodes (GT-IMPACT process enrichment). **V1 caveat:** with process detection deferred to V2 (§4.3), `processCount = 0`; risk is computed from `directCount`/`moduleCount`/`total` only and never *under*-reports relative to those signals. **Module participation** comes from the node's `module` field (set by community detection — V2) or null in V1; `moduleCount` is 0 until communities ship, again degrading safely.

---

## 6. Search (BM25 V1 via ArangoSearch; semantic V2)

### 6.1 The hard constraint (unchanged)

The Tessera embedder uses **native `onnxruntime-node`** which dlopens `.node`/`.so` — **cannot run on Workers**. So V1 is BM25-only; semantic is V2 via the embedder's existing OpenAI-compatible HTTP escape hatch (`TESSERA_EMBEDDING_URL`/`_MODEL`/`_DIMS`).

### 6.2 V1: ArangoSearch BM25 (replaces FTS5)

The ArangoSearch view `tessera_search_{slug}` links `tessera_nodes_{slug}` with indexed fields `name`, `filePath`, `kind`, `module` (and `text_en` analyzer on `name`/`filePath` for tokenized search). `query` runs:

```aql
FOR n IN tessera_search_{slug}
  SEARCH ANALYZER(PHRASE(n.name, @q, 'text_en')
                  OR PHRASE(n.filePath, @q, 'text_en'), 'text_en')
  SORT BM25(n) DESC
  LIMIT @limit
  RETURN { node: n, score: BM25(n) }
```

(Exact `SEARCH` clause tuned in WP-T3; the contract is BM25 relevance over `name`/`filePath`/`kind`/`module`.) Results carried into RRF (`1/(K+rank)`, K=60) so V2 only adds the semantic input list — zero change to the merge code (GT-SEARCH `mergeWithRRF`). `meta.semanticEnabled = false` in V1. With process detection V2-deferred, V1 `query` returns symbol-level hits grouped by file/module with `processes: []` documented (UC-2 partially served — keyword retrieval works; semantic + process grouping land in V2).

### 6.3 V2: semantic via HTTP embedder

Point the embedder HTTP client (`TESSERA_EMBEDDING_URL/_MODEL/_DIMS`) at Workers AI or an external service. Store vectors in a `tessera_vectors_{slug}` collection (or use ArangoDB's vector index if the Container build supports it); cosine top-k feeds the semantic list into the existing RRF merge. The V2 model fixes the embedding dimension (e.g. `@cf/baai/bge-base-en-v1.5` = 768); re-embed on each full rebuild (bounded by debounce). P0 open question for V2 (§13 Q-S1).

---

## 7. MCP Endpoint — all 13 tools (C5, GT-TOOLS)

`POST /mcp`, JSON-RPC over HTTP, bearer auth (`TESSERA_QUERY_TOKEN`, §8). Every tool returns a status. **The full surface is 13 tools, not 6.**

| # | Tool | V1 / V2 / Removed | Notes |
|---|------|-------------------|-------|
| 1 | `list_repos` | **V1** | Enumerate `tessera_meta` documents (slug, repo, commit, stats, index-status). UC-8. |
| 2 | `query` | **V1 (BM25), V2 (semantic)** | §6. ArangoSearch BM25 + RRF plumbing; semantic list empty until V2. |
| 3 | `context` | **V1** | §5.2 Class/Interface incoming expansion ported (GT-CTX480). `include_content` slices body from R2 archive. |
| 4 | `cypher` | **V1 (translated → AQL subset), V2 (full)** | §7.1. Read-only. |
| 5 | `impact` | **V1** | §5. Critical path (UC-1). Local single-repo walk only in V1; `@group` cross fan-out is V2. |
| 6 | `detect_changes` | **V1** | §7.2. Caller sends diff hunks; Worker maps lines→symbols→impact. |
| 7 | `rename` | **V2 (write — separate architecture)** | §7.4. Cannot be a graph read; mutates source via PR. |
| 8 | `route_map` | **V1** | Reads Route nodes + HANDLES_ROUTE/FETCHES edges. Requires web-repo indexing. |
| 9 | `tool_map` | **V1** | Reads Tool nodes + HANDLES_TOOL edges. |
| 10 | `shape_check` | **V1** | Route `responseKeys` vs consumer accesses. |
| 11 | `api_impact` | **V1** | Composition of route_map + shape_check + impact. |
| 12 | `group_list` | **V2** | Cross-repo group config — requires bridge collections. |
| 13 | `group_sync` | **V2 (write)** | Rebuilds Contract Registry — write op, bridge collections. |

**Transparent swap:** Claude Code MCP config `localhost:4747` → `https://tessera.koales.workers.dev` is zero-code for all **V1** tools. `rename`, `group_list`, `group_sync` return a structured "not available in cloud V1" error until V2 — the swap degrades explicitly, never silently.

### 7.1 `cypher` mapping (translated subset → AQL)

The CLI runs Cypher on LadybugDB (GT-TOOLS:140). ArangoDB speaks AQL, not Cypher. **V1** supports a **translated subset**: the common `MATCH (a)-[:CodeRelation {type:'X'}]->(b) …` patterns are parsed into equivalent AQL over `tessera_nodes_{slug}`/`tessera_edges_{slug}` (the same patterns impact/context already issue as AQL traversals). Arbitrary Cypher returns `unsupported_in_cloud_v1` with the AQL-equivalent hint. **V2** ships a fuller translator. All `cypher` execution is **read-only** — writes (`CREATE`, `SET`, `DELETE`, `MERGE`) are rejected at parse time; the AQL issued is read-only (no `INSERT`/`UPDATE`/`REMOVE`).

### 7.2 `detect_changes` mapping

Cloud has no local git working tree, so the **caller** computes the diff and sends hunks `{path, addedLines, removedLines}`. The Worker maps changed line ranges to overlapping nodes via AQL (`FOR n IN tessera_nodes_{slug} FILTER n.filePath == @path AND n.startLine <= @line AND n.endLine >= @line`), then runs the impact traversal (§5) from those symbols plus process enrichment (V2). The CLI's working-tree scopes (`unstaged`/`staged`/`compare`) are a **client-side** concern (the GitHub Action or Claude Code computes them); the Worker only consumes hunks.

### 7.4 `rename` — write coordination architecture (C5, carried from v0.2)

`rename` is **destructive** (GT-TOOLS:290) and edits source **across files**. The graph is read-only to agents; `rename` never mutates ArangoDB. **Architecture (V2):**

```
Agent → POST /mcp rename {symbol, new_name, repo, dry_run}
  │
  ├─ Tessera Worker: resolve symbol → graph references (high-confidence edits, via AQL)
  │                  + ArangoSearch text candidates (lower-confidence) → edit plan
  │
  ├─ dry_run=true (DEFAULT, GT-TOOLS:301): return the edit plan, tagged
  │     'graph' (high) vs 'text_search' (low). No writes. Read-only plan is
  │     V1-capable, but exposed only with the executor below to avoid a half-tool.
  │
  └─ dry_run=false: hand the plan to an ephemeral Rename Worker:
        1. fetch the commit archive (R2 / GitHub)
        2. apply edits in-memory
        3. open a GitHub PR via the App (contents:write + pull_requests:write —
           a scope NOT held by the indexer, §8)
        4. return PR URL. The push then re-indexes via the normal webhook (§4).
```

Rename mutates **source via PR**, never the graph. The resulting push re-indexes. This keeps the read path clean and makes rename auditable (a PR), not a silent write. Requires an **elevated GitHub App permission set** (§8) — why it is V2 and gated behind explicit auth.

---

## 8. Auth (carried from v0.2)

| Token / Key | Used for | Holders | Scope |
|-------------|----------|---------|-------|
| `TESSERA_PUSH_TOKEN` | `/webhook/github` HMAC SHA-256 | GitHub webhook config | — |
| `TESSERA_QUERY_TOKEN` | All `/mcp` + query routes | ff-pipeline, GasCity supervisor, Claude Code, CI | read |
| `ARANGO_USERNAME` / `ARANGO_PASSWORD` (or `ARANGO_JWT`) | Worker → ArangoDB | Tessera Worker, Indexer Worker | DB read/write |
| GitHub App key (indexer) | Fetch repo tarballs | Installation-Token Cache (KV) | `contents:read`, `metadata:read` |
| GitHub App key (rename) | Open rename PRs (V2) | Rename Worker only | `contents:write`, `pull_requests:write` |

**Installation-Token Cache:** a KV namespace keyed by `installationId` holds the minted GitHub App installation token with a **~55-min TTL** (tokens live 60 min; refresh at 55). The Indexer reads the cached token; mints on miss. Caps token-mint calls at ~1/hr/installation and keeps tarball fetches inside GitHub's 5,000 req/hr/installation budget.

GitHub App installed on the `Wescome` org. Read scope and write scope are **separate permission sets** — the indexer never holds write; only the V2 Rename Worker does.

---

## 9. CF Integration (ff-pipeline + GasCity)

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

### GasCity Container (supervisor proxy)
A Container cannot call a service binding directly. Route through the supervisor Worker:
```
Container ──► gascity-supervisor /internal/tessera/* ──► Tessera Worker (binding)
```
```
TESSERA_URL=https://gascity-supervisor.koales.workers.dev/internal/tessera
TESSERA_QUERY_TOKEN=<token>
```
The supervisor validates the same `GC_SUPERVISOR_TOKEN`-class bearer it already validates for `/internal/*` and forwards to the Tessera Worker binding. No new credential pattern.

---

## 10. Cost & Debounce (write-amplification hygiene, not billing)

**ArangoDB is self-hosted in a Container — already paid for.** There is **no per-row-write billing** as there was with DO SQLite. Storage cost = Container cost (already incurred for the artifact store). The DO spec's ~$300/mo row-write scare and the entire row-level cost model **collapse**.

**The 10-minute debounce still ships in V1** — for a different reason. A full rebuild of gascity writes ~78k node docs + ~277k edge docs (~355k inserts) plus an ArangoSearch view repopulation. Twenty pushes/day with no debounce means 20 redundant full rebuilds hammering the Container with insert load and view-consolidation churn, competing with the artifact-store workload that shares the same ArangoDB instance. Debounce coalesces rapid pushes to the same ref into one rebuild of the newest commit:

- **Debounce gate:** at most **one index per ref per 10 minutes**. Implemented at the webhook (§4.2): a small KV/`tessera_meta` `debounceUntil` timestamp per `{slug, ref}`. A push inside the window updates the pending `commit` and does **not** enqueue a second job; the in-flight or scheduled job picks up the newest commit.
- Rationale: protect the **shared** ArangoDB Container from redundant full-rebuild load and view churn, and avoid wasted parse/fetch work. This is operational hygiene tied to write amplification, **not** a billing requirement.

**Guardrail G3 (revised):** widening or removing the debounce window no longer changes a dollar bill, but it directly multiplies load on the shared ArangoDB Container. Any change to the window requires confirming the Container can absorb the added rebuild + view-consolidation load alongside the artifact store. Treat 10 minutes as a load-shaping constant.

| Resource | V1 estimate (debounced) |
|----------|--------------------------|
| ArangoDB storage | per-repo nodes (no inline content) + edges; small relative to existing artifact store; monitor Container disk the same way the artifact store is monitored |
| ArangoDB insert load | debounced full rebuilds; bounded to ≤ 144 rebuilds/day/ref worst case, realistically ≪ |
| R2 (archives + grammars) | per-commit source; lifecycle-expire old commits |
| CF Queue | ingest jobs; negligible |
| Worker requests | webhook + MCP queries; negligible |

---

## 11. Work Packages

### WP-T1: ArangoDB schema + Tessera collections setup
**Repo:** `Wescome/tessera` — new `workers/tessera-worker/`; extend `function-factory/packages/arango-client`.
- `_initTesseraDb(slug)` script (§4.7): `ensureCollection` nodes (document) + edges (edge), persistent indexes (`name`, `kind`, `filePath`, `name+kind`, edge `type`), and the global `tessera_meta` collection. Idempotent (parity with the Factory `_initDb`, GT-ARANGO).
- **Extend `arango-client`** (GT-ARANGO has no view or transaction helper):
  - `ensureView(name, links)` → ArangoSearch view `tessera_search_{slug}` over the nodes collection, indexed fields `name`, `filePath`, `kind`, `module`.
  - `beginTransaction(collections)` / `commitTransaction` / `abortTransaction` (stream transaction, §4.4 option A) **or** the build-aside swap helpers (§4.4 option B). Decide and implement one; document why.
  - batch insert helpers (`insertMany(collection, docs)` over `FOR x IN @batch INSERT x`).
- Document the §4.4 atomicity decision (A vs B) and the readers-never-see-partial invariant.

**Acceptance:**
- **AC-T1-INIT:** running `_initTesseraDb('gascity')` twice is idempotent (no error on second run); collections, indexes, and the ArangoSearch view exist.
- **AC-T1-SWAP:** during an in-flight ingest, an `impact`/`query` against the same repo returns the **previous** commit's graph until ingest completes; no partial graph is ever returned (proves §4.4).

### WP-T2: Indexer Worker (parser port + push to ArangoDB)
**Scope is a parser-layer port, not a green-field parser.** Port the `LanguageProvider` from native tree-sitter to **tree-sitter-wasm**, preserving the language-agnostic core pipeline (`tessera/src/core/ingestion/`).
- tree-sitter-wasm: **async init** (`await Parser.init()`), grammars via `Parser.Language.load(<wasm>)` from R2 `GRAMMARS` — a **different API** from the native synchronous binding (H5). Document the API delta.
- TypeScript + Go minimum. Entity extraction → 31 node kinds (GT-SCHEMA); intra-file edges at parse; cross-file resolution with `confidence` per GT-CONF; **no** inline source body on nodes (bodies in R2).
- Push to ArangoDB via the §4.4 transaction: delete-all {slug} → insert nodes (1,000/batch) → insert edges (5,000/batch) → rebuild ArangoSearch view → update `tessera_meta`. **No** community/process detection in V1.
- Queue consumer with `max_retries: 3`; each retry is idempotent (§4.5).

**Acceptance:**
- **AC-PARSE-1:** parsing a fixed TS fixture file in the WASM provider yields the **same node + edge set** as the native CLI provider for that file (modulo content column).
- **AC-PARSE-2:** the WASM provider initializes via `await Parser.init()` and loads TS + Go grammars from R2 (proves the async-API port, H5).
- **AC-PARSE-3:** indexing gascity through the Indexer Worker (Queue-driven, batched) produces ≥ 77,979 nodes and ≥ 276,625 edges in `tessera_nodes_gascity` / `tessera_edges_gascity`.
- **AC-PARSE-4 (idempotent):** killing the Indexer mid-ingest and letting the Queue retry produces the same final graph with no duplicate nodes/edges (§4.5).

### WP-T3: Tessera Worker + MCP endpoint (impact/context/query/cypher)
- `POST /mcp` JSON-RPC; bearer auth; repo addressing by name → slug.
- **Impact (§5):** upstream `INBOUND` / downstream `OUTBOUND` AQL traversal; Class/Interface seeding (§5.2); confidence floors applied in the Worker after traversal (§5.4); risk thresholds (§5.5); disambiguation (§5.3).
- **context** with Class/Interface incoming expansion (GT-CTX480); `include_content` slices body from the R2 archive.
- **query** (ArangoSearch BM25 + RRF plumbing, §6.2).
- **cypher** (translated read-only subset → AQL, §7.1).
- **detect_changes** (hunks → AQL line-overlap → impact, §7.2).
- **route_map** / **tool_map** / **shape_check** / **api_impact**; **list_repos** (read `tessera_meta`).
- V2/removed tools (`rename`, `group_list`, `group_sync`) return the explicit "not available in cloud V1" error.

**Acceptance:**
- **AC-IMPACT-1 (C1 directions):** `impact(target:'notifyWorkflowComplete', direction:'upstream')` returns INBOUND callers, risk LOW, d=1 set matching local Tessera for the same commit; `direction:'downstream'` returns OUTBOUND callees; the two sets are **not** equal.
- **AC-IMPACT-2 (C2 class seeding):** `impact` on a Class target returns callers that reference its **Constructor** (HAS_METHOD seed) and importers of its **owning File** (DEFINES seed); the owning File itself is **absent** from `impacted`. Test names the expected callers from a fixture repo (every `new UserService(...)` site + every importer of its file).
- **AC-IMPACT-3 (M1 floors):** an edge with no stored confidence is scored at its relation-type floor (CALLS 0.90, ACCESSES 0.80, …); a stored confidence > 0 is preferred. `minConfidence` filters on the stored value.
- **AC-RISK:** thresholds match §5.5 exactly.
- **AC-SEARCH:** an ArangoSearch BM25 query returns the expected top symbol; RRF over an empty semantic list equals BM25 order.
- **AC-MCP-1:** Claude Code config swap `localhost:4747`→cloud is transparent for all 10 V1 tools (identical results on a shared fixture repo).
- **AC-MCP-2:** `rename`/`group_list`/`group_sync` return the explicit not-available error, not a 500 or a wrong answer.

### WP-T4: GitHub webhook + IndexQueue
- `POST /webhook/github` — HMAC validate against `TESSERA_PUSH_TOKEN`, build `IndexJob`, apply debounce gate (§10), send to `INDEX_QUEUE`.
- **Debounce ≤ 1 index/ref/10min** with coalescing (§10) — KV/`tessera_meta` `debounceUntil` per `{slug, ref}`.
- Archive: GitHub App token from KV cache (§8), stream tarball, follow 302, 500MB cap, per-file R2 objects (§4.3).
- Queue consumer config: `max_retries: 3`, DLQ for exhausted jobs surfaced via `list_repos` index-status.

**Acceptance:**
- **AC-IDX-1:** `git push` to a watched ref triggers a full re-index; index reflects the new commit within 5 min, no human action.
- **AC-IDX-2 (debounce):** 10 pushes to the same ref within 10 min coalesce to **one** index of the newest commit (verify a single rebuild ran, not 10×).
- **AC-IDX-3 (retry idempotency):** a forced Indexer crash mid-ingest is retried by the Queue and completes with no duplicate nodes (§4.5).
- **AC-IDX-4 (DLQ):** a job that exhausts `max_retries: 3` lands in the DLQ and is surfaced via `list_repos` index-status; `POST /repos/:repo/reindex` re-triggers it.
- **AC-IDX-5 (scale):** gascity indexes via the Queue-driven batched Indexer (never a single 30s invocation), end-to-end < 5 min.

### WP-T5: ff-pipeline + GasCity integration
- Service binding in ff-pipeline `wrangler.jsonc` (§9).
- `/internal/tessera/*` proxy in gascity-supervisor; inject `TESSERA_URL` + `TESSERA_QUERY_TOKEN` into Container env.

**Acceptance:**
- **AC-INT-1:** ff-pipeline calls `impact('dispatchOperatorStage','upstream')` via service binding and gets the correct HIGH/CRITICAL result.
- **AC-INT-2:** GasCity Container calls the same via supervisor proxy with identical result.

### WP-T6: Semantic search + rename + cross-repo (V2)
- **Semantic (§6.3):** point the embedder HTTP client at Workers AI / external service; store vectors per repo; cosine top-k; feed the semantic list into the existing RRF merge. Fix dims to the chosen model.
- **Rename (§7.4):** read-only plan in the Worker + ephemeral Rename Worker that opens a PR (elevated GitHub App scope, §8).
- **Cross-repo:** bridge collections holding `Contract`/`ContractLink`; `group_list`/`group_sync`; `impact` `@group` Phase-2 fan-out (`crossDepth` 1).

---

## 12. Wrangler Config (no DO bindings)

The Tessera Worker needs:

```jsonc
{
  "name": "tessera-worker",
  "queues": {
    "producers": [{ "binding": "INDEX_QUEUE", "queue": "tessera-index" }],
    "consumers": [{ "queue": "tessera-index", "max_retries": 3, "dead_letter_queue": "tessera-index-dlq" }]
  },
  "r2_buckets": [{ "binding": "GRAMMARS", "bucket_name": "tessera-grammars" }],
  "kv_namespaces": [{ "binding": "GH_TOKEN_CACHE", "id": "<...>" }],
  "vars": { "ARANGO_DATABASE": "function_factory" }
  // secrets (wrangler secret put): TESSERA_PUSH_TOKEN, TESSERA_QUERY_TOKEN,
  //   ARANGO_URL, ARANGO_USERNAME, ARANGO_PASSWORD (or ARANGO_JWT),
  //   GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY
}
```

No `durable_objects` block, no migrations for DO classes. The archive R2 bucket (`tessera-archives`) is added in WP-T2/WP-T4 alongside `GRAMMARS`. If the Container's ArangoDB is fronted by a CF service binding (as the Factory does with `FF_ARANGO`, GT-ARANGO), add that binding and let `createClientFromEnv` pick it up via `env.FF_ARANGO`.

---

## 13. Open Questions

**P0 — block V1 design sign-off:**
- **Q-P0-1 (transaction vs swap):** Does the Container's ArangoDB build support **stream transactions** cleanly from a Worker `fetch` client (§4.4 option A)? If constrained, the build-aside-swap fallback (option B) is mandatory. Decide in WP-T1 and prove AC-T1-SWAP either way.
- **Q-P0-2 (tree-sitter-wasm parity):** Do the WASM TS + Go grammars produce the same node/edge extraction as the native bindings (AC-PARSE-1)? The async API delta (`Parser.init`, `Language.load`) is the main port risk (H5).
- **Q-P0-3 (ArangoSearch consolidation timing):** After a full-rebuild insert, how long until the ArangoSearch view is fully consolidated and `query` returns complete BM25 results? The ingest must not declare DONE before the view is queryable. Validate in WP-T1/WP-T3.
- **Q-P0-4 (Worker CPU/wall budget per batch):** Validate the parse-and-insert batch sizing against the Worker CPU ceiling on real files (gascity). Tune batch counts so no single invocation exceeds budget; the Queue lets the job span invocations if needed.

**P1:**
- **Q-S1 (V2 embedding dims):** Pick the V2 model (Workers AI `bge-base-en-v1.5` = 768, or external). Fixes the vector dimension. Required before WP-T6 semantic.
- **Q-1 (Leiden in CF, V2):** Port to TS (~500 lines) or compile to WASM. Communities power `module`-based risk signals (§5.5) and `query` grouping; skipped V1.
- **Q-2 (process detection in CF, V2):** Graph algorithm, no native dep; runs on the staged graph at ingest. Needed for `affected_processes` and full `detect_changes`.

**P2:**
- **Q-3 (cross-repo, V2):** Bridge collections vs lightweight symbol→repo lookup.

---

## 14. Acceptance Criteria (full system)

1. `git push` to any watched ref → full re-index, queryable within 5 min, no human action (AC-IDX-1).
2. Debounce holds: ≤ 1 index/ref/10min; rapid pushes coalesce (AC-IDX-2).
3. `impact` upstream = `INBOUND`, downstream = `OUTBOUND`; results differ; d=1 callers match local Tessera (AC-IMPACT-1, C1).
4. Class/Interface impact seeds from Constructor (HAS_METHOD) and File (DEFINES); named callers verified; File absent from impacted (AC-IMPACT-2, C2).
5. Confidence floors applied per relation type; stored confidence preferred (AC-IMPACT-3, M1).
6. Risk thresholds match §5.5 exactly.
7. V1 search is BM25-only via ArangoSearch + RRF; semantic explicitly deferred to V2 via the HTTP embedder path.
8. All 10 V1 MCP tools transparent on config swap; 3 V2 tools degrade explicitly (AC-MCP-1/2, C5).
9. `rename` never writes through the graph; V2 opens a PR via an ephemeral Worker with elevated scope (C5).
10. gascity (≥77,979 nodes / ≥276,625 edges) indexes via the Queue-driven batched Indexer, never a single 30s invocation (AC-IDX-5, AC-PARSE-3).
11. No inline source content in node documents; bodies fetched from R2 archive.
12. Ingest is atomic: readers never see a partial graph (AC-T1-SWAP).
13. Crash mid-index is retried by the Queue and completes with no duplicates (AC-IDX-3, AC-PARSE-4).
14. Archive streamed (not buffered), 302 followed, 500MB cap; installation token cached ~55-min TTL.
15. ff-pipeline (binding) and GasCity (supervisor proxy) both run `impact` correctly (AC-INT-1/2).
16. Index survives Worker restart (state is in ArangoDB, not the Worker).
17. Zero local `tessera analyze`/`serve` required for any V1 production use case.

---

## 15. Non-Goals

- Running `tessera analyze` locally (replaced by webhook-triggered cloud indexing; local still works for dev).
- **Incremental indexing in V1** (full rebuild per push; incremental is V2 §4.6).
- **Semantic search in V1** (BM25-only; semantic V2 via HTTP embedder, §6).
- **`rename`, `group_list`, `group_sync` in cloud V1** (write/bridge ops; V2, §7).
- Community + process detection in V1 (V2, §4.3).
- Native `onnxruntime-node` or native tree-sitter on Workers (impossible; §6.1/§4.3).
- Full Cypher language support in V1 (translated read-only AQL subset; §7.1).
- Multi-tenant beyond the `Wescome` org (one GitHub App installation).
- **Durable Objects of any kind** (the abandoned v0.2 substrate; ArangoDB + CF Queue replace both DO classes).
- A separate database for Tessera (it shares the Factory's existing ArangoDB Container; isolation is by per-repo collection namespacing).

---

## 16. Architectural Guardrails (Architect, 2026-06-01)

**G1 — Read-only graph invariant.** The Tessera graph is read-only to agents. The only writer is the Indexer Worker (ingest). No agent-facing route mutates ArangoDB. `rename` mutates **source via PR**, never the graph (§7.4). Any new write tool must route through a Worker that opens a PR, not through a write AQL query.

**G2 — Shared-Container citizenship.** Tessera's collections live in the **same** ArangoDB Container as the Factory's artifact store. Tessera must be a good tenant: per-repo collection namespacing (no cross-repo collisions), bounded rebuild load (debounce, G3), and disk monitored alongside the artifact store. If Tessera's load measurably degrades artifact-store latency, the escape hatch is a dedicated ArangoDB Container — but the proven shared instance is the default.

**G3 — Debounce is load-shaping, not billing.** Removing or widening the debounce window no longer changes a dollar bill (Container cost is fixed), but it multiplies full-rebuild + ArangoSearch-consolidation load on the **shared** Container. Any change requires confirming the Container absorbs the added load without harming the artifact store. Treat 10 minutes as a load-shaping constant.

**G4 — Parser parity gate.** The WASM parser port (WP-T2) must produce graphs bit-equivalent (modulo content) to the native CLI for the same commit (AC-PARSE-1). A parity miss is a blocking error, not a warning — divergent extraction silently corrupts every downstream impact/context result.

**G5 — No inline content, ever.** Function bodies are not stored in node documents: it bloats documents and the working set. Bodies live in R2; nodes store `startLine`/`endLine`. Any change adding a body field to nodes is rejected.

**G6 — Atomic ingest is non-negotiable.** Readers must never see a partial graph. Whether via stream transaction (§4.4 A) or build-aside swap (§4.4 B), the cut-over is atomic. A design that exposes a half-written collection to queries is rejected (AC-T1-SWAP).

**G7 — Application-level edge integrity.** ArangoDB does not cascade vertex deletes to edges. The V1 full-rebuild deletes both collections, so this is moot in V1; but V2 incremental delete (§4.6) and any cross-repo bridge must delete incident edges explicitly at the application level — there is no FK cascade to rely on.
