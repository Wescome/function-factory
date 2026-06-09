# ADR-0013: LadybugDB Closed-Loop Artifact Graph

Date: 2026-06-08
Status: Proposed
Deciders: Wes
Technical Story: Replace ArangoDB as the Factory runtime artifact store with LadybugDB (Kuzu WASM) embedded in a Cloudflare Durable Object, closing the loop between Tessera's dev-time code intelligence graph and the Factory's runtime lineage graph.

---

## Context and Problem Statement

The Factory currently maintains two disconnected graphs:

1. **Dev-time graph (Tessera)** — LadybugDB (Kuzu WASM) indexed at `~/.tessera/function-factory/index.lbug`. Contains 15,467 code symbols, execution flows, and Factory-domain node types (`Signal`, `Pressure`, `Specification`, `Agent`, `Elucidation`). Queryable via Cypher. MCP-integrated with Claude Code. Local only.

2. **Runtime artifact graph (ArangoDB)** — ArangoDB 3.12 running as a CF Container Worker (`ff-arango`). Stores IS, ES, EP, VR, lineage edges (`source_refs`), dispatch logs, coherence verdicts. Queryable via AQL. Remote, always-on, billed per request.

These two graphs cannot be queried together. An operator cannot answer "what factory function produced do-5934, which code symbols did it change, and which upstream callers are at risk?" in a single traversal. The lineage is fragmented across two stores, two query languages, and two runtimes.

The Tessera schema already defines `Specification`, `Agent`, `Signal`, `Pressure` node types — it was designed to hold Factory artifacts. The same Cypher-capable property graph engine (LadybugDB/Kuzu) can run in a CF Durable Object via its WASM build (`@ladybugdb/wasm-core`).

---

## Decision Drivers

- Eliminate ArangoDB cold-boot latency and Container Worker cost
- Unify code intelligence and artifact lineage in one query surface (Cypher)
- Enable "closed loop" traversal: IS → ES → EP → VR → code symbols → callers
- Make the Factory's own artifacts queryable by the same tools that analyze its codebase (Tessera MCP)
- Preserve the lineage invariants (INV-5, `source_refs` null-check)

---

## Considered Options

### Option A — Keep ArangoDB, Add GraphQL Facade
Add a GraphQL Worker in front of ArangoDB. No migration. Adds indirection without closing the dev-time/runtime gap.

### Option B — LadybugDB in a CF Durable Object (Proposed)
Embed `@ladybugdb/wasm-core` in a new `ArtifactGraph` DO. The DO serves as the runtime artifact store, replacing `ff-arango`. Tessera's local index and the CF DO share the same schema — Factory artifacts written at runtime are readable by Tessera tooling at dev-time via a sync/export mechanism.

### Option C — LadybugDB in a CF Worker (stateless)
Use LadybugDB WASM in a stateless Worker with R2-backed persistence. Avoids DO complexity but loses transactional consistency and connection pooling.

---

## Decision Outcome

**Chosen: Option B — LadybugDB in a CF Durable Object**

### Rationale

The DO gives LadybugDB what it needs: a single-writer serialization model (DO single-writer = LadybugDB's concurrency model), durable storage for the `.lbug` file, and a long-lived process for the WASM module to stay warm. Tessera's existing schema (`Specification`, `Agent`, `Signal` etc.) becomes the canonical schema for both planes.

The "closed loop" is:

```
Factory runtime (CF DO)          Dev-time (Tessera local)
─────────────────────            ────────────────────────
ArtifactGraph DO                 ~/.tessera/function-factory/
  LadybugDB WASM                   LadybugDB native
  Cypher over artifacts    ←sync→  Cypher over code symbols
  IS, ES, EP, VR, lineage          File, Function, Class, Route
  runtime writes                   code analysis reads
```

An operator running `tessera_query` against the function-factory index can traverse from `(s:Specification)-[:CodeRelation]->(f:Function)` — crossing the artifact/code boundary — once the sync bridge is active.

---

## Implementation Plan

### Phase 1 — ArtifactGraph DO (replaces ff-arango)

**New Worker: `ff-graph`**
- `ArtifactGraph` extends `DurableObject`
- Embeds `@ladybugdb/wasm-core`
- Persists `.lbug` to DO storage (small graphs) or R2 (large graphs, > 50MB)
- Exposes: `POST /query` (Cypher), `POST /write` (node/edge upsert), `GET /export` (snapshot for Tessera sync)
- Schema: extends Tessera's existing schema, adding Factory-runtime node types not in the code graph: `ExecutionPacket`, `DispatchLog`, `FidelityVerdict`

**Migration from ff-arango:**
- AQL → Cypher query translation for the 9 governor queries (Q1–Q9)
- `source_refs` null-check (INV-5) becomes: `MATCH (a:Specification) WHERE a.source_refs IS NULL RETURN a`
- ff-pipeline's `ArangoClient` → new `GraphClient` pointing at `ff-graph`
- ff-arango Container Worker retired after migration validated

### Phase 2 — Tessera Sync Bridge

**Tessera group bridge** (`tessera group add function-factory-runtime --bridge ff-graph`):
- Tessera pulls artifact snapshot from `ArtifactGraph DO /export`
- Writes into `~/.tessera/groups/factory-runtime/bridge.lbug`
- Cross-repo edges: `(Specification)-[:IMPLEMENTED_BY]->(Function)` linking Factory artifact IDs to code symbols

**Result:** `tessera_query("find all functions touched by IS-GC-DISPATCH-WIRE")` traverses both graphs in one Cypher query.

### Phase 3 — GraphQL Facade (optional)

A GraphQL Worker in front of `ArtifactGraph DO` for external consumers. Not required for the closed loop, but useful for tooling (dashboards, IDE extensions).

---

## Open Questions (Architecture Gates)

| # | Question | Owner |
|---|----------|-------|
| G1 | What is LadybugDB WASM cold-start in a DO? Acceptable for synchronous queries? | Wes |
| G2 | DO storage vs R2 for `.lbug` file — what's the graph size ceiling before R2 is required? | Wes |
| G3 | Tessera sync bridge: push (DO emits on write) or pull (Tessera polls)? | Wes |
| G4 | AQL → Cypher migration: are all 9 governor queries expressible in Cypher without loss? | Architect |

---

## Consequences

**Positive:**
- One query language (Cypher) for both artifact lineage and code intelligence
- ArangoDB Container Worker eliminated — removes cold-boot, reduces cost
- Tessera MCP tools gain runtime artifact awareness
- INV-5 lineage gap detection becomes a Cypher query in the DO, not an ArangoDB AQL call
- Factory is self-describing: its own artifacts are queryable by the same tools it uses to analyze code

**Negative:**
- LadybugDB WASM cold-start in DO is unmeasured — may be unacceptable for synchronous dispatch path
- Migration risk: AQL → Cypher for 9 production queries, all must be validated
- DO single-writer bottleneck under concurrent molecule dispatches (same constraint as FactoryStore DO)
- `@ladybugdb/wasm-core` is pre-1.0 (v0.17.1) — stability risk

**Mitigation for cold-start risk:** keep ff-arango running in parallel during Phase 1 validation. Only retire after G1 is answered.
