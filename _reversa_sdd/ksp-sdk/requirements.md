# Requirements — @factory/ksp-sdk

> Reversa SDD · Phase: Writer · Generated: 2026-06-10
> Module: `packages/knowing-state-sdk/` → published as `@factory/ksp-sdk`
> Source specs: SPEC-KSP-BEAD-GRAPH-001 §8, §12; SPEC-KSP-ARCH-001 §3; domain.md BR-KSP-15; architecture.md ADR-KSP-005

---

## Overview

`@factory/ksp-sdk` is the domain consumer–facing entry point for the Knowing-State Prosthesis. It is a thin re-export shim: one file, one export, zero logic. Its sole job is to surface the `KnowingStateSDK` interface — and the full type vocabulary from `@factory/bead-graph` — to consumers (Factory Mediation Agent DO, ComeFlow, CareTrace) without coupling those consumers directly to the storage implementation package.

---

## Functional Requirements

### FR-01: Re-export KnowingStateSDK and all public types from @factory/bead-graph

**Confidence:** 🟢 CONFIRMED
**Source:** SPEC-KSP-BEAD-GRAPH-001 §8 (SDK Contract), §12 (Package Placement); CLAUDE.md Step 21; domain.md BR-KSP-15; architecture.md ADR-KSP-005

`packages/knowing-state-sdk/src/index.ts` MUST re-export everything from `@factory/bead-graph`. This includes:

- `KnowingStateSDK<PolicyContent, TrustContent, ExecutionContent, OutcomeContent>` interface
- `Session` interface
- `KnowingState<TrustContent, PolicyContent>` interface
- `TrustEvaluation<TrustContent>` interface
- `Autonomy` type alias (`'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL'`)
- All 8 Bead Zod schemas and their inferred TypeScript types (`BaseBead`, `PolicyBead`, `TrustBead`, `ExecutionBead`, `OutcomeBead`, `AmendmentBead`, `ConsentBead`, `EscalationBead`, `AuditBead`, `AnyBead`)
- Error classes: `BeadImmutabilityError`, `BeadIntegrityError`, `SessionNotInitialized`, `AutonomyDegradedError`
- `computeBeadId` utility function
- `AmendmentBeadContent` and any other content type aliases exposed by `@factory/bead-graph`

The re-export form MUST be `export * from '@factory/bead-graph'` (star re-export). No partial re-exports, no aliasing.

---

## Non-Functional Requirements

### NFR-01: Zero imports from @factory/* (Isolation constraint)

**Confidence:** 🟢 CONFIRMED
**Source:** domain.md BR-KSP-15; CLAUDE.md Step 21, Rule 9; architecture.md ADR-KSP-005; SPEC-KSP-BEAD-GRAPH-001 §12

`packages/knowing-state-sdk/src/index.ts` MUST NOT contain any import (direct or transitive) from any `@factory/*` package other than `@factory/bead-graph`. This constraint exists because `@factory/ksp-sdk` is designed to be deployed outside the Function Factory monorepo (ComeFlow, CareTrace). Any `@factory/*` import in the SDK creates domain-specific coupling that breaks cross-product deployability.

The `tsc --noEmit` gate after Step 21 is the enforcement mechanism. A clean compile with zero errors is the evidence that no `@factory/*` imports have leaked in.

**Operationalized rule:** the `package.json` `dependencies` field MUST list only `@factory/bead-graph`. No other `@factory/*` entry is permitted.

### NFR-02: tsc --noEmit gate passes with zero errors

**Confidence:** 🟢 CONFIRMED
**Source:** CLAUDE.md Step 21 gate column; SPEC-KSP-ARCH-001 §3 (Phase 2 typecheck gate)

After `src/index.ts` is written, `tsc --noEmit` MUST produce zero errors. This is the sole quality gate for this module. No runtime execution, no wrangler dev, no test suite — the package has no logic to test.

### NFR-03: Build position — Phase 2 in strict sequence

**Confidence:** 🟢 CONFIRMED
**Source:** architecture.md §KSP Layer — Package Build Order; CLAUDE.md §Implementation order §Phase 3

`@factory/ksp-sdk` is Phase 2 in the KSP build sequence:

```
Phase 1 (no deps): @factory/artifact-graph, @factory/bead-graph
Phase 2 (depends on bead-graph): @factory/ksp-sdk          ← this module
Phase 3 (depends on artifact-graph + bead-graph): @factory/loop-closure
Phase 4+: @factory/factory-graph, @factory/gears, .flue/workflows
```

This module MUST NOT be implemented before `@factory/bead-graph` compiles clean. It MUST be implemented before `@factory/loop-closure` begins.

### NFR-04: Downstream consumers depend on @factory/ksp-sdk, not @factory/bead-graph directly

**Confidence:** 🟢 CONFIRMED
**Source:** SPEC-KSP-BEAD-GRAPH-001 §12; architecture.md ADR-KSP-005; code-analysis.md Module: ksp-sdk

Factory Mediation Agent DO, ComeFlow, and CareTrace MUST import from `@factory/ksp-sdk`, not from `@factory/bead-graph`. This indirection is the isolation guarantee: consumers are shielded from future refactoring of the storage implementation. The SDK is the public contract. The bead-graph is the private implementation.

---

## Acceptance Criteria

### AC-01: Happy path — SDK types are available to a consumer

**Dado** that `@factory/bead-graph` compiles clean with zero TypeScript errors,
**Quando** a consumer package declares `@factory/ksp-sdk` as a dependency and imports `KnowingStateSDK` from it,
**Then** TypeScript resolves the type without errors, and all generic parameters (`PolicyContent`, `TrustContent`, `ExecutionContent`, `OutcomeContent`) are visible and correctly typed.

### AC-02: Failure path — @factory/* import rejected at typecheck gate

**Dado** that a developer accidentally adds `import { something } from '@factory/schemas'` to `packages/knowing-state-sdk/src/index.ts`,
**Quando** `tsc --noEmit` is run,
**Then** TypeScript reports an error (module not in dependencies, or import creates a cycle), and the gate fails — preventing the violation from entering the build.

---

## MoSCoW Classification

| Requirement | Priority | Rationale |
|-------------|----------|-----------|
| FR-01: Re-export from @factory/bead-graph | **Must** | Without this, consumers have no SDK entry point. Entire Phase 3+ is blocked. |
| NFR-01: Zero @factory/* imports | **Must** | Architectural constraint. Violation breaks ComeFlow and CareTrace deployability. Enforcement is the tsc gate. |
| NFR-02: tsc gate passes | **Must** | Required before Phase 3 (loop-closure) can begin. |
| NFR-03: Build position (Phase 2) | **Must** | Strict sequencing rule from SPEC-KSP-ARCH-001. |
| NFR-04: Consumers depend on SDK, not bead-graph | **Should** | Enforced by convention (code review). Not enforceable at compile time if consumers could bypass. |
