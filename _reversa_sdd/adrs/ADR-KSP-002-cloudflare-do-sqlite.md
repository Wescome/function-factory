# ADR-KSP-002: Cloudflare Durable Object SQLite for KSP Storage (Not ArangoDB)

**Status**: Accepted
**Date**: 2026-06-10
**Deciders**: Wislet J. Celestin / Koales.ai
**Context**: SPEC-KSP-ARCH-001 §5, ADR-010-d1-replaces-arangodb.md (existing codebase ADR)

---

## Context

The KSP architecture requires persistent storage for two complementary layers: the artifact graph (lineage record) and the bead graph (governing content). The previous ComeFlow and CareTrace KSP instantiations use ArangoDB for bead graph storage. A decision is needed for new instantiations and eventual migration.

ArangoDB was used in the original ComeFlow/CareTrace implementations because it provided:
- Rich AQL graph traversal queries
- Document-oriented schema flexibility
- Operational familiarity at the time of initial implementation

The Function Factory already made the decision to retire ArangoDB in favor of Cloudflare-native D1 (ADR-010). The KSP layer must align with this direction.

---

## Decision

Use Cloudflare Durable Object SQLite as the storage substrate for both the artifact graph and the bead graph in all new KSP instantiations.

- **Artifact Graph**: one DO per namespace (`domain:org:scope`). SQLite `nodes` + `edges` tables. Traversal via recursive CTEs (`WITH RECURSIVE`).
- **Bead Graph**: one DO per org. SQLite `beads` + `bead_edges` tables. Hot-path reads served from KV cache; DO is the authoritative fallback.

Existing ComeFlow and CareTrace deployments on ArangoDB are not affected by this decision. Their migration to DO SQLite is governed by separate per-deployment migration specs (SPEC-CF-KS-001, PHI-VAULT-001 update).

---

## Rationale

**Single-host constraint**: DO SQLite serializes all writes to a single DO instance per namespace/org. This is the single-writer invariant (INV-KSP-003) at zero infrastructure cost — no mutex, no distributed lock, no conflict resolution. The platform enforces it.

**No external service**: DO SQLite is a CF-native binding. No external connection pool, no VPC peering, no network latency to an external DB. The artifact graph and bead graph are co-located with the Workers that write to them.

**Automatic WAL snapshots and PITR**: CF manages DO SQLite backups. 30-day point-in-time recovery is available automatically. No ops work required.

**Recursive CTE traversal**: SQLite supports `WITH RECURSIVE` which covers all required traversal patterns (lineage walk, bounded path walk, bi-directional lineage collect). The six generic traversal functions in `queries.ts` cover all cases without needing AQL-style graph query language.

**Alignment with codebase direction**: the existing codebase already completed the ArangoDB-to-D1 migration (ADR-010). Using ArangoDB for the KSP layer would create a split infrastructure model where some stores are CF-native and some require external service management. Rejected.

**10GB limit per DO**: each DO instance is limited to 10GB SQLite storage. For the bead graph (one per org), this is sufficient for any single org's bead history at current scale. For the artifact graph (one per namespace), this bounds the lineage record for a single pipeline scope. Cross-namespace queries are handled at the Worker layer by fanning out to multiple DO stubs.

---

## Consequences

**Positive**:
- No external infrastructure to provision, monitor, or secure for KSP storage.
- Single-writer guarantee enforced by platform — no accidental concurrent writes.
- Automatic backups and PITR without operational overhead.
- Consistent infra model with the rest of the codebase.

**Negative**:
- 10GB per DO limit requires namespace/org partitioning strategy at scale.
- Cross-namespace graph queries require Worker-layer fan-out and merge — no single query across multiple namespaces.
- AQL-style graph algorithms (PageRank, clustering) are not available natively; must be implemented as domain-specific query methods using recursive CTEs.
- Existing ComeFlow and CareTrace deployments require migration work.

---

## Rejected Alternatives

**ArangoDB for new instantiations**: requires external service, adds latency, has no CF-native binding, diverges from codebase migration direction. Rejected.

**D1 (shared) instead of DO SQLite**: D1 is multi-writer and does not provide the single-writer constraint required by INV-KSP-003. D1 is appropriate for cross-run audit logs (the `bead_audit` table in `@factory/gears`), not for the authoritative single-writer bead store. Rejected.

**R2 for artifact storage**: R2 is object storage, not a relational or graph store. Traversal queries are not possible. Rejected.
