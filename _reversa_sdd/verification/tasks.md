# Tasks — verification

> Unit: verification
> Phase 4 · Writer · Generated 2026-06-08

---

## Implementation Tasks

### T-01: Define CoherenceVerificationReport Zod Schema
**Source:** `packages/schemas/src/coverage.ts`
**Behavior:** Define Zod schema with discriminator `verification: z.literal("coherence")`, required fields: `passed`, `timestamp`, `executableSpecificationId`, `checks[]` with `{name, passed, detail}`, `summary`.
**Criterion for done:** Schema validates conforming objects; rejects objects with missing required fields.
**Confidence:** 🟢 CONFIRMED

### T-02: Define FidelityVerificationReport and Verdict
**Source:** `packages/schemas/src/coverage.ts`
**Behavior:** Define `FidelityVerificationVerdict` enum and `FidelityVerificationReport` schema with appropriate fields.
**Criterion for done:** Both Zod schema and TS type are exported and usable by consumers.
**Confidence:** 🟢 CONFIRMED

### T-03: Dual Export Pattern in schemas/index.ts
**Source:** `packages/schemas/src/index.ts`
**Behavior:** Export Zod validators as named values (e.g., `CoherenceVerificationReport`) AND TypeScript types with `Type` suffix (e.g., `CoherenceVerificationReportType`). Use `export type { ... }` for type-only exports.
**Criterion for done:** Consumers can `import { CoherenceVerificationReport }` for runtime validation and `import type { CoherenceVerificationReportType }` for static typing.
**Confidence:** 🟢 CONFIRMED
