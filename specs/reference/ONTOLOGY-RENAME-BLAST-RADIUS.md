# Ontology Rename Blast Radius

**Status:** Pre-refactor assessment
**Date:** 2026-05-08
**Source references:** `FF-ONTOLOGY-v0.2.md`,
`ONTOLOGY-CURRENT-MAPPING.md`, `FF-REFACTORING-PLAN.md`

This report estimates the blast radius of cutting current Function Factory
implementation names to ontology v0.2 names.

Conclusion: do not perform physical renames yet. The current names are active
runtime and lineage surfaces across source, tests, generated artifacts, runtime
collections, worker diagnostics, live PR evidence, and reference docs. Continue
with hard-cut source slices and migration guardrails until each rename family
has its own cutover plan.

## Search Scope

Search excluded `node_modules`, `pnpm-lock.yaml`, `.git`, and the ignored
untracked `specs/reference/NLAH` file.

| Scope | Count |
| --- | ---: |
| Repository files searched | 2040 |
| Critical rename-surface files under `specs/intent-specifications`, `specs/executable-specifications`, `specs/verification-reports`, `packages/compiler`, `packages/verification`, workers, infra, and `.github` | 383 |

## Hit Counts

Counts are file counts, not occurrence counts.

| Current term/path/API | Files | Risk class |
| --- | ---: | --- |
| `Executable Specification` | 215 | Very high |
| `CoherenceVerificationReport` | 55 | High |
| `IntentSpecificationDraft` | 34 | High |
| `specs/verification-reports` | 25 | High |
| `executable_specifications` | 21 | High |
| `verification_reports` | 21 | High |
| `VerificationReport` | 20 | Medium-high |
| `@factory/verification` | 17 | Medium-high |
| `FidelityVerificationReport` | 15 | Medium-high |
| `@factory/compiler` | 13 | Medium-high |
| `specs/intent-specifications` | 11 | Medium-high |
| `specs/executable-specifications` | 11 | Medium-high |
| `PersistenceVerificationReport` | 11 | Medium |
| `intent_specifications` | 10 | Medium |
| `IntentSpecification` | 4 | Low; alias newly introduced |
| `ExecutableSpecification` | 4 | Low; alias newly introduced |
| `VerificationReport` | 4 | Low; alias newly introduced |

## Classification

| Rename family | Current name | Ontology alias | Classification | Decision |
| --- | --- | --- | --- | --- |
| Intent Specification artifact family | `Intent Specification`, `IntentSpecificationDraft`, `specs/intent-specifications`, `intent_specifications` | Intent Specification | Source contract, artifact ID contract, runtime storage contract, docs wording | Keep current names; add aliases only. |
| Executable Specification artifact family | `Executable Specification`, `ES-*`, `specs/executable-specifications`, `executable_specifications` | Executable Specification | Source contract, generated artifact contract, compiler output contract, runtime storage contract | Do not rename physically before a dedicated migration. |
| Verification reports | `VerificationReport`, `VR-*`, `specs/verification-reports`, `verification_reports` | Verification Report | Source contract, persisted evidence contract, Arango collection contract | Keep compatibility names. |
| Coherence Verification | `Coherence Verification`, `CoherenceVerificationReport`, `@factory/verification` | Coherence Verification | Package API, worker API, CI/runtime evidence, docs wording | Keep current APIs; alias in docs/schema exports. |
| Fidelity Verification | `Fidelity Verification`, `FidelityVerificationReport`, `FidelityVerificationVerdict` | Fidelity Verification | Active worker runtime, PR #71 evidence, MRP evidence | Do not rename until worker and MRP compatibility are audited. |
| Persistence Verification | `Persistence Verification`, `PersistenceVerificationReport` | Persistence Verification | Schema/API and blocked monitored-promotion semantics | Keep current names until active monitoring exists. |
| Package names | `@factory/compiler`, `@factory/verification` | Compilation / Verification | Workspace dependency contract and import surface | Do not rename packages yet. |
| Runtime collections | `intent_specifications`, `executable_specifications`, `verification_reports` | Ontology artifact buckets | Arango collection contract, seed/init/verify scripts, worker runtime | Do not rename without a data migration and live-read compatibility layer. |

## High-Risk Source Areas

| Area | Why it is high risk |
| --- | --- |
| `packages/compiler/src/*` | Encodes default artifact paths, IS-to-Executable Specification ID derivation, Coherence Verification pass flow, Executable Specification emission, and tests. |
| `packages/verification/src/*` | Owns Coherence Verification evaluator and report emission contracts. |
| `packages/schemas/src/*` | Owns current schema exports. `core.ts` is protected and must not be changed without explicit approval. |
| `workers/ff-pipeline/src/*` | Active runtime path for Fidelity Verification, MRP, lifecycle, diagnostics, and PR #71 evidence. |
| `workers/ff-gates/src/*` and `workers/ff-gateway/src/*` | Worker/API boundary for Coherence Verification terminology and report shape. |
| `infra/arangodb/*` | Creates, seeds, and verifies current collection names. |
| `specs/executable-specifications/*` and `specs/verification-reports/*` | Lineage-bearing generated artifacts and evidence. |
| `packages/literate-tools/tangled/*` | Generated canonical-reference output that still uses current terms. |

## Rename Family Readiness

| Family | Ready for physical rename? | Reason |
| --- | --- | --- |
| Docs wording only | Partially | Low-risk docs now carry aliases, but canonical docs and generated/tangled files still use current terms intentionally. |
| Schema alias exports | Partially | `ontology-aliases.ts` exists; broader aliases would need affected package tests. |
| Package renames | No | Workspace dependencies, lockfile entries, generated repo inventories, and docs all reference current package names. |
| Artifact directory renames | No | Paths are lineage and compiler/runtime contracts. |
| Arango collection renames | No | Requires data migration, dual-read compatibility, seed/init changes, and live runtime validation. |
| Gate terminology rename in workers | No | Fidelity Verification and lifecycle evidence are live and must remain traceable. |

## Recommended Sequence

1. Keep current persisted paths and storage collections stable until their
   migration slice.
2. Remove active source-level compatibility aliases in behavior-preserving
   slices.
3. Update `pnpm audit:ontology` in each slice so removed names cannot re-enter
   active source.
4. For each candidate rename family, satisfy
   `ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md`, then create a one-family
   migration proposal from `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md` with:
   - exact files touched,
   - old-to-new cutover strategy,
   - rollback plan,
   - local tests,
   - docs audit,
   - remote PR checks,
   - live runtime evidence validation where applicable.
5. Keep `pnpm audit:ontology` and `pnpm audit:docs` green in CI before and
   after each rename-family proposal.
6. Only after migration plans are green, decide whether the rename is worth
   the churn.

## Explicit Non-Starters

- No mass rename of `specs/intent-specifications`, `specs/executable-specifications`, or
  `specs/verification-reports`.
- No parallel ontology-named replacement directories such as
  `specs/intent-specifications`, `specs/executable-specifications`,
  `specs/verification-reports`, `packages/verification`, or
  `workers/ff-fidelity-verification` without a one-family rename proposal.
- No ontology-named replacement collection identifiers such as
  `specs_intent_specifications`, `specs_executable_specifications`,
  `specs_verification_reports`, `coherence_verifications`, or
  `fidelity_verifications` without dual-read compatibility and a migration
  plan.
- No package rename of `@factory/compiler` or `@factory/verification`.
- No Arango collection rename of `intent_specifications`, `executable_specifications`, or
  `verification_reports`.
- No replacement of `FidelityVerificationReport`, `FidelityVerificationVerdict`, MRP, or lifecycle evidence
  terms while PR #71 runtime evidence remains active.
- No edit to `packages/schemas/src/core.ts` without explicit approval.

## Next Safe Step

The hard-cutover audit script now lives at
`scripts/audit-ontology-hard-cut.mjs` and runs with:

```bash
pnpm audit:ontology
```

It verifies:

- active source does not reintroduce banned legacy APIs,
- required cutover guardrail files are present,
- compiler default paths still resolve,
- docs links still resolve,
- runtime collection names used by workers match infra seed/init names.

Run it before any physical rename PR. Any future physical rename PR should also
satisfy `ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md` and start from
`ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`.

The root CI workflow also runs `pnpm audit:docs` and `pnpm audit:ontology` in
the `Repository Audit` job. The Factory PR Gate depends on that job, so future
rename proposals must preserve the hard-cutover guardrails before they can pass
the PR gate.
