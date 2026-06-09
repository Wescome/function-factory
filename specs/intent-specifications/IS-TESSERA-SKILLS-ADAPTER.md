---
id: IS-TESSERA-SKILLS-ADAPTER
version: 1
title: "Tessera Skills Adapter — index k-dense scientific skills as a queryable capability graph"
sourceCapabilityId: BC-TESSERA-SKILLS-ADAPTER
sourceFunctionId: FP-TESSERA-SKILLS-ADAPTER
source_refs:
  - TESSERA-CF-SPEC
  - BC-TESSERA-SKILLS-ADAPTER
  - IS-TESSERA-SPEC-ADAPTER
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
  - IS-TESSERA-IMPACT
explicitness: explicit
rationale: >
  Tessera's DomainAdapter interface is implemented three times already: for `code`
  (tree-sitter), for `management` (Strategy.Recipes), and for `spec` (Factory
  artifacts, IS-TESSERA-SPEC-ADAPTER). The skills adapter is a fourth DomainAdapter
  that indexes the WeOps k-dense scientific skill corpus (134+ SKILL.md files plus
  the compiled `skill_definitions.json` registry) as a graph of capabilities,
  domains, and inter-tool relationships. Once indexed, every Tessera MCP tool works
  on the skill graph unchanged: `tessera_impact` on a Skill shows which other skills
  depend on it; `tessera_context` on a Skill shows its domain and ecosystem
  neighbors; `tessera_query` finds skills by scientific concept.

  This IS adds no new Tessera interface and no new tool. It composes the existing
  per-repo ArangoDB collections (IS-TESSERA-ARANGO-SCHEMA), the existing ingest path
  (IS-TESSERA-INDEXER), and the existing impact traversal (IS-TESSERA-IMPACT) by
  supplying one more DomainAdapter implementation, structurally identical to the
  spec adapter. The ecosystem knowledge currently buried in SKILL.md prose ("for
  deep learning models use scvi-tools; for data format questions use anndata")
  becomes queryable graph edges.
---

# Tessera Skills Adapter (fourth DomainAdapter — scientific capability graph)

## JTBD

When an agent needs to select the right scientific tool for a task, it wants to
know which skills exist in that domain and how they relate to each other, so it
picks the right tool instead of guessing or using a deprecated one.

## Problem

The WeOps k-dense corpus holds 134+ scientific agent skills. Each lives as a
`SKILL.md` file with YAML frontmatter (`name`, `description`, `allowed-tools`,
`license`) and a prose body that encodes ecosystem relationships in natural
language: "For deep learning models use scvi-tools; for data format questions use
anndata", "Use Leiden over Louvain", "see also squidpy, cellrank". The same skills
are compiled into `corpus/skill_definitions.json` as `SkillDefinition` records
(`skill_id`, `skill_name`, `domain`, `description`, `external_dependencies`). The
harness runs them through WeOps governance — they ARE governed capabilities.

But the relationships between skills are invisible to agents. There is no graph
that answers "what skills relate to single-cell RNA-seq?" or "if rdkit changes,
what other cheminformatics skills depend on it?" The "use X not Y" knowledge is
trapped in prose. The only way to find a related skill is to read every SKILL.md.

Tessera already solves exactly this shape of problem: a graph of typed nodes and
typed edges, with impact, context, and query tools over it. The graph engine, the
per-repo ArangoDB collections, and the MCP surface all exist. What is missing is a
`DomainAdapter` that turns the skill corpus into that graph.

## Goal

1. Implement `SkillsAdapter` in
   `workers/tessera-worker/src/adapters/skills-adapter.ts` implementing the
   existing `DomainAdapter` interface (the same interface as the code and spec
   adapters in `tessera/src/core/domain-adapter.ts`).
2. The adapter parses each `SKILL.md` (YAML frontmatter for `name`, `description`,
   `license`; domain from `skill_definitions.json` join or `skill_id` prefix) and
   emits a `Skill` node, plus a `Domain` node per distinct domain.
3. The adapter pattern-matches the SKILL.md body for explicit ecosystem references
   ("for X use Y", "use X not Y", "prefer X over Y", "alternative: X", "see also
   X") and emits `USE_WITH` / `ALTERNATIVE_TO` / `COVERS` / `PART_OF` edges.
4. Register the adapter in the Tessera Worker so the indexer uses it when
   `language = "skills"` or when file patterns
   `corpus/k-dense-skills/scientific-skills/*/SKILL.md,corpus/skill_definitions.json`
   are matched.
5. After indexing, `tessera_impact` on `scanpy` returns the cheminformatics /
   single-cell skills that reference it (`anndata`, `scvi-tools`,
   `cellxgene-census`).

## Scope

**In scope:**
- `workers/tessera-worker/src/adapters/skills-adapter.ts` — new file:
  `SkillsAdapter` implementing `DomainAdapter`.
- filePatterns: `corpus/k-dense-skills/scientific-skills/*/SKILL.md` and
  `corpus/skill_definitions.json`.
- YAML frontmatter parsing: `name` → node name, `description` and `license` →
  node properties; `domain` from the `skill_definitions.json` join (matched on
  `skill_name`) or, when absent, from the `skill_id` prefix.
- Body-text pattern matching for `USE_WITH` / `ALTERNATIVE_TO` / `COVERS`
  relationships on a closed set of common phrases (see AC-SK3).
- `Domain` nodes and `PART_OF` edges (Skill PART_OF Domain).
- Registration of the adapter in the indexer (selected on `language = "skills"` or
  the skills file-pattern match).

**Out of scope:**
- Semantic analysis of full SKILL.md body text beyond the closed phrase set (V2).
- Automatic domain classification beyond what is in `skill_id` / frontmatter /
  `skill_definitions.json` (V2).
- Any change to the `DomainAdapter` interface itself — the adapter conforms to the
  existing shape, it does not extend it.
- The impact/context/query tools themselves (IS-TESSERA-IMPACT and the MCP IS) —
  this IS only supplies the adapter that feeds them.
- Indexing `allowed-tools`, `scripts/`, `references/`, or `assets/` referenced
  inside a SKILL.md (V2).

## Acceptance Criteria

### Interface conformance (AC-SK*)

**AC-SK1.** `SkillsAdapter` implements the `DomainAdapter` interface — `id`,
`name`, `filePatterns`, `extract()`, `resolveRelations()` — with the exact
signatures of the existing code and spec adapters
(`tessera/src/core/domain-adapter.ts`). No interface member is added, removed, or
re-typed. (Same conformance requirement as IS-TESSERA-SPEC-ADAPTER AC-SA1.)

**AC-SK2.** `extract(file)` parses each `SKILL.md` and emits one `Skill` node with
`name` = the frontmatter `name`, `kind` = `"Skill"`, and
`properties = { domain, description, license }`. `domain` is resolved by joining
on `skill_name` against `skill_definitions.json`; if no join row exists, `domain`
falls back to the `skill_id` prefix and, failing that, to `"unknown"`.

**AC-SK3.** `resolveRelations(entities)` extracts explicit ecosystem references
from the SKILL.md body on a closed phrase set and emits typed edges:
- "for X use Y" / "for X, use Y" → `USE_WITH` (this skill → Y) for the named
  alternative-context tool.
- "use X not Y" / "use X over Y" / "prefer X over Y" / "X instead of Y" →
  `ALTERNATIVE_TO` (this skill → the deprecated/alternate tool).
- "alternative: X" / "alternatives: X, Z" → `ALTERNATIVE_TO`.
- "see also X" / "related tools: X" → `USE_WITH`.
- A skill that names a database, format, or external tool it operates on
  (e.g. ClinicalTrials.gov, .h5ad, 10X) → `COVERS` (skill → that target name).
Each edge target is emitted only if it resolves to another indexed `Skill` node's
name (for `USE_WITH` / `ALTERNATIVE_TO`) or to a `COVERS` target string node.

**AC-SK4.** After indexing the k-dense corpus, `tessera_impact` on `scanpy`
returns `anndata`, `scvi-tools`, and `cellxgene-census` in the impacted set —
each of those SKILL.md bodies references `scanpy` in a "for analysis workflows use
scanpy" / "see also scanpy" phrase, producing inbound edges to `scanpy`.

**AC-SK5.** `tessera_query` for "drug discovery" returns `rdkit`, `deepchem`,
`datamol`, and `diffdock` in the top results (ranked by description / domain
relevance over the indexed `Skill` nodes).

**AC-SK6.** Skills whose SKILL.md body contains no matchable ecosystem phrase
still index as `Skill` nodes with no outgoing relationship edges. Isolated skills
are valid; no node is dropped and no error is thrown.

### Domain nodes (AC-DOM*)

**AC-DOM1.** Each distinct `domain` value (from `skill_definitions.json` or
`skill_id` prefix — e.g. `genomics`, `bioinformatics`, `cheminformatics`,
`clinical`) is emitted once as a `Domain` node, `kind = "Domain"`.

**AC-DOM2.** Every `Skill` node emits a `PART_OF` edge to its `Domain` node
(Skill PART_OF Domain). A skill whose domain resolved to `"unknown"` still emits a
`PART_OF` edge to a `Domain{name:"unknown"}` node.

### Robustness (AC-ROB*)

**AC-ROB1.** A `SKILL.md` with no parseable frontmatter `name` is skipped — no
node is created and no error is thrown. (Same tolerance as
IS-TESSERA-SPEC-ADAPTER AC-ROB1.)

**AC-ROB2.** An ecosystem reference that does not resolve to any indexed `Skill`
name (a dangling "use Y" where Y is not in the corpus) is skipped for
`USE_WITH` / `ALTERNATIVE_TO`, not errored. The referencing skill's other edges
are still emitted. (Same tolerance as IS-TESSERA-SPEC-ADAPTER AC-ROB2.)

**AC-ROB3.** A SKILL.md present on disk but absent from `skill_definitions.json`
(and vice versa) is tolerated: the file-based node is authoritative for `Skill`
nodes; `skill_definitions.json` only enriches `domain` and never blocks
indexing.

## Registration

The adapter is selected by the indexer in two equivalent ways (either is
acceptable; document which is wired):
- Explicit: `language = "skills"` on the IndexJob selects `SkillsAdapter`.
- Pattern: a tarball whose tracked files match
  `corpus/k-dense-skills/scientific-skills/*/SKILL.md,corpus/skill_definitions.json`
  routes through `SkillsAdapter.filePatterns`.

The adapter writes into the same per-repo collections as every other domain
(`tessera_nodes_{slug}`, `tessera_edges_{slug}`) via IS-TESSERA-ARANGO-SCHEMA; for
the WeOps k-dense corpus the slug is `weops-enterprise`. Indexed alongside the
governance adapter (IS-TESSERA-GOVERNANCE-ADAPTER) into the same slug, the `Skill`
nodes become the targets of governance `GOVERNS` edges, yielding the full governed
capability graph.

## Node kinds and edge types

| Source | Graph element | Value |
|--------|---------------|-------|
| SKILL.md frontmatter `name` | node `name`, `kind` | `Skill` |
| `description` / `license` / `domain` | node properties | string fields |
| Distinct domain value | node `kind` | `Domain` |
| "for X use Y" / "see also X" | edge | `USE_WITH` (skill → tool) |
| "use X not Y" / "prefer X over Y" / "alternative: X" | edge | `ALTERNATIVE_TO` (skill → tool) |
| Named database / format / tool the skill operates on | edge | `COVERS` (skill → target) |
| Skill → its domain | edge | `PART_OF` (skill → domain) |

## Environment dependencies

Same as IS-TESSERA-ARANGO-SCHEMA (inherits the ArangoDB env vars). No additional
env vars.

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user (basic auth) |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"weops_enterprise"`) | ArangoDB database name (shared with the governance adapter graph) |

## Non-negotiables

- `SkillsAdapter` implements the exact `DomainAdapter` interface — no interface
  changes.
- Ecosystem-reference edges only connect to skills in the same index run (dangling
  references are skipped, not errors) (AC-ROB2).
- File patterns must match only `SKILL.md` files under
  `corpus/k-dense-skills/scientific-skills/*/` and `skill_definitions.json` — no
  other markdown is indexed.
- The adapter pattern-matches body text only on the closed phrase set in AC-SK3 —
  no LLM call, no full-text semantic analysis (semantic content analysis is V2).
- A SKILL.md is authoritative for the `Skill` node; `skill_definitions.json` only
  enriches `domain` and never blocks indexing (AC-ROB3).
- Isolated skills (no ecosystem references) are valid nodes (AC-SK6).

## Success Metrics

`SkillsAdapter` conforms to the existing `DomainAdapter` interface and is selected
by the indexer for the k-dense corpus without any change to the interface or the
ingest pipeline. After one index run over the 134+ SKILL.md files, the scientific
capability graph is queryable through the unchanged Tessera MCP tools.

`tessera_impact` on a skill returns the other skills that reference it, so an
agent can see the blast radius before assuming a tool change is local.
`tessera_query` on a scientific concept returns the relevant skills ranked by
relevance, so an agent selects the right tool instead of guessing.
`tessera_context` on a skill returns its domain (via `PART_OF`) and its ecosystem
neighbors (via `USE_WITH` / `ALTERNATIVE_TO` / `COVERS`).

Malformed SKILL.md files (no parseable name) and dangling ecosystem references are
tolerated without error, so the index is robust to an evolving corpus. Skills with
no ecosystem references still index as valid isolated nodes. Indexed alongside the
governance adapter into the same slug, the `Skill` nodes form the leaf layer of the
full governed capability graph.
