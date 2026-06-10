# Regression Watch — @factory/factory-graph

**Phase:** ksp-factory-graph  
**Steps covered:** 27–33  
**Date:** 2026-06-10

Each row is a contract or invariant introduced in this phase that must be watched for regressions.

---

## Watch List

| ID | Source file + section | Expected rule after change | Check type | Violation signal |
|----|----------------------|---------------------------|------------|-----------------|
| W001 | `src/types.ts` — `FACTORY_NODE_TYPES` | Must include all 10 factory-specific types (`Signal`, `Pressure`, `Capability`, `FunctionProposal`, `PRD`, `WorkGraph`, `Invariant`, `CoverageReport`, `AtomDirective`, `TraceFragment`) and all `CORE_NODE_TYPES`. Length must be ≥ 24. | Static type / unit test | `FACTORY_NODE_TYPES.includes('WorkGraph')` returns false; tsc errors on string literal type mismatch |
| W002 | `src/types.ts` — `FACTORY_REL_TYPES` | Must include all 8 factory-specific relation types (`source_ref`, `compiles_to`, `instantiates`, `addresses`, `derived_from`, `dispatched_as`, `produced_trace`, `gate_result`) and all `CORE_REL_TYPES`. | Static type / unit test | `FACTORY_REL_TYPES.includes('compiles_to')` returns false |
| W003 | `src/types.ts` — `ArchitectureDecisionBead` | Bridge field `artifact_graph_specification_id` is `z.string().optional()`. Must never be required. | Zod schema / tsc | `z.literal('arch_decision')` parse fails on objects without bridge field |
| W004 | `src/types.ts` — `BuildOutcomeStatus` | Enum must include `'success' \| 'failure' \| 'timeout' \| 'partial'` exactly. Adding or removing members is a contract break. | tsc / Zod enum check | Downstream consumers that `switch` on `BuildOutcomeStatus` get exhaustiveness errors |
| W005 | `src/detectors.ts` — `mapInvSeverity` | Severity mapping: `'critical'→'critical'`, `'warning'→'medium'`, `*→'low'`. Must not change without updating Commissioning Agent severity routing table. | Unit test (detectors.test.ts) | `factoryDivergenceDetector` returns wrong severity for known INV-* firings |
| W006 | `src/detectors.ts` — failure path | `outcome==='failure' && attempts_exhausted` must always produce a `'high'` divergence with `claimId = 'claim-atom-outcome-{atom_id}'`. | Unit test (detectors.test.ts) | Loop never opens amendment for exhausted atoms |
| W007 | `src/detectors.ts` — timeout path | `outcome==='timeout' && attempts_exhausted` must always produce a `'high'` divergence with `claimId = 'claim-atom-timeout-{atom_id}'`. | Unit test (detectors.test.ts) | Timeout failures silently dropped from divergence set |
| W008 | `src/verifier.ts` — coherence threshold | `coherenceScore < 0.75` must always yield `passed: false`. This is a hard gate (BR-05). No rounding or tolerance. | Unit test (verifier.test.ts) | Amendment adopted without meeting coherence bar; Commissioning Agent proceeds without CRP |
| W009 | `src/verifier.ts` — cross-repo scan trigger | `architectAgentDO.checkCrossRepoPattern()` must be called if and only if `coherenceScore > 0.7`. At exactly 0.7 or below, call must be skipped. | Unit test (verifier.test.ts) | Cross-repo scan noise when coherenceScore is too low; missed scan when coherenceScore is above threshold |
| W010 | `src/verifier.ts` — patternScore gate | `patternScore < 0.5` must yield `passed: false` even when `coherenceScore >= 0.75`. | Unit test (verifier.test.ts) | Incoherent cross-repo pattern passes Amendment gate |
| W011 | `src/index.ts` — barrel exports | All six symbols (`FactoryArtifactGraphDO`, `FactoryBeadGraphDO`, `factoryDivergenceDetector`, `factoryHypothesisBuilder`, `factoryAmendmentVerifier`, `* from ./types`) must be importable from `@factory/factory-graph` root. | tsc on any consumer | Import resolution errors in `packages/mediation-agent` or `workers/commissioning` |
| W012 | `package.json` — @factory/ naming | Package name must remain `@factory/factory-graph`. No renaming to `@koales/*` or any other prefix. | pnpm workspace / tsc path resolution | Workspace resolution fails; consumers get `Cannot find module '@factory/factory-graph'` |
| W013 | `src/artifact-do.ts` / `src/bead-do.ts` — CLAUDE.md rule 2 | No use of `deriveRole()`. Neither file calls `deriveRole`. | Code review / grep | `deriveRole` call introduced during future modification |
| W014 | Append-only invariant (CLAUDE.md rule 7) | `FactoryBeadGraphDO.writeBead()` (inherited) must be insert-only. No UPDATE or DELETE SQL on `beads` table. | Code review / SQL audit in bead-queries.ts | Mutable bead state; bead_id hash no longer stable |
