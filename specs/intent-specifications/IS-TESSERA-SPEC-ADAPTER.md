---
id: IS-TESSERA-SPEC-ADAPTER
version: 1
title: "Tessera Spec Adapter — index Factory specification artifacts as a queryable graph"
sourceCapabilityId: BC-TESSERA-SPEC-ADAPTER
sourceFunctionId: FP-TESSERA-SPEC-ADAPTER
source_refs:
  - TESSERA-CF-SPEC
  - BC-TESSERA-SPEC-ADAPTER
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
  - IS-TESSERA-IMPACT
explicitness: explicit
rationale: >
  Tessera has a DomainAdapter interface already implemented twice: for `code`
  (tree-sitter) and for `management` (Strategy.Recipes). The spec adapter is a
  third domain adapter that indexes the Factory's own specification artifacts
  (IS-*, ES-*, BC-*, PRS-*, FP-*, SIG-*) as graph nodes, with edges representing
  the `source_refs` relationships. Once indexed, every Tessera MCP tool works on
  the spec graph unchanged: `tessera_impact` on a BC-* shows all IS/ES/FP that
  depend on it; `tessera_context` on an IS-* shows its full source_refs chain;
  `tessera_query` finds specs by concept.

  This IS adds no new Tessera interface and no new tool. It composes the existing
  per-repo ArangoDB collections (IS-TESSERA-ARANGO-SCHEMA), the existing ingest
  path (IS-TESSERA-INDEXER), and the existing impact traversal (IS-TESSERA-IMPACT)
  by supplying one more DomainAdapter implementation. The Factory gains the same
  blast-radius safety for its specifications that it already has for its code.
---

# Tessera Spec Adapter (third DomainAdapter — specification graph)

## JTBD

When the Factory wants to change a capability (BC-*) or pressure (PRS-*), it wants
to know which intent specifications and executable specifications reference it, so
it can assess the blast radius of the change before editing anything.

## Problem

The Factory's specification artifacts are stored as YAML/Markdown files with
`source_refs` arrays. These form a DAG (IS → BC, ES → IS, FP → BC, etc.) but the
DAG is invisible to agents. Changing `BC-GC-FORMULA-DISPATCH.yaml` might break 3
IS files — no tool surfaces this. The only way to find referencing artifacts is
manual `grep`.

Tessera already solves exactly this shape of problem for code: a graph of nodes
and `source_refs`-style edges, with impact, context, and query tools over it. The
graph engine, the per-repo ArangoDB collections, and the MCP surface all exist.
What is missing is a `DomainAdapter` that turns the spec corpus into that graph.

## Goal

1. Implement `SpecAdapter` in `workers/tessera-worker/src/adapters/spec-adapter.ts`
   implementing the existing `DomainAdapter` interface (the same interface as the
   code adapter in `tessera/src/core/domain-adapter.ts`).
2. The adapter walks `specs/` directories (IS-*, ES-*, BC-*, PRS-*, FP-*, SIG-*),
   extracts each artifact as a node (kind = artifact type, name = artifact id,
   properties = title/description/version), and extracts `source_refs` arrays as
   REFERENCES edges.
3. Register the adapter in the Tessera Worker so the indexer uses it when
   `language = "spec"` or when file patterns `specs/**/*.yaml,specs/**/*.md` are
   matched.
4. After indexing, `tessera_impact` on `BC-GC-FORMULA-DISPATCH` returns every
   IS/ES/FP that references it.

## Scope

**In scope:**
- `workers/tessera-worker/src/adapters/spec-adapter.ts` — new file: `SpecAdapter`
  implementing `DomainAdapter`.
- Registration of the adapter in the indexer (selected on `language = "spec"` or
  the spec file-pattern match).
- Node kinds: IS, ES, BC, PRS, FP, SIG, FN (derived from the artifact id prefix).
- Edge type: REFERENCES (derived from `source_refs`).

**Out of scope:**
- Semantic analysis of spec content (V2).
- Indexing non-spec markdown files (CLAUDE.md, README.md, etc.).
- Cross-repo spec indexing (V2).
- Any change to the `DomainAdapter` interface itself — the adapter conforms to the
  existing shape, it does not extend it.
- The impact/context/query tools themselves (IS-TESSERA-IMPACT and the MCP IS) —
  this IS only supplies the adapter that feeds them.

## Acceptance Criteria

### Interface conformance (AC-SA*)

**AC-SA1.** `SpecAdapter` implements the `DomainAdapter` interface — `id`, `name`,
`filePatterns`, `extract()`, `resolveRelations()` — with the exact signatures of
the existing code adapter (`tessera/src/core/domain-adapter.ts`). No interface
member is added, removed, or re-typed.

**AC-SA2.** `filePatterns` matches `specs/intent-specifications/*.md`,
`specs/capabilities/*.yaml`, `specs/executable-specifications/*.yaml`,
`specs/pressures/*.yaml`, and `specs/functions/*.yaml`. It does **not** match
`README.md`, `CLAUDE.md`, or any non-spec file.

**AC-SA3.** `extract(file)` parses the YAML frontmatter (or the `---` frontmatter
block in a `.md` file), extracts `id` as the node `name`, the artifact-type prefix
(BC / IS / ES / PRS / FP / SIG / FN) as the node `kind`, and `title` / `name` /
`description` as node properties. `version` is captured when present.

**AC-SA4.** `resolveRelations(entities)` reads each entity's `source_refs` array
and emits one REFERENCES edge for every ref that resolves to another entity's `id`
in the same index. The edge runs from the referencing artifact to the referenced
artifact (`source_refs` points at what the artifact depends on).

### Behavior over the real corpus (AC-IDX*)

**AC-IDX1.** After indexing function-factory `specs/`, `tessera_impact` on
`BC-GC-FORMULA-DISPATCH` returns `IS-GC-DISPATCH-WIRE` and
`IS-GC-EP-FORMULA-DISPATCH` in the impacted set (the artifacts whose `source_refs`
name that BC-*).

**AC-IDX2.** `tessera_context` on `IS-TESSERA-IMPACT` returns its `source_refs` as
outgoing REFERENCES edges (to `TESSERA-CF-SPEC`, `IS-TESSERA-ARANGO-SCHEMA`,
`IS-TESSERA-INDEXER`), and any ES that references it as incoming REFERENCES edges.

### Robustness (AC-ROB*)

**AC-ROB1.** Artifacts with no parseable frontmatter `id` are skipped — no node is
created and no error is thrown.

**AC-ROB2.** A `source_refs` entry that does not resolve to any indexed artifact's
`id` (a dangling reference) is skipped, not errored. The referencing artifact's
other edges are still emitted.

## Registration

The adapter is selected by the indexer in two equivalent ways (either is
acceptable; document which is wired):
- Explicit: `language = "spec"` on the IndexJob selects `SpecAdapter`.
- Pattern: a tarball whose tracked files match `specs/**/*.yaml,specs/**/*.md`
  routes through `SpecAdapter.filePatterns`.

The adapter writes into the same per-repo collections as every other domain
(`tessera_nodes_{slug}`, `tessera_edges_{slug}`) via IS-TESSERA-ARANGO-SCHEMA; for
the function-factory spec corpus the slug is `function-factory`.

## Node kinds and edge types

| Source | Graph element | Value |
|--------|---------------|-------|
| Artifact id prefix | node `kind` | `IS`, `ES`, `BC`, `PRS`, `FP`, `SIG`, `FN` |
| Artifact `id` | node `name` | e.g. `BC-GC-FORMULA-DISPATCH` |
| `title` / `name` / `description` / `version` | node properties | string fields |
| `source_refs` entry | edge | `REFERENCES` (referencing → referenced) |

## Environment dependencies

Same as IS-TESSERA-ARANGO-SCHEMA (inherits the ArangoDB env vars). No additional
env vars.

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user (basic auth) |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"function_factory"`) | ArangoDB database name (shared with the Factory artifact store) |

## Non-negotiables

- `SpecAdapter` implements the exact `DomainAdapter` interface — no interface
  changes.
- `source_refs` edges only connect to artifacts in the same index run (dangling
  refs are skipped, not errors) (AC-ROB2).
- File patterns must not match non-spec files (README.md, CLAUDE.md, etc.)
  (AC-SA2).
- The adapter parses no spec *content* semantically — only frontmatter id, type,
  title/description/version, and `source_refs` (semantic content analysis is V2).
- No cross-repo spec indexing in V1 — only the local function-factory `specs/`.

## Success Metrics

`SpecAdapter` conforms to the existing `DomainAdapter` interface and is selected by
the indexer for the spec corpus without any change to the interface or the ingest
pipeline. After one index run over function-factory `specs/`, the specification
DAG is queryable through the unchanged Tessera MCP tools.

`tessera_impact` on a capability (BC-*) returns the intent and executable
specifications that reference it, so the Factory can see the blast radius of a
capability change before editing anything. `tessera_context` on an intent
specification returns its full `source_refs` chain as outgoing edges and its
referencers as incoming edges.

Malformed artifacts (no parseable id) and dangling `source_refs` are tolerated
without error, so the index is robust to an in-progress spec corpus. Non-spec files
are never indexed, so the specification graph contains only specification
artifacts.
