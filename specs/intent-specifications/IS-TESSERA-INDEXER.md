---
id: IS-TESSERA-INDEXER
version: 2
title: "Tessera Indexer — GitHub webhook → CF Queue → parse + load graph into ArangoDB"
sourceCapabilityId: BC-TESSERA-INDEXER
sourceFunctionId: FP-TESSERA-INDEXER
source_refs:
  - TESSERA-CF-SPEC
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-PARSER
explicitness: explicit
rationale: >
  TESSERA-CF-SPEC §4 (WP-T2, WP-T4) specifies the event-driven indexing pipeline:
  a GitHub push webhook validates HMAC SHA-256, debounces, and enqueues an
  IndexJob to a CF Queue; the queue consumer fetches the repo tarball, parses
  every source file (IS-TESSERA-PARSER), builds nodes + edges, and loads the
  graph into the per-repo ArangoDB collections (IS-TESSERA-ARANGO-SCHEMA) in
  batches. This IS wires the two halves — webhook intake and queue-driven ingest
  — into one event-driven loop, end to end, replacing the human `tessera analyze`
  CLI call (TESSERA-CF-SPEC §1, AC §17).

  The hard correctness properties carried from the spec: full rebuild per push
  (§4.1), atomic ingest so readers never see a partial graph (§4.4, G6), and
  idempotent crash recovery via Queue retry (§4.5) — each retry deletes-all
  first, so re-running produces the same final graph.

  v2 (2026-06-01): P0 MEMORY GAP identified and resolved. The v1 spec assumed
  build-then-write: accumulate the full graph in memory, then batch-insert into
  ArangoDB. The local analyzer uses 8GB heap and 17 minutes on gascity (2,164
  files, 77,979 nodes, 276,625 edges). CF Workers have a hard 128MB memory
  limit — 64x under what the v1 approach requires. The architecture is replaced
  with stream-and-write: parse → write immediately → never accumulate the full
  graph in a single Worker invocation. Three queue phases replace the single
  monolithic consumer.
---

# Tessera Indexer (WP-T2 + WP-T4 ingest pipeline)

## JTBD

When someone pushes a commit to a watched repository, the operator wants Tessera
to re-index that repository automatically — fetch the new source, extract the
graph, and load it into ArangoDB — so that the index reflects the latest commit
without anyone remembering to run a CLI command, and so that two pushes a minute
apart do not trigger two redundant full rebuilds.

## Problem

Tessera's index is built by a human running `tessera analyze` on their machine
(TESSERA-CF-SPEC §1). Consequences: the index is personal, stale the moment
anyone forgets to re-run it, and unreachable from Cloudflare. There is no bridge
from a git event to a graph rebuild.

Without this pipeline:
- The schema (IS-TESSERA-ARANGO-SCHEMA) exists but is never populated.
- The parser (IS-TESSERA-PARSER) is never invoked at scale.
- The query tools (impact, search, MCP) have an empty or stale graph.

Three non-trivial constraints make this more than a script:
- **Memory (P0 — v2 gap).** The local `tessera analyze` uses **8GB heap and
  17 minutes** on gascity. CF Workers hard-limit at **128MB** — 64x under.
  The v1 "build full graph in memory then write" approach is incompatible with
  CF Workers at production scale. Architecture must be stream-and-write: parse
  one file → write immediately → never hold the full graph in a single Worker.
- **Atomicity.** A reader must never see a half-written graph (G6). The ingest
  deletes the old graph and writes the new one as an atomic unit; readers see the
  previous commit until the new one is fully committed.
- **Crash recovery.** A Worker can die mid-ingest. The Queue retries; each retry
  must be idempotent (delete-all first) so the final graph is identical
  regardless of prior partial state (§4.5).

## Goal

### Three-phase streaming pipeline (v2)

The fundamental architectural shift: **ArangoDB is the graph store throughout
indexing, not the final destination after in-memory construction.** Each file
is parsed and written immediately. No Worker invocation ever holds more than
~100 files in memory at once.

**Phase 1 — Symbol extraction (queue: `INDEX_QUEUE`)**
- Fetch tarball, stream it, write each source file to R2
- Parse each file via IS-TESSERA-PARSER, emit `ParsedSymbol[]`
- Write symbols as nodes to `tessera_nodes_{slug}` (staging) **immediately after each file** — no accumulation
- Batch size: 100 files per Worker invocation (≤ ~30MB peak heap)
- Each 100-file batch is a separate queue message; the webhook enqueues a manifest of batch jobs

**Phase 2 — Edge resolution (queue: `INDEX_EDGES_QUEUE`)**
- Triggered after all Phase 1 batches complete (last batch enqueues Phase 2)
- Reads symbol table from `tessera_nodes_{slug}` (ArangoDB is the symbol table — not memory)
- Resolves cross-file edges (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) via AQL name lookups
- Writes edges to `tessera_edges_{slug}` in batches of 5,000
- Peak heap: one batch of edges, ~10MB

**Phase 3 — Graph analytics (queue: `INDEX_ANALYTICS_QUEUE`)**
- Triggered after Phase 2 completes
- Community detection: AQL-based clustering pass over `tessera_edges_{slug}` (not Leiden in-memory)
- Process detection: AQL graph traversal from entry-point nodes
- Writes Community and Process nodes to `tessera_nodes_{slug}`
- Rebuilds ArangoSearch view
- Upserts `tessera_meta` — this is the completion signal

**`workers/tessera-worker/src/webhook.ts`** — `POST /webhook/github`:
1. Validate HMAC SHA-256 against `TESSERA_PUSH_TOKEN`.
2. Build `IndexJob`, apply 10-minute debounce gate, enqueue Phase 1 manifest.

**`workers/tessera-worker/src/indexer.ts`** — queue consumers for all 3 phases.

## Scope

**In scope:**
- `workers/tessera-worker/src/webhook.ts` — webhook handler, HMAC validation,
  `IndexJob` construction, debounce gate, enqueue.
- `workers/tessera-worker/src/indexer.ts` — queue consumer: tarball fetch, parse
  orchestration, node/edge build, atomic ArangoDB load, `tessera_meta` upsert,
  idempotent retry.
- The `IndexJob` type (TESSERA-CF-SPEC §4.2): `{ repo, slug, ref, commit,
  installationId }`.
- Cross-file edge resolution (IMPORTS, CALLS, EXTENDS, IMPLEMENTS, HAS_METHOD)
  against the full symbol table — composing IS-TESSERA-PARSER's per-file symbols.
- The atomic ingest mechanism (stream transaction OR build-aside swap,
  TESSERA-CF-SPEC §4.4 — decide and implement one; document which).
- Per-file R2 archive objects `archives/{slug}/{commit}/{path}` for later
  `include_content` (§4.3).

**Out of scope:**
- Schema creation itself (IS-TESSERA-ARANGO-SCHEMA — this IS calls `initTesseraSchema`)
- The `parse` function (IS-TESSERA-PARSER — this IS calls it)
- Impact / search / MCP read tools (separate IS files)
- Leiden community detection in WASM (V2 — Phase 3 uses AQL clustering in V1)
- Incremental / delta indexing (V1 is full rebuild per push; incremental is V2)
- Semantic embedding (V2)
- The DLQ-replay route `POST /repos/:repo/reindex` (V1-optional)

## Acceptance Criteria

### Webhook (AC-W*)

**AC-W1.** `POST /webhook/github` validates `X-Hub-Signature-256` as HMAC
SHA-256 over the raw request body keyed by `TESSERA_PUSH_TOKEN`. An invalid or
missing signature → 401 before any queue or DB call. Constant-time comparison
is used for the signature check.

**AC-W2.** Only `push` events to a **watched ref** build an `IndexJob`. Non-push
events and pushes to unwatched refs → 204 (acknowledged, no job). The
watched-ref policy (e.g. `refs/heads/main`) is configurable; document the V1
default.

**AC-W3.** A valid watched push builds an `IndexJob`:
```typescript
interface IndexJob {
  repo: string          // full "Wescome/gascity"
  slug: string          // "gascity" (via slugForRepo, IS-TESSERA-ARANGO-SCHEMA)
  ref: string           // "refs/heads/main"
  commit: string        // full 40-char SHA
  installationId: number
}
```

**AC-W4 (debounce).** At most **one index per `{slug, ref}` per 10 minutes**
(§10). A push inside the window updates the pending `commit` (KV /
`tessera_meta` `debounceUntil` per `{slug, ref}`) and does NOT enqueue a second
job; the scheduled/in-flight job picks up the newest commit. 10 pushes to the
same ref within 10 minutes coalesce to ONE job for the newest commit
(AC-IDX-2).

**AC-W5.** A successfully enqueued job → 202. The response does not block on
indexing completion.

### Tarball fetch (AC-F*)

**AC-F1.** The consumer fetches the GitHub App installation token from the KV
cache (`GH_TOKEN_CACHE`, ~55-min TTL, §8); on cache miss it mints a fresh token
from `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` and caches it.

**AC-F2.** It issues `GET
https://api.github.com/repos/:owner/:repo/tarball/:ref`, **follows the 302** to
`codeload.github.com`, and **streams** the `.tar.gz` — it does NOT buffer the
whole archive in memory (Workers have ~128MB, §4.3).

**AC-F3.** The archive is **capped at 500MB**. Exceeding the cap aborts the job
with a DLQ entry; it does not OOM the Worker.

**AC-F4.** Each source file is written as an individual R2 object
`archives/{slug}/{commit}/{path}` for per-file access during parse and later
`include_content` (§4.3). Binary / non-source files are skipped by the extension
allowlist before parsing.

### Phase 1 — Symbol extraction (AC-P1*)

**AC-P1-1 (memory ceiling).** No single Worker invocation holds more than
**100 files** of parsed symbols in memory simultaneously. After each 100-file
batch: flush nodes to ArangoDB, release memory, proceed to next batch. Peak
heap target: ≤ 64MB per invocation (well under 128MB CF limit).

**AC-P1-2.** Each source file is parsed via IS-TESSERA-PARSER's
`parse(content, language, filePath)`. Language from extension (`.ts`/`.tsx` →
typescript, `.go` → go). Files >512KB, binary, or generated contribute no nodes.

**AC-P1-3.** Nodes are written to `tessera_nodes_{slug}` **immediately after
each 100-file batch** — no accumulation across the full repo. Each node carries
`startLine`/`endLine` and **no source body** (G5 — bodies in R2, AC-F4).

**AC-P1-4.** Intra-file structural edges (DEFINES, HAS_METHOD, HAS_PROPERTY)
are written alongside their nodes in the same batch.

**AC-P1-5.** When all Phase 1 batches complete, the last batch enqueues one
`EdgeResolutionJob` to `INDEX_EDGES_QUEUE`. If any Phase 1 batch fails and
exhausts retries, the edge job is NOT enqueued — the DLQ receives the batch
failure and the index is marked stale.

### Phase 2 — Edge resolution (AC-P2*)

**AC-P2-1.** The edge consumer reads the symbol table **from ArangoDB**
(`tessera_nodes_{slug}`) via AQL name-lookup queries — not from memory. Peak
heap: one batch of edge candidates, ≤ 10MB.

**AC-P2-2.** Cross-file edges (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) are
resolved by matching import paths and symbol names against the ArangoDB
symbol table. Unresolved references are dropped (not errors).

**AC-P2-3.** Edges written to `tessera_edges_{slug}` in batches of 5,000 with
`type`, `confidence` (GT-CONF floors), and `_from`/`_to` as fully qualified
`tessera_nodes_{slug}/<uid>`.

**AC-P2-4.** On completion, enqueues one `AnalyticsJob` to
`INDEX_ANALYTICS_QUEUE`.

### Phase 3 — Graph analytics (AC-P3*)

**AC-P3-1.** Community detection is implemented as an **AQL graph pass** over
`tessera_edges_{slug}` — not the Leiden algorithm in memory. V1 uses connected
components or weighted degree clustering via AQL; Leiden WASM port is V2.

**AC-P3-2.** Process/execution flow detection is implemented as AQL traversal
from entry-point nodes (exported functions, HTTP handlers, queue consumers).
V1 detects flows up to depth 10.

**AC-P3-3.** Community and Process nodes are written to `tessera_nodes_{slug}`.

**AC-P3-4.** ArangoSearch view `tessera_search_{slug}` is rebuilt after
analytics complete.

**AC-P3-5.** `tessera_meta` is upserted with `commit`, `indexedAt`,
`nodeCount`, `edgeCount`, `communityCount`, `processCount`. This upsert is the
**completion signal** — no other phase writes `tessera_meta`.

### ArangoDB load (AC-L*)

**AC-L1.** Before loading, the consumer calls `initTesseraSchema(db, slug)`
(IS-TESSERA-ARANGO-SCHEMA) — idempotent, ensures collections/indexes/view exist.

**AC-L2.** The ingest **deletes all existing documents** in
`tessera_nodes_{slug}` and `tessera_edges_{slug}` for the repo slug before
inserting (full rebuild, §4.1). Deletion is a collection-scoped truncate (or
`FOR d IN c REMOVE d`), affecting only this slug's collections — never another
repo's.

**AC-L3.** Nodes are batch-inserted at **1,000 documents per request**; edges at
**5,000 documents per request** (§4.4) via `FOR x IN @batch INSERT x INTO ...`.

**AC-L4.** The ArangoSearch view `tessera_search_{slug}` is rebuilt / confirmed
after insert; the ingest does NOT declare DONE before the view is queryable for
BM25 (§4.4 step 5, Q-P0-3).

**AC-L5.** `tessera_meta` (`_key = {slug}`) is upserted with the new `commit`,
`indexedAt`, `nodeCount`, `edgeCount`, the `slug ↔ repo` mapping, and
`semanticEnabled: false` (V1).

**AC-L6 (atomic ingest, G6).** Readers never see a partial graph. The
delete-all → insert-nodes → insert-edges → view-rebuild → meta-upsert sequence
is committed as an atomic unit: an `impact`/`query` against the same repo
returns the **previous** commit's graph until ingest completes (AC-T1-SWAP). The
implementer picks stream transaction (§4.4 A, preferred) OR build-aside swap
(§4.4 B) and documents the choice and the readers-never-see-partial proof.

### Crash recovery (AC-R*)

**AC-R1.** The Queue consumer is configured with `max_retries: 3` and a
dead-letter queue (`tessera-index-dlq`, §12).

**AC-R2 (idempotent retry).** Each retry **starts at delete-all for this slug**.
Re-running the ingest produces the same final graph regardless of prior partial
state — no duplicate nodes/edges (§4.5, AC-PARSE-4). Killing the consumer
mid-ingest and letting the Queue retry yields the identical final graph.

**AC-R3 (DLQ).** A job that exhausts `max_retries: 3` lands in the DLQ and is
surfaced to ops (via `list_repos` index-status, IS-TESSERA-MCP). It does not
silently vanish.

### End-to-end (AC-E2E*)

**AC-E2E1.** A push to a watched ref triggers a queue job; after the job
completes, `tessera_meta` for that slug has the correct commit SHA and
`nodeCount > 0`.

**AC-E2E2.** A second push to the same ref within 10 minutes is debounced: ONE
job runs, not two (AC-W4).

**AC-E2E3 (scale).** Indexing gascity through the Queue-driven batched consumer
(never a single 30s invocation) produces ≥ 77,979 nodes and ≥ 276,625 edges in
`tessera_nodes_gascity` / `tessera_edges_gascity`, end to end < 5 minutes
(AC-PARSE-3, AC-IDX-5).

## Environment dependencies

| Env var / binding | wrangler.jsonc | Purpose |
|-------------------|----------------|---------|
| `TESSERA_PUSH_TOKEN` | secret | HMAC SHA-256 key for `/webhook/github` |
| `GITHUB_APP_ID` | secret | GitHub App id for installation-token minting |
| `GITHUB_APP_PRIVATE_KEY` | secret | GitHub App private key (`contents:read`, `metadata:read`) |
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"function_factory"`) | ArangoDB database name |
| `INDEX_QUEUE` | queue producer + consumer | CF Queue `tessera-index`, `max_retries: 3`, DLQ `tessera-index-dlq` |
| `GRAMMARS` | r2_bucket | tree-sitter WASM grammars (consumed by IS-TESSERA-PARSER) |
| `GH_TOKEN_CACHE` (or `GH_TOKEN_CACHE`/KV) | kv_namespace | Installation-token cache, ~55-min TTL (§8) |
| (archive bucket) | r2_bucket `tessera-archives` | Per-file source objects `archives/{slug}/{commit}/{path}` |

## Non-negotiables

- HMAC SHA-256 validated with constant-time comparison; invalid signature → 401
  before any side effect (AC-W1).
- Full rebuild per push in V1 — no incremental delta (§4.1).
- Atomic ingest: readers never see a partial graph (AC-L6, G6).
- Each retry is idempotent (delete-all first); the Queue is the recovery
  mechanism (AC-R2, §4.5).
- No source body on nodes; bodies in R2 (AC-B2, G5).
- Tarball is streamed, 302 followed, 500MB cap; never buffered whole (AC-F2,
  AC-F3).
- 10-minute debounce coalesces rapid pushes (AC-W4, §10); the window is a
  load-shaping constant (G3).
- Per-repo collection namespacing — one repo's rebuild never touches another's
  data (AC-L2, G2).

## Success Metrics

A push to a watched ref triggers a full re-index with no human action: the
webhook validates HMAC, debounces, and enqueues; the queue consumer fetches the
tarball (streamed, 302 followed, 500MB-capped), parses every source file, builds
nodes and resolved edges, and loads them atomically into the per-repo ArangoDB
collections. After the job, `tessera_meta` carries the correct commit SHA and a
node count above zero.

The pipeline holds the spec's correctness properties: the ingest is atomic so a
concurrent reader sees the previous commit until the new graph is fully committed
(G6); a forced mid-ingest crash is retried by the Queue and completes with no
duplicate nodes or edges because every retry deletes-all first (§4.5); and two
pushes to the same ref within ten minutes coalesce into a single rebuild of the
newest commit.

At scale, gascity (≥77,979 nodes / ≥276,625 edges) indexes through the
three-phase stream-and-write pipeline — no single Worker invocation exceeds
64MB heap — end to end in under 10 minutes, replacing the local `tessera
analyze` CLI (8GB heap, 17 minutes) entirely.

**Memory proof:** 100 files × ~300 symbols/file × ~500 bytes/symbol ≈ 15MB
per Phase 1 invocation. Peak heap well under 128MB CF limit at any batch size
≤ 200 files. The full 77,979-node / 276,625-edge graph never exists in a
single Worker's memory.
