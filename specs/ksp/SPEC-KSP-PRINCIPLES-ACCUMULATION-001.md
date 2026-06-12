# SPEC-KSP-PRINCIPLES-ACCUMULATION-001
## Architecture Principles Accumulation Store

**Version**: 1.0
**Status**: Draft
**Author**: Wislet J. Celestin / Koales.ai
**Depends on**: SPEC-KSP-SOURCE-GRAPH-001 (Source Graph must be deployed)

---

## 1. Purpose

The Source Graph is the architecture principles accumulation store. Every source of architectural wisdom — internal and external — accumulates into the same queryable graph via the management adapter's existing `deliberation-workspace.json` ingestion path.

The store grows continuously:
- Factory codebase → code adapter → Source Graph
- Reversa SDDs → reversa adapter → Source Graph
- SR deliberation workspaces → management adapter → Source Graph
- External books, papers, patterns → RAG pipeline → `deliberation-workspace.json` → management adapter → Source Graph
- Amendment adoptions → Bridge Point 6 → Source Graph

No custom adapter is needed for external knowledge sources. The SR deliberation format (`deliberation-workspace.json`) is the universal ingestion contract.

---

## 2. External Knowledge Ingestion

### Flow

```
External source (PDF, paper, doc)
        ↓
  Existing RAG pipeline
        ↓
  LLM extracts structured objects
        ↓
  deliberation-workspace.json
        ↓
  Management adapter
        ↓
  Source Graph (D1 + Vectorize)
```

### LLM extraction prompt (sketch)

Given a chunk of architectural text, extract SR deliberation objects:

- Patterns, capabilities, best practices → `capability`
- Failure modes, anti-patterns → `risk`
- Principles, claims, theses → `thesis`
- Hard constraints, security rules → `constraint`
- Design decisions → `decision`
- Success metrics → `metric`
- Tradeoffs → `tradeoff`
- Supporting evidence → `evidence`

Connections between objects use SR connection types: `supports`, `contradicts`, `constrains`, `validates`, `threatens`, `depends_on`, `tradeoff_with`.

### Output format

Standard `deliberation-workspace.json` as defined in `strategy-recipes/packages/strategy-objects/src/index.ts`. The management adapter reads this format unchanged.

---

## 3. Seed Sources

Initial ingestion targets:
- *Patterns for Building AI Agents* — Bhagwat & Gienow (2025). 22 patterns across agent configuration, context engineering, evals, security.
- *Principles of Building AI Agents* — Bhagwat, 3rd Ed (2026). Foundations: prompting, agent building, workflows, RAG, multi-agent, observability, coding agents.

One `deliberation-workspace.json` per book. Stored in `specs/ksp/workspaces/`.

---

## 4. Query Value

Once ingested, the Source Graph answers cross-cutting questions:

- `query('context failure modes')` → surfaces both factory code handling context limits AND the book's "Avoid Context Failure Modes" pattern
- `query('parallelize agents')` → factory's `AtomExecutor` parallel dispatch AND book's "Parallelize Carefully" pattern
- `query('agent security guardrails')` → factory's `cf-gates.ts` AND book's "Prevent the Lethal Trifecta" constraint
- `impact('coderProfile')` → code blast radius AND which architectural principles reference agent profile selection

The cross-references between principles and code emerge automatically via shared vocabulary in the graph's hybrid BM25+vector search.

---

## 5. Accumulation Invariant

**INV-PA-001 — No custom adapters for external knowledge.** External sources are always ingested via RAG → `deliberation-workspace.json` → management adapter. The management adapter is the single ingestion path for all SR-format knowledge. Building custom adapters for specific external sources is prohibited.

**INV-PA-002 — One workspace per source.** Each external source (book, paper, doc) produces one `deliberation-workspace.json` file. The management adapter ingests it as a unit.

**INV-PA-003 — SR format is the contract.** The LLM extraction step must produce valid SR objects (`DeliberationObjectType`, `ConnectionType`) as defined in `strategy-recipes/packages/strategy-objects`. The RAG pipeline is free to use any chunking/embedding strategy internally.

---

## 6. Implementation Ordering

1. Deploy Source Graph (SPEC-KSP-SOURCE-GRAPH-001).
2. Run RAG pipeline on both seed books → produce `deliberation-workspace.json` for each.
3. Store workspace files in `specs/ksp/workspaces/`.
4. Run Source Graph analysis with management adapter → workspaces ingested.
5. Verify: `query('agent failure modes')` returns nodes from book workspaces.
6. Add new external sources as `deliberation-workspace.json` files in `specs/ksp/workspaces/` — no code changes required.
