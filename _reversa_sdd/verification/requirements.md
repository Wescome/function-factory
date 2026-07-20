# Requirements — verification

> Unit: verification (packages/verification + packages/schemas/src/coverage.ts)
> Phase 4 · Writer · Generated 2026-06-08

---

## JTBD

When artifacts are produced at any pipeline stage, I want the system to record typed, schema-validated verification reports with standard pass/fail status, so that the governance layer has a traceable, machine-readable audit trail of every quality gate outcome.

---

## Functional Requirements

### FR-01: Coherence Verification Report Schema
The package MUST export a `CoherenceVerificationReport` Zod schema with: `verification: "coherence"`, `passed: boolean`, `timestamp: string`, `executableSpecificationId: string`, `checks: CoherenceVerificationCheck[]`, `summary: string`.
- Priority: **Must**
- 🟢 CONFIRMED — `packages/schemas/src/coverage.ts`

### FR-02: Fidelity Verification Report Schema
The package MUST export a `FidelityVerificationReport` Zod schema with a `FidelityVerificationVerdict` enum. Used for semantic fidelity checks.
- Priority: **Must**
- 🟢 CONFIRMED — `packages/schemas/src/coverage.ts`

### FR-03: Persistence Verification Report Schema
The package MUST export a `PersistenceVerificationReport` Zod schema for checking artifact persistence guarantees.
- Priority: **Must**
- 🟢 CONFIRMED — `packages/schemas/src/coverage.ts`

### FR-04: Dual Exports (Zod + TypeScript)
All verification report schemas MUST export both: (1) Zod validator for runtime validation, (2) TypeScript type (via `z.infer<>`) for static typing. Named exports MUST follow the pattern: `CoherenceVerificationReport` (Zod) and `CoherenceVerificationReportType` (TS type).
- Priority: **Must**
- 🟢 CONFIRMED — `packages/schemas/src/index.ts` dual export pattern

---

## Non-Functional Requirements

### NFR-01: schemas is Foundation
The `@factory/schemas` package MUST have no internal package dependencies. All other packages depend on it; it MUST NOT depend on them.
- 🟢 CONFIRMED — ARCHITECTURE.md dependency map

---

## Acceptance Criteria

**Scenario: Coherence Verification Report validates**
```
Dado: A CoherenceVerificationReport object with 5 checks, passed=true
Quando: CoherenceVerificationReport.parse(obj) is called
Então: Parse succeeds, TypeScript type is inferred correctly
```

**Scenario: Invalid report rejected**
```
Dado: An object missing the 'verification' field
Quando: CoherenceVerificationReport.safeParse(obj)
Então: safeParse returns { success: false, error: ZodError }
```
