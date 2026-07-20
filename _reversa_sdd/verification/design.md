# Design — verification

> Unit: verification
> Phase 4 · Writer · Generated 2026-06-08

---

## Package Structure

```
packages/schemas/src/coverage.ts
  └── CoherenceVerificationReport (Zod schema + TS type)
  └── FidelityVerificationReport + FidelityVerificationVerdict
  └── PersistenceVerificationReport

packages/verification/src/
  └── helpers for VR creation/validation
```

---

## Schema Design Principles

All verification reports extend a common pattern:
- `verification` discriminator string literal ("coherence" | "fidelity" | "persistence")
- `passed: boolean`
- `timestamp: string` (ISO 8601)
- `checks: { name, passed, detail }[]`
- `summary: string`

Both Zod schema (for runtime validation) and TypeScript type (for static typing) are exported from `packages/schemas/src/index.ts`.

---

## Usage Pattern

```typescript
// In ff-gates:
const report: CoherenceVerificationReport = {
  verification: "coherence",
  passed: allChecksPassed,
  timestamp: new Date().toISOString(),
  executableSpecificationId: wgId,
  checks: [...],
  summary: `${passCount}/5 checks passed`
}
// TypeScript validates at compile time; Zod validates at runtime boundaries
```
