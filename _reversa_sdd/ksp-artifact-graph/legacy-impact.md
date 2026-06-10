# Legacy Impact — @factory/artifact-graph

> Phase: ksp-artifact-graph | Generated: 2026-06-10

---

## Impact Table

| File Affected | Component (from architecture.md) | Impact Type | Severity |
|---------------|----------------------------------|-------------|----------|
| `packages/artifact-graph/src/types.ts` | New KSP substrate layer (no prior component) | componente-novo | LOW — additive only |
| `packages/artifact-graph/src/queries.ts` | New KSP substrate layer | componente-novo | LOW — additive only |
| `packages/artifact-graph/src/migrate.ts` | New KSP substrate layer | componente-novo | LOW — additive only |
| `packages/artifact-graph/src/do.ts` | New KSP substrate layer (abstract DO base) | componente-novo | MEDIUM — establishes abstract contract for all domain instantiations |
| `packages/artifact-graph/src/worker.ts` | cf-workers surface (wrangler dev only) | componente-novo | LOW — dev-only binding |
| `packages/artifact-graph/bindings.ts` | cf-workers binding layer | componente-novo | LOW — dev-only concrete subclass |
| `packages/artifact-graph/migrations/v00_base.ts` | SQLite schema (new, namespace-isolated) | componente-novo | LOW — additive DDL |
| `packages/artifact-graph/wrangler.jsonc` | Cloudflare deployment config | componente-novo | LOW — dev only |
| `packages/artifact-graph/tests/generic.test.ts` | Test coverage for new substrate | componente-novo | LOW — test-only |
| `packages/artifact-graph/package.json` | pnpm workspace package | componente-novo | LOW — additive package |
| `packages/artifact-graph/tsconfig.json` | TypeScript config | componente-novo | LOW — additive package |
| `packages/artifact-graph/vitest.config.ts` | Test runner config | componente-novo | LOW — additive package |
| `_reversa_sdd/ksp-artifact-graph/tasks.md` | Governance artifact | delta-de-contrato-externo | LOW — reversa tracking |
| `_reversa_sdd/ksp-artifact-graph/progress.jsonl` | Governance artifact | delta-de-contrato-externo | LOW — reversa tracking |

---

## Impact on Existing Components

| Existing Component | Relationship to New Package | Risk |
|-------------------|---------------------------|------|
| `workers/gascity-supervisor/src/factory-store-do.ts` | Parallel DO pattern — same `SqlStorage` + DDL approach. No shared code. | NONE — isolated |
| `packages/artifact-validator` | Different domain: validates ArangoDB artifacts. No overlap with SQLite graph. | NONE |
| `packages/assurance-graph` | Different domain: ArangoDB-backed. No dependency. | NONE |
| `workers/ff-pipeline` | Upstream pipeline — will eventually call `FactoryArtifactGraphDO` (Phase 4). Currently no dependency. | NONE — future consumer only |
| `packages/db-client` | ArangoDB-based client. `@factory/artifact-graph` uses DO SQLite directly, not db-client. | NONE |

---

## Preserved Rules (cross-reference with domain.md)

The following business rules from `domain.md` are PRESERVED and NOT modified by this phase:

| Rule | Status |
|------|--------|
| BR-01: Signal Idempotency | PRESERVED — artifact-graph does not touch signal ingestion |
| BR-02: Birth Gate (Confidence Threshold) | PRESERVED — artifact-graph does not touch proposal scoring |
| BR-03: Architect Approval Gate | PRESERVED — artifact-graph does not touch human-in-the-loop events |
| BR-04: Semantic Review is Advisory | PRESERVED — no change to review logic |
| BR-05: Coherence Verification is Fail-Closed | PRESERVED — no change to ff-gates |
| BR-06: Intent Violation Escalation | PRESERVED — no change to pipeline orchestration |
| Single-writer per DO namespace (architecture.md AD-02) | PRESERVED AND EXTENDED — INV-AG-006 enforces single-writer pattern for artifact graph namespaces |
| D1 (ff-factory) as operational state store | PRESERVED — artifact-graph uses DO SQLite, not D1 |
| ArangoDB artifact lineage | PRESERVED — existing lineage_edges in ArangoDB unchanged; new DO-based lineage in artifact-graph is a parallel KSP substrate layer, not a replacement |

---

## Architectural Gaps Introduced

| Gap | Description | Severity |
|-----|-------------|----------|
| GAP-AG-001 | No typed error classes; raw SQLite constraint violations surface as untyped exceptions. | MEDIUM |
| GAP-AG-002 | No RPC fetch handler on `ArtifactGraphDOBase`; domain instantiations must implement their own fetch routing. | MEDIUM |
| GAP-AG-003 | No canonical JSON helper for content-addressed IDs; domain instantiations must implement their own. | HIGH — spec gap |
| GAP-NAMING-001 | `walkBoundedPath` spec had `params = [startId]` initial anchor with no matching `?` placeholder. Fixed to `params = []` with single final `WHERE n0.id = ?`. This is a documented deviation from the spec literal for correctness. | LOW — spec bug fixed |
