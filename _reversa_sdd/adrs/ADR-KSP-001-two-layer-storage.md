# ADR-KSP-001: Two-Layer Storage Architecture (Artifact Graph vs. Bead Graph)

**Status**: Accepted
**Date**: 2026-06-10
**Deciders**: Wislet J. Celestin / Koales.ai
**Context**: SPEC-KSP-ARCH-001, SPEC-KSP-ARTIFACT-GRAPH-001, SPEC-KSP-BEAD-GRAPH-001

---

## Context

The Knowing-State Prosthesis architecture must persist two fundamentally different categories of information:

1. The **lineage record**: what was specified, what was executed, what diverged, what was proposed to fix it, what verified correctness, what was foreclosed (ElucidationArtifact). This is the audit trail — it never changes after the fact.

2. The **governing content**: the knowing-state that an executing agent retrieves at the moment of execution. This is what makes executions lawful. It must be retrievable sub-10ms, is scoped per org and role, and changes only when an Amendment is adopted.

A naive implementation would place both in a single store, but this creates structural problems:

- The lineage record is accessed by governance tooling, audit queries, and cross-run retrospectives. It is append-only and benefits from rich traversal queries.
- The governing content is accessed on every session open, must be cached at the edge (KV), and changes only on Amendment adoption. It benefits from content-addressed identity and KV invalidation logic.

If both categories share the same table/schema, every query for hot-path execution state must filter out lineage data, and every Amendment adoption must reason about which records to invalidate from a mixed data set.

---

## Decision

Split the two categories into distinct storage layers with explicit separation of concerns:

**Artifact Graph** (SPEC-KSP-ARTIFACT-GRAPH-001):
- Holds the lineage record: Specification, Execution, ExecutionTrace, Divergence, Hypothesis, Amendment, ElucidationArtifact, VerificationProcess, Verdict nodes.
- DO SQLite per namespace (`domain:org:scope`). Two tables: `nodes` + `edges`.
- Append-only. No deletes. No updates except `data.retired = true`.
- Serves governance, audit, and retrospective queries.

**Bead Graph** (SPEC-KSP-BEAD-GRAPH-001):
- Holds the governing content: PolicyBead, TrustBead, ExecutionBead, OutcomeBead, AmendmentBead, ConsentBead, EscalationBead, AuditBead.
- DO SQLite per org + KV hot cache. Two tables: `beads` + `bead_edges`.
- Content-addressed append-only DAG. Supersession via `supersedes` edges.
- Serves session open / knowing-state retrieval on every execution.

The two layers are connected by the `LoopClosureService` (SPEC-KSP-LOOP-CLOSURE-001) which writes cross-layer bridge fields. Neither layer knows about the other at the storage level.

---

## Rationale

- **Different access patterns**: artifact graph queries are infrequent, graph-traversal-heavy retrospective reads. Bead graph reads are hot-path, per-session, edge-cached.
- **Different retention requirements**: lineage records are permanent. Bead graph is compactable (old superseded beads can eventually be archived while the head chain remains active).
- **Different consumers**: audit tooling and the Commissioning Agent consume the artifact graph. The Mediation Agent and SDK consume the bead graph.
- **Separation prevents cross-contamination**: an Amendment adoption should not require querying through execution traces to find which cache keys to invalidate.
- **Domain instantiations can be independent**: a domain that only needs the Bead graph (e.g., a future API gateway domain) can instantiate `BeadGraphDOBase` without taking a dependency on the artifact graph package.

---

## Consequences

**Positive**:
- Hot-path retrieval (`retrieveKnowingState`) operates against a KV cache backed by a single-purpose DO, with no lineage data in the query path.
- KV invalidation logic is simple: invalidate by org/role/category — no cross-type filtering.
- Each layer can be deployed, versioned, and migrated independently.

**Negative**:
- Two DOs to manage per domain instantiation instead of one.
- Cross-layer consistency is eventual, not transactional. The `LoopClosureService` handles partial failure recovery via idempotent retry (INV-LC-003).
- The bridge field contract (`artifact_graph_*_id` fields in Bead content) must be maintained. Beads written without bridge fields are valid at the storage layer but lose loop closure traceability.

---

## Rejected Alternatives

**Single unified store**: would require filtering lineage data from every hot-path query. KV invalidation would need to understand record types mixed in the same table. Rejected.

**ArangoDB for both layers**: ArangoDB provides rich graph traversal useful for the artifact graph but adds external service dependency with no CF-native binding. Rejected in favor of DO SQLite for both layers (see ADR-KSP-002).
