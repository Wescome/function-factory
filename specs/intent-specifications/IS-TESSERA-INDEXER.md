---
id: IS-TESSERA-INDEXER
version: 1
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

Two non-trivial constraints make this more than a script:
- **Scale.** gascity is ~78k nodes / ~277k edges (TESSERA-CF-SPEC §4.3,
  AC-PARSE-3). A single 30s Worker invocation cannot fetch, parse, and load it.
  Work must ride a CF Queue and load in batches.
- **Atomicity.** A reader must never see a half-written graph (G6). The ingest
  deletes the old graph and writes the new one as an atomic unit; readers see the
  previous commit until the new one is fully committed.
- **Crash recovery.** A Worker can die mid-ingest. The Queue retries; each retry
  must be idempotent (delete-all first) so the final graph is identical
  regardless of prior partial state (§4.5).

## Goal

Implement two files:

**`workers/tessera-worker/src/webhook.ts`** — `POST /webhook/github`:
1. Validate HMAC SHA-256 (`X-Hub-Signature-256`) against `TESSERA_PUSH_TOKEN`.
2. On a valid `push` to a watched ref, build an `IndexJob`.
3. Apply the **10-minute debounce gate** (§10) per `{slug, ref}`; enqueue to
   `INDEX_QUEUE` only if outside the window, coalescing the newest commit
   otherwise.

**`workers/tessera-worker/src/indexer.ts`** — the `INDEX_QUEUE` consumer:
1. Fetch the GitHub App installation token (KV cache, §8), `GET` the repo
   tarball, **follow the 302**, **stream** it, **cap at 500MB**.
2. Parse each source file via IS-TESSERA-PARSER; build nodes + edges (intra-file
   at parse, cross-file resolved against the full symbol table).
3. Load into ArangoDB atomically: ensure schema → delete-all for this slug →
   batch-insert nodes (1,000/batch) → batch-insert edges (5,000/batch) → rebuild
   the ArangoSearch view → upsert `tessera_meta`.
4. Each retry is idempotent (delete-all first).

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
- Schema creation itself (IS-TESSERA-ARANGO-SCHEMA — this IS calls
  `initTesseraSchema`).
- The `parse` function (IS-TESSERA-PARSER — this IS calls it).
- Impact / search / MCP read tools (separate IS files).
- Community detection, process detection (V2, §4.3).
- Incremental / delta indexing (V1 is full rebuild per push, §4.1; incremental
  is V2 §4.6).
- The DLQ-replay route `POST /repos/:repo/reindex` (operational tooling; the
  Queue's DLQ config is in scope, the manual replay route is V1-optional and may
  ship with the MCP IS).
- Semantic embedding (V2, §6.3).

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

### Parse + build (AC-B*)

**AC-B1.** Each source file is parsed via IS-TESSERA-PARSER's `parse(content,
language, filePath)`. Language is selected from the file extension (`.ts`/`.tsx`
→ typescript, `.go` → go). Files the parser skips (>512KB, binary, generated)
contribute no symbols (AC-SK*).

**AC-B2.** Nodes are built from `ParsedSymbol[]`. Each node carries
`startLine`/`endLine` and **no source body** (G5 — bodies stay in R2, AC-F4).

**AC-B3.** Intra-file edges (DEFINES, HAS_METHOD, HAS_PROPERTY) are built from
the per-file structural signals the parser carries in `properties`.

**AC-B4.** Cross-file edges (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) are resolved
once all symbols across all files are known, against the full symbol table, each
emitted with `type`, `confidence`, `step` (GT-RELSET / GT-CONF). Edge `_from`/
`_to` are fully qualified (`tessera_nodes_{slug}/<uid>`).

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
Queue-driven batched consumer — never a single 30-second invocation — end to end
in under five minutes, replacing the local `tessera analyze` CLI entirely.
