# ADR-KSP-005: @factory/ksp-sdk Isolation from @factory/* Imports

**Status**: Accepted
**Date**: 2026-06-10
**Deciders**: Wislet J. Celestin / Koales.ai
**Context**: SPEC-KSP-ARCH-001 §3 (Package Topology), SPEC-KSP-ARCH-001 Phase 2 (Step 17)

---

## Context

The `@factory/knowing-state-sdk` package (provisionally `packages/knowing-state-sdk`) is the SDK layer that domain consumers use to implement session lifecycle, retrieval enforcement, and execution recording. Its canonical name reflects its intended final scope: `@koales/knowing-state-sdk`, deployable to any Koales.ai product domain.

Three domain instantiations are planned or in progress:
- Function Factory (software engineering) — `@factory/factory-graph`
- ComeFlow (B2B commerce) — `comeflow-graph`
- CareTrace (clinical) — `caretrace-graph`

The SDK must be usable by all three without modification. If the SDK imports any `@factory/*` package, it becomes domain-specific to the software engineering domain and cannot be deployed to ComeFlow or CareTrace without bundling unused Factory dependencies.

---

## Decision

The `@factory/knowing-state-sdk` (or `@koales/knowing-state-sdk`) package has a strict import constraint:

**The SDK MUST NOT import any `@factory/*`, `comeflow/*`, or `caretrace/*` packages. It re-exports only from `@koales/bead-graph` (or `@factory/bead-graph` in the monorepo).**

The SDK's `src/index.ts` contains only:

```typescript
// Re-exports from @koales/bead-graph — zero domain-specific imports
export type { KnowingStateSDK, Session, KnowingState, TrustEvaluation, Autonomy } from '@koales/bead-graph';
export type { AnyBead, BaseBead, PolicyBead, TrustBead, ExecutionBead, OutcomeBead,
              AmendmentBead, ConsentBead, EscalationBead, AuditBead } from '@koales/bead-graph';
export { computeBeadId } from '@koales/bead-graph';
```

The `tsc --noEmit` typecheck gate for Step 17 of the implementation ordering explicitly verifies: "zero errors; no factory-specific imports."

Domain-specific logic belongs in the domain instantiation package (`@factory/factory-graph`, etc.), not in the SDK.

---

## Rationale

**Domain-agnostic deployment**: ComeFlow and CareTrace are distinct products with different infrastructure accounts. Bundling `@factory/*` imports into the SDK would require ComeFlow to take a hard dependency on Function Factory package infrastructure. This creates cross-product coupling that breaks the domain isolation model.

**SDK as product boundary**: the SDK defines the contract that any domain coordinator (Mediation Agent DO, ComeFlow event handler, CareTrace PAA) calls to enforce the four KSP invariants. The invariants are domain-agnostic. The contract must be implementable without domain-specific knowledge.

**Circular dependency prevention**: the dependency graph (SPEC-KSP-ARCH-001 §3) is explicitly acyclic. `knowing-state-sdk` depends on `bead-graph`. `factory-graph` depends on `knowing-state-sdk`. If `knowing-state-sdk` imported `factory-graph`, the cycle would prevent clean package builds.

**OEM roadmap**: the KS-Generalization-Research.docx establishes an OEM roadmap where any future domain (legal AI, financial AI) can adopt the KSP SDK without taking a dependency on any existing product's implementation. The import constraint enforces this at the package boundary.

**Typecheck gate as enforcement mechanism**: the implementation ordering specifies a `tsc --noEmit` gate after Step 17 with an explicit "no factory-specific imports" check. This makes the constraint machine-verifiable, not just a convention.

---

## Consequences

**Positive**:
- `@factory/knowing-state-sdk` (or `@koales/knowing-state-sdk`) can be published and consumed by any domain without modification.
- The SDK package has minimal bundle size (re-exports only).
- Future domain instantiations have a clear integration path: implement the `KnowingStateSDK<P,T,E,O>` interface using their domain's bead types.
- No circular dependencies in the package graph.

**Negative**:
- Domain-specific SDK extensions (e.g., Factory-specific convenience methods on `CommitBead`) cannot live in the SDK package — they must live in `@factory/factory-graph` or a thin domain-specific wrapper.
- Developers unfamiliar with the isolation rule may add `@factory/*` imports to the SDK in future work — the typecheck gate is the enforcement mechanism, not a code review convention.

---

## Rejected Alternatives

**Single monolithic SDK with all domain types**: would require every domain consumer to bundle all domain schemas regardless of which domain they operate in. Adds dead code to every deployment. Rejected.

**Domain-specific SDKs (`@factory/sdk`, `@comeflow/sdk`, etc.) with no shared package**: duplicates the four invariant enforcement mechanisms across every domain SDK. Any bug in invariant enforcement must be fixed in N places. Rejected.

**SDK imports domain types via conditional bundling (tree shaking)**: tree shaking cannot eliminate type-level imports. The circular dependency remains at the type level. Rejected.
