---
id: IS-TESSERA-SEARCH
version: 1
title: "Tessera Search — BM25 full-text search over ArangoSearch views"
sourceCapabilityId: BC-TESSERA-SEARCH
sourceFunctionId: FP-TESSERA-SEARCH
source_refs:
  - TESSERA-CF-SPEC
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
explicitness: explicit
rationale: >
  TESSERA-CF-SPEC §6 specifies V1 search as BM25-only over ArangoSearch views,
  replacing the local FTS5 virtual table. Semantic search is V2 (the embedder
  uses native onnxruntime-node, which cannot run on Workers, §6.1). This IS
  delivers the V1 BM25 path: a query string ranked over the `tessera_search_{slug}`
  view, merged with an exact name-prefix lookup for short queries, deduped by uid.

  V1 keeps the RRF merge plumbing in place (K=60) so V2 only adds the semantic
  input list with zero change to the merge code (§6.2). This IS scopes the BM25 +
  prefix path; the semantic list is empty until V2.
---

# Tessera Search (WP-T3 BM25 query)

## JTBD

When an agent or developer is researching a codebase and remembers a concept or a
partial symbol name, they want a ranked list of matching symbol definitions, so
that they can find the right function or type without grepping the whole repo.

## Problem

Tessera's local search uses an FTS5 virtual table for BM25 (TESSERA-CF-SPEC §6.1).
In the cloud, the graph lives in ArangoDB, whose native full-text/relevance
engine is **ArangoSearch**. The view `tessera_search_{slug}` is created by the
schema layer (IS-TESSERA-ARANGO-SCHEMA) and populated by the indexer
(IS-TESSERA-INDEXER), but nothing queries it yet.

Two retrieval modes matter:
- **BM25 relevance** for conceptual / multi-word queries (`"bd silent fallback"`).
- **Exact name prefix** for short, precise lookups (`"dispatchOperator"`), where
  BM25 tokenization can rank a partial identifier poorly.

Without this module:
- UC-2 (query for concepts) is unserved.
- The MCP `tessera_query` tool has no backend.

Semantic search is explicitly out (V2): the embedder dlopens native ONNX runtime,
impossible on Workers (§6.1).

## Goal

Implement `POST /repos/:slug/query` in
`workers/tessera-worker/src/search.ts`:

```
{ query: string, limit?: number, kinds?: string[] }
```

1. Run an **ArangoSearch BM25** query over `tessera_search_{slug}` (name +
   filePath tokenized by `text_en`), sorted by BM25 descending.
2. For **short queries (≤ 20 chars)**, also run an **exact name-prefix** lookup
   over `tessera_nodes_{slug}`.
3. **Merge and dedup** by `uid`, BM25 results ranked first.
4. Optionally filter by `kinds`. Empty query → 400.

V1 is BM25 + prefix; the semantic input list stays empty (V2, §6.3) but the RRF
merge plumbing is preserved so V2 is additive.

## Scope

**In scope:**
- `workers/tessera-worker/src/search.ts` — the `POST /repos/:slug/query` handler.
- ArangoSearch BM25 query over `tessera_search_{slug}` (§6.2).
- Exact name-prefix query over `tessera_nodes_{slug}` for short queries (≤ 20
  chars).
- Merge + dedup by `uid` (BM25 first), optional `kinds` filter, `limit` clamp.
- Preserving the RRF merge shape (K=60) so V2 semantic is additive (§6.2).

**Out of scope:**
- The MCP wrapper exposing `tessera_query` over JSON-RPC (IS-TESSERA-MCP — this
  IS provides the route it calls).
- The ArangoSearch view creation (IS-TESSERA-ARANGO-SCHEMA).
- Populating the view (IS-TESSERA-INDEXER).
- Semantic / vector search (V2, §6.3) — the semantic input list is empty in V1.
- Process grouping of results (V2; `processes: []` in V1, §6.2).
- `include_content` body slicing from R2 (that is `context`'s concern,
  IS-TESSERA-MCP).

## Acceptance Criteria

### BM25 (AC-BM*)

**AC-BM1.** `POST /repos/:slug/query` with a non-empty `query` runs an
ArangoSearch BM25 query over `tessera_search_{slug}` matching tokenized `name`
and `filePath` (`text_en` analyzer), sorted by `BM25(n)` descending, limited to
`limit`:
```aql
FOR n IN tessera_search_{slug}
  SEARCH ANALYZER(n.name IN TOKENS(@query, 'text_en')
                  OR n.filePath IN TOKENS(@query, 'text_en'), 'text_en')
  SORT BM25(n) DESC
  LIMIT @limit
  RETURN n
```

**AC-BM2.** `limit` defaults to a documented value (e.g. 20) and is clamped to a
sane maximum. `kinds`, when supplied, filters results to symbols whose `kind` is
in the list (applied in the AQL or in the merge step).

### Prefix (AC-PRE*)

**AC-PRE1.** When `query.length <= 20`, the handler also runs an exact
name-prefix lookup over `tessera_nodes_{slug}`:
```aql
FOR n IN tessera_nodes_{slug}
  FILTER STARTS_WITH(n.name, @query)
  LIMIT @limit
  RETURN n
```

**AC-PRE2.** For `query.length > 20`, the prefix lookup is skipped (only BM25
runs).

### Merge (AC-M*)

**AC-M1.** BM25 results and prefix results are merged and **deduped by `uid`**: a
symbol returned by both appears once. **BM25 results are ranked first** in the
merged output (the prefix results fill in below / dedup-merge, never displacing
the BM25 ordering for symbols present in both).

**AC-M2.** The RRF merge shape (`1/(K+rank)`, K=60, §6.2) is preserved so that
V2's semantic input list slots in with zero change to the merge code. In V1 the
semantic list is empty; RRF over `[bm25, prefix, []]` equals the BM25-first
merge order (AC-SEARCH: RRF over an empty semantic list equals BM25 order).

### Validation (AC-VAL*)

**AC-VAL1.** An empty or whitespace-only `query` → 400
`{ error: "query required" }` before any DB call.

### Reference results (AC-REF*)

**AC-REF1.** `POST /repos/:slug/query` with `query: "dispatchOperatorStage"`
returns that function as the **first** result.

**AC-REF2.** `query: "bd silent fallback"` returns `doBd` in the **top 5**
results (multi-word BM25 relevance).

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"function_factory"`) | ArangoDB database name |
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth on the route (enforced by the MCP/route layer; IS-TESSERA-MCP) |

The route reads `tessera_search_{slug}` and `tessera_nodes_{slug}`. It performs
no writes (G1). It assumes the ArangoSearch view is consolidated and queryable —
the indexer does not declare DONE before the view is queryable (AC-L4, Q-P0-3).

## Non-negotiables

- BM25 over `tessera_search_{slug}`; semantic is V2 (the semantic input list is
  empty in V1, §6.1).
- Short queries (≤ 20 chars) also run an exact name-prefix lookup (AC-PRE1).
- Merge dedups by `uid`, BM25 ranked first (AC-M1).
- The RRF merge plumbing (K=60) is preserved so V2 semantic is additive — no
  merge-code rewrite (AC-M2, §6.2).
- Empty query → 400 before any DB call (AC-VAL1).
- The query route is **read-only** (G1).

## Success Metrics

`POST /repos/:slug/query` returns ranked symbol definitions for a query string:
BM25 relevance over the ArangoSearch view handles conceptual and multi-word
queries, and an exact name-prefix lookup catches short, precise identifiers that
tokenized BM25 would rank poorly. Results merge and dedup by uid with BM25 ranked
first, and an empty query is rejected with 400 before any database call.

The reference cases prove relevance: `"dispatchOperatorStage"` returns that
function as the first result, and `"bd silent fallback"` returns `doBd` in the
top five. The RRF merge plumbing (K=60) is preserved with an empty semantic list,
so the V2 semantic path slots in additively — RRF over the empty semantic list
reduces exactly to the BM25-first order, serving UC-2's keyword-retrieval half in
V1 with the semantic half deferred to V2.
