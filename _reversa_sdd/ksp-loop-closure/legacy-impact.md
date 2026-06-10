# Legacy Impact — @factory/loop-closure (ksp-loop-closure)

> Generated 2026-06-10 · Phase ksp-loop-closure · Steps 22–26

---

## Files Affected

| File affected | Component (from architecture.md) | Impact type | Severity |
|---------------|----------------------------------|-------------|----------|
| `packages/loop-closure/package.json` | `@factory/packages` library layer | componente-novo | low |
| `packages/loop-closure/tsconfig.json` | `@factory/packages` library layer | componente-novo | low |
| `packages/loop-closure/src/index.ts` | `@factory/packages` library layer — loop-closure barrel | componente-novo | low |
| `packages/loop-closure/src/types.ts` | `@factory/packages` library layer — KSP types | componente-novo | medium |
| `packages/loop-closure/src/bridge-fields.ts` | `@factory/packages` library layer — bridge field helpers | componente-novo | medium |
| `packages/loop-closure/src/service.ts` | `@factory/packages` library layer — LoopClosureService | componente-novo | high |
| `packages/loop-closure/tests/loop.test.ts` | `@factory/packages` test coverage | componente-novo | low |
| `packages/loop-closure/vitest.config.ts` | `@factory/packages` build tooling | componente-novo | low |
| `packages/loop-closure/tests/__mocks__/cloudflare-workers.ts` | `@factory/packages` test tooling | componente-novo | low |

---

## Delta-de-Contrato-Externo (New Public Contracts)

| Export | Contract | Notes |
|--------|----------|-------|
| `LoopClosureService` | Class with `openSession`, `recordExecution`, `recordOutcome`, `proposeAmendment`, `adoptAmendment` | Consumed by domain coordinators (Factory, ComeFlow, CareTrace) |
| `LoopClosureConfig` | Interface — wires `ArtifactGraphDOBase`, `BeadGraphDOBase`, `KVNamespace`, three injectable functions | Must not change shape without migrating all domain instantiations |
| `Session` | Interface — stored in KV under `session:{sessionId}` | Any field removal is a breaking change |
| `DivergenceDetector`, `HypothesisBuilder`, `AmendmentVerifier` | Injectable function type contracts | Domain must implement these exactly |
| `BRIDGE_*` constants | Four `as const` string literals | Bead content field names; changing these breaks all loop closure reads |
| `addExecutionBridge`, `addDivergenceBridge`, `addAmendmentBridge`, `addSpecificationBridge` | Pure helper functions | Used in content assembly; type signature is part of the contract |

---

## Preserved Rules (cross-referenced against domain.md KSP Business Rules)

| Rule ID | Rule | Preserved by |
|---------|------|--------------|
| BR-KSP-05 | Append-only — both layers. No DELETE or UPDATE. | `service.ts` never deletes nodes/edges; uses `INSERT OR IGNORE` / `upsertNode` |
| BR-KSP-06 | Content-addressed bead identity — SHA-256 via `computeBeadId()`. | All bead construction calls `beadGraphDO.computeBeadId()` |
| BR-KSP-07 | AuditBead in every bead write transaction. | `buildAuditBead()` called in every `writeBead()` call in service.ts |
| BR-KSP-08 | KV invalidated before adoption return. | Step 5 of `adoptAmendment()` deletes `ks:{orgId}:*`, `head:{orgId}:*`, `maintenance:{orgId}` before returning |
| BR-KSP-09 | ElucidationArtifact written on every adoption, unconditionally. | Step 3b of `adoptAmendment()` writes `ElucidationArtifact` node; no conditional guard |
| BR-KSP-10 | Bridge fields are optional — Bead invariants hold without them. | `service.ts` uses `addExecutionBridge()` / `addDivergenceBridge()` / etc. in content only; storage layer does not enforce them |
| BR-KSP-13 | Write sequence on execution — artifact graph first. | `recordExecution()` calls `upsertNode` + `upsertEdge` before `writeBead` per INV-LC-003 |
| BR-KSP-14 | Hard gate — loop-closure tests before factory-graph. | Step 26 gate green; all 5 bridge point tests pass |
| BR-KSP-20 | Amendment adoption is atomic at semantic level — all five steps complete before return. | `adoptAmendment()` executes all five steps sequentially; KV invalidation (step 5) is awaited before return |

---

## Components Not Affected

The following components documented in architecture.md are unmodified by this phase:

- `ff-pipeline` Worker — main workflow
- `SynthesisCoordinator` DO
- `AtomExecutor` DO
- `ff-gates` Worker
- `GasCitySupervisor` Container / `FactoryStore` DO
- `@factory/artifact-graph` package (read-only dependency)
- `@factory/bead-graph` package (read-only dependency)
- All other `@factory/packages` outside `loop-closure/`
