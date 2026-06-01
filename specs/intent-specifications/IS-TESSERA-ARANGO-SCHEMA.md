---
id: IS-TESSERA-ARANGO-SCHEMA
version: 2
title: "Tessera ArangoDB Schema — collections, indexes, and ArangoSearch views per repo"
sourceCapabilityId: BC-TESSERA-ARANGO-SCHEMA
sourceFunctionId: FP-TESSERA-ARANGO-SCHEMA
source_refs:
  - TESSERA-CF-SPEC
explicitness: explicit
rationale: >
  TESSERA-CF-SPEC §4.7 (WP-T1) specifies the ArangoDB schema bootstrap for the
  cloud-native Tessera: per-repo node + edge collections, persistent indexes on
  the traversal hot paths, an ArangoSearch view for BM25, and a global meta
  collection. This IS isolates the schema layer — the foundation every other
  Tessera Worker module reads or writes. No graph data, no parsing, no HTTP
  routes. Just an idempotent `initTesseraSchema(db, slug)` callable on every
  Worker startup and at first index of each repo.

  Modeled on the Factory's proven `_initDb` (GT-ARANGO): `ensureCollection` and
  `ensureIndex` are already idempotent (409 = already exists). This IS adds the
  one gap the existing `arango-client` does not cover — an `ensureView` helper
  for ArangoSearch — and wires it all into a single idempotent entrypoint.
---

# Tessera ArangoDB Schema (WP-T1 schema layer)

## JTBD

When a Tessera Worker starts up or indexes a repository for the first time, the
operator wants the ArangoDB collections, indexes, and search view for that
repository to exist and be correctly shaped, so that the indexer can load a
graph and the query tools can read it without anyone manually running database
setup commands.

## Problem

The cloud Tessera graph lives in ArangoDB (TESSERA-CF-SPEC §3), namespaced per
repo: `tessera_nodes_{slug}`, `tessera_edges_{slug}`, plus a global
`tessera_meta`. None of these collections exist yet. There is no ArangoSearch
view for BM25 search. The existing `arango-client` (GT-ARANGO) has
`ensureCollection` and `ensureIndex` but **no view helper** — ArangoSearch
views cannot be created with the current client.

Without this schema layer:
- The indexer (IS-TESSERA-INDEXER) has nowhere to write nodes or edges.
- The impact, search, and MCP tools have nothing to query.
- Every other Tessera IS is blocked.

The schema setup must be idempotent. It runs on every Worker startup and at
first index of each repo. Calling it twice — or a hundred times — must never
throw and must never corrupt or duplicate existing structure.

## Goal

Implement `initTesseraSchema(db, slug)` in `workers/tessera-worker/src/schema.ts`:

1. Ensure `tessera_nodes_{slug}` (document collection) and
   `tessera_edges_{slug}` (edge collection) exist.
2. Ensure persistent indexes on the node and edge collections covering the
   traversal and resolution hot paths (TESSERA-CF-SPEC §4.7).
3. Ensure the ArangoSearch view `tessera_search_{slug}` exists, linked over the
   nodes collection with the documented indexed fields and analyzers.
4. Ensure the global `tessera_meta` collection exists (once; not per-repo).
5. Extend the access layer with an `ensureView(name, links)` helper, since the
   current client has none (TESSERA-CF-SPEC §4.7, WP-T1).

The function is idempotent end to end: safe to call on every Worker startup.
It performs no parsing, loads no graph data, and exposes no HTTP route.

## Scope

**In scope:**
- `workers/tessera-worker/src/schema.ts` — new file: `initTesseraSchema(db, slug)`
  and supporting helpers (`ensureView`).
- Collection creation: `tessera_nodes_{slug}`, `tessera_edges_{slug}`,
  `tessera_meta`.
- Persistent indexes on nodes (`name`, `kind`, `filePath`, `name+kind`) and
  edges (`type`); reliance on ArangoDB's built-in edge index for `_from`/`_to`.
- ArangoSearch view `tessera_search_{slug}` over nodes, fields `name`,
  `filePath`, `kind`, `module`, analyzers `text_en` and `identity`.
- The slug-sanitization rule (TESSERA-CF-SPEC §4.1) as a pure helper, so callers
  derive a slug consistently.

**Out of scope:**
- Parsing source into nodes/edges (IS-TESSERA-PARSER).
- Loading graph data / the ingest transaction (IS-TESSERA-INDEXER).
- Stream-transaction / build-aside-swap atomicity helpers (IS-TESSERA-INDEXER,
  TESSERA-CF-SPEC §4.4) — this IS provides only the static schema; the atomic
  cut-over mechanism is the indexer's concern.
- Semantic / vector collections (`tessera_vectors_{slug}`) — V2.
- Any read of graph content (impact/search/MCP — separate IS files).

## Acceptance Criteria

### Collection setup (AC-C*)

**AC-C1.** `initTesseraSchema(db, slug)` ensures `tessera_nodes_{slug}` exists
as a **document** collection (default type).

**AC-C2.** `initTesseraSchema(db, slug)` ensures `tessera_edges_{slug}` exists
as an **edge** collection (`{ type: 'edge' }`).

**AC-C3.** `initTesseraSchema(db, slug)` ensures the global `tessera_meta`
document collection exists. `tessera_meta` is **not** per-repo — its name has no
slug suffix. Calling `initTesseraSchema` for multiple slugs creates exactly one
`tessera_meta` collection (the second `ensureCollection('tessera_meta')` is a
no-op via the 409 = already-exists path).

**AC-C4.** Collection creation uses the existing idempotent `ensureCollection`
semantics (GT-ARANGO): a 409 (already exists) is treated as success, not an
error.

### Index setup (AC-I*)

**AC-I1.** The following persistent indexes are ensured on
`tessera_nodes_{slug}`:
- `{ type: 'persistent', fields: ['name'] }`
- `{ type: 'persistent', fields: ['kind'] }`
- `{ type: 'persistent', fields: ['filePath'] }`
- `{ type: 'persistent', fields: ['name', 'kind'] }`

**AC-I2.** The following persistent index is ensured on `tessera_edges_{slug}`:
- `{ type: 'persistent', fields: ['type'] }`

**AC-I3.** No explicit index is created for edge `_from`/`_to` — ArangoDB's
built-in edge index covers them. The implementation must NOT attempt to create
a redundant `_from`/`_to` index.

**AC-I4.** Index creation is idempotent: a second `initTesseraSchema(db, slug)`
call does not throw on already-existing indexes (GT-ARANGO `ensureIndex`
409-tolerant behavior).

### ArangoSearch view (AC-V*)

**AC-V1.** A new `ensureView(name, links)` helper is added to the Tessera access
layer (the current `arango-client` has no view helper, TESSERA-CF-SPEC §4.7).
It issues `POST /_api/view` with `{ name, type: 'arangosearch', links }` and
treats a 409 (view already exists) as success.

**AC-V2.** `initTesseraSchema(db, slug)` ensures the ArangoSearch view
`tessera_search_{slug}` exists, linked over `tessera_nodes_{slug}` with indexed
fields `name`, `filePath`, `kind`, `module` and the analyzer set
`['text_en', 'identity']`:
```json
{
  "name": "tessera_search_{slug}",
  "type": "arangosearch",
  "links": {
    "tessera_nodes_{slug}": {
      "fields": { "name": {}, "filePath": {}, "kind": {}, "module": {} },
      "analyzers": ["text_en", "identity"]
    }
  }
}
```

**AC-V3.** After `initTesseraSchema` returns, the view accepts a BM25 query
over an empty collection without error:
```aql
FOR n IN tessera_search_{slug}
  SEARCH ANALYZER(n.name IN TOKENS(@q, 'text_en'), 'text_en')
  SORT BM25(n) DESC
  LIMIT 10
  RETURN n
```
returns `[]` (no rows, no error) when the nodes collection is empty.

**AC-V4.** The `text_en` analyzer is assumed to be a built-in ArangoDB analyzer.
If the deployment does not have `text_en` available, `ensureView` surfaces the
ArangoDB error verbatim — it does NOT silently fall back to `identity`. (Analyzer
provisioning is a Container-setup concern, not this function's responsibility,
but the failure must be visible, not swallowed.)

### Idempotency (AC-IDEM*)

**AC-IDEM1.** Calling `initTesseraSchema(db, slug)` twice in succession for the
same slug does not throw. Every collection, index, and view operation tolerates
the already-exists condition.

**AC-IDEM2.** Calling `initTesseraSchema(db, slug)` is safe to invoke on every
Worker startup. It performs no destructive operation: it never drops, never
truncates, never deletes. (Truncation belongs to the indexer's full-rebuild
ingest, IS-TESSERA-INDEXER — not to schema init.)

**AC-IDEM3.** After two calls, querying an empty `tessera_nodes_{slug}` returns
`[]` and querying an empty `tessera_edges_{slug}` returns `[]` (the collections
exist and are queryable, just empty).

### Slug derivation (AC-S*)

**AC-S1.** A pure `slugForRepo(fullName: string): string` helper derives the
slug using **name-only** (the repo name without owner): lowercase the `name`
component of `owner/name`, replace any character not in `[a-z0-9_-]` with `_`.
Example: `Wescome/gascity` → `gascity`, `Wescome/function-factory` →
`function-factory`. The owner is discarded unless a collision occurs (AC-S2).
The chosen rule is recorded in `tessera_meta` so `list_repos` can map slug ↔
full name (AC-S3).

**AC-S2.** Collision disambiguation: when two distinct full names sanitize to the
same slug, the helper appends a short hash of the full name (TESSERA-CF-SPEC
§4.1). The exact short-hash length is the implementer's choice (document it);
the invariant is that distinct repos never share a slug.

**AC-S3.** The slug ↔ full-name mapping is the responsibility of the
`tessera_meta` document writer (IS-TESSERA-INDEXER), not this IS. This IS only
provides the deterministic `slugForRepo` helper that both the schema layer and
the indexer call. `initTesseraSchema` itself takes an already-derived `slug`.

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user (basic auth) |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"function_factory"`) | ArangoDB database name (shared with the Factory artifact store) |

The `db` argument to `initTesseraSchema` is an `arango-client` instance
constructed from these env vars via the existing `createClientFromEnv`
(GT-ARANGO). If the Container's ArangoDB is fronted by a CF service binding
(e.g. `FF_ARANGO`), `createClientFromEnv` picks it up — no change here.

## Non-negotiables

- `initTesseraSchema` is idempotent and **non-destructive**. It never drops,
  truncates, or deletes (AC-IDEM2).
- `tessera_meta` is global (one collection, no slug suffix) (AC-C3).
- No redundant `_from`/`_to` index on the edge collection (AC-I3).
- The `ensureView` helper treats 409 as success but surfaces all other
  ArangoDB errors verbatim — no silent analyzer fallback (AC-V1, AC-V4).
- Schema init loads no graph data and parses no source. Those are downstream
  IS files.
- Tessera collections share the Factory's ArangoDB Container (G2,
  shared-Container citizenship): per-repo collection namespacing only; no
  cross-repo collisions.

## Success Metrics

`initTesseraSchema(db, slug)` is callable on every Worker startup without error,
creates the per-repo node and edge collections and the global meta collection,
ensures all persistent indexes on the traversal and resolution hot paths, and
creates an ArangoSearch view that accepts BM25 queries over an empty collection.

A second invocation for the same slug is a clean no-op: no exception, no
duplicate structure, no data loss. Querying the freshly created (empty)
collections returns `[]` rather than erroring, proving the schema is queryable
before any graph data is loaded.

The new `ensureView` helper closes the one documented gap in the existing
`arango-client` (no view support, GT-ARANGO / §4.7), and does so without
swallowing ArangoDB errors other than the idempotent already-exists case.

The slug-derivation helper is deterministic and collision-safe, so every
downstream Tessera module (indexer, impact, search, MCP) addresses the same
collections for a given repository.
