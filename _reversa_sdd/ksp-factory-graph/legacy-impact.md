# Legacy Impact — @factory/factory-graph

**Phase:** ksp-factory-graph  
**Steps covered:** 27–33  
**Date:** 2026-06-10

---

## Impact Table

| File affected | Component (from architecture.md) | Impact type | Severity |
|--------------|----------------------------------|-------------|----------|
| `packages/factory-graph/src/types.ts` | `@factory/packages` — domain logic layer | componente-novo | medium |
| `packages/factory-graph/src/artifact-do.ts` | `@factory/packages` — Artifact Graph DO binding | componente-novo | medium |
| `packages/factory-graph/src/bead-do.ts` | `@factory/packages` — Bead Graph DO binding | componente-novo | medium |
| `packages/factory-graph/src/detectors.ts` | `@factory/packages` — loop-closure injectable | componente-novo | medium |
| `packages/factory-graph/src/hypothesis.ts` | `@factory/packages` — loop-closure injectable (stub) | componente-novo | low |
| `packages/factory-graph/src/verifier.ts` | `@factory/packages` — Coherence Verification logic | componente-novo | medium |
| `packages/factory-graph/src/index.ts` | `@factory/packages` — public API barrel | componente-novo | low |
| `packages/factory-graph/package.json` | `@factory/packages` — workspace package registry | regra-nova | low |
| `packages/factory-graph/tsconfig.json` | `@factory/packages` — TypeScript compilation | regra-nova | low |
| `packages/factory-graph/vitest.config.ts` | `@factory/packages` — test harness | regra-nova | low |
| `packages/factory-graph/tests/detectors.test.ts` | `@factory/packages` — detector invariant coverage | regra-nova | low |
| `packages/factory-graph/tests/verifier.test.ts` | `@factory/packages` — coherence verifier coverage | regra-nova | low |

**Impact types used:**
- `regra-nova` — new rule / config / constraint introduced
- `componente-novo` — net-new component added to the system

No existing files were modified. No components were extinguished. No external contracts were changed.

---

## Preserved Rules (from domain.md)

The following business rules from domain.md are preserved and reinforced by this phase:

| Rule ID | Description | How preserved |
|---------|-------------|---------------|
| BR-05 | Coherence Verification is fail-closed | `factoryAmendmentVerifier` returns `passed:false` when coherenceScore < 0.75 — no bypass path |
| BR-09 | Invariants must be source-derived | `factoryDivergenceDetector` maps INV-* firings only — never fabricates detectors |
| CORE_NODE_TYPES (artifact-graph) | Core ontology must be extended not replaced | `FACTORY_NODE_TYPES` spreads `CORE_NODE_TYPES` — no override |
| CORE_REL_TYPES (artifact-graph) | Core relation ontology must be extended not replaced | `FACTORY_REL_TYPES` spreads `CORE_REL_TYPES` — no override |
| Append-only bead graph (INV-BG-007) | All writes are inserts; no updates or deletes | `FactoryBeadGraphDO` inherits `BeadGraphDOBase` which uses `writeBead()` insert-only |
| @factory/* naming (CLAUDE.md rule 9) | Package names use @factory/ prefix | Package named `@factory/factory-graph`; all imports use `@factory/*` |
| No @factory/* imports in ksp-sdk (CLAUDE.md rule 9) | factory-graph does not import from ksp-sdk | Verified — no ksp-sdk dependency in package.json |
| Bridge fields optional (BR-KSP-10) | Bridge fields are optional in all Bead schemas | All `artifact_graph_*_id` fields marked `.optional()` in Zod schemas |
