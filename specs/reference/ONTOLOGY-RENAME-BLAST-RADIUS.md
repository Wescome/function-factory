# Ontology Rename Blast Radius

**Status:** Pre-refactor assessment
**Date:** 2026-05-08
**Source references:** `FF-ONTOLOGY-v0.2.md`,
`ONTOLOGY-CURRENT-MAPPING.md`, `FF-REFACTORING-PLAN.md`

This report estimates the blast radius of renaming current Function Factory
compatibility names to ontology v0.2 names.

Conclusion: do not perform physical renames yet. The current names are active
contracts across source, tests, generated artifacts, runtime collections,
worker diagnostics, live PR evidence, and reference docs. Continue with
aliases-first work until each rename family has its own compatibility plan.

## Search Scope

Search excluded `node_modules`, `pnpm-lock.yaml`, `.git`, and the ignored
untracked `specs/reference/NLAH` file.

| Scope | Count |
| --- | ---: |
| Repository files searched | 2040 |
| Critical rename-surface files under `specs/prds`, `specs/workgraphs`, `specs/coverage-reports`, `packages/compiler`, `packages/coverage-gates`, workers, infra, and `.github` | 383 |

## Hit Counts

Counts are file counts, not occurrence counts.

| Current term/path/API | Files | Risk class |
| --- | ---: | --- |
| `WorkGraph` | 215 | Very high |
| `Gate1Report` | 55 | High |
| `PRDDraft` | 34 | High |
| `specs/coverage-reports` | 25 | High |
| `specs_workgraphs` | 21 | High |
| `specs_coverage_reports` | 21 | High |
| `CoverageReport` | 20 | Medium-high |
| `@factory/coverage-gates` | 17 | Medium-high |
| `Gate2Report` | 15 | Medium-high |
| `@factory/compiler` | 13 | Medium-high |
| `specs/prds` | 11 | Medium-high |
| `specs/workgraphs` | 11 | Medium-high |
| `Gate3Report` | 11 | Medium |
| `specs_prds` | 10 | Medium |
| `IntentSpecification` | 4 | Low; alias newly introduced |
| `ExecutableSpecification` | 4 | Low; alias newly introduced |
| `VerificationReport` | 4 | Low; alias newly introduced |

## Classification

| Rename family | Current name | Ontology alias | Classification | Decision |
| --- | --- | --- | --- | --- |
| PRD artifact family | `PRD`, `PRDDraft`, `specs/prds`, `specs_prds` | Intent Specification | Source contract, artifact ID contract, runtime storage contract, docs wording | Keep current names; add aliases only. |
| WorkGraph artifact family | `WorkGraph`, `WG-*`, `specs/workgraphs`, `specs_workgraphs` | Executable Specification | Source contract, generated artifact contract, compiler output contract, runtime storage contract | Do not rename physically before a dedicated migration. |
| Coverage reports | `CoverageReport`, `CR-*`, `specs/coverage-reports`, `specs_coverage_reports` | Verification Report | Source contract, persisted evidence contract, Arango collection contract | Keep compatibility names. |
| Gate 1 | `Gate 1`, `Gate1Report`, `@factory/coverage-gates` | Coherence Verification | Package API, worker API, CI/runtime evidence, docs wording | Keep current APIs; alias in docs/schema exports. |
| Gate 2 | `Gate 2`, `Gate2Report`, `Gate2Verdict` | Fidelity Verification | Active worker runtime, PR #71 evidence, MRP evidence | Do not rename until worker and MRP compatibility are audited. |
| Gate 3 | `Gate 3`, `Gate3Report` | Persistence Verification | Schema/API and blocked monitored-promotion semantics | Keep current names until active monitoring exists. |
| Package names | `@factory/compiler`, `@factory/coverage-gates` | Compilation / Verification | Workspace dependency contract and import surface | Do not rename packages yet. |
| Runtime collections | `specs_prds`, `specs_workgraphs`, `specs_coverage_reports` | Ontology artifact buckets | Arango collection contract, seed/init/verify scripts, worker runtime | Do not rename without a data migration and live-read compatibility layer. |

## High-Risk Source Areas

| Area | Why it is high risk |
| --- | --- |
| `packages/compiler/src/*` | Encodes default artifact paths, PRD-to-WorkGraph ID derivation, Gate 1 pass flow, WorkGraph emission, and tests. |
| `packages/coverage-gates/src/*` | Owns Gate 1 evaluator and report emission contracts. |
| `packages/schemas/src/*` | Owns current schema exports. `core.ts` is protected and must not be changed without explicit approval. |
| `workers/ff-pipeline/src/*` | Active runtime path for Gate 2, MRP, lifecycle, diagnostics, and PR #71 evidence. |
| `workers/ff-gates/src/*` and `workers/ff-gateway/src/*` | Worker/API boundary for Gate 1 terminology and report shape. |
| `infra/arangodb/*` | Creates, seeds, and verifies current collection names. |
| `specs/workgraphs/*` and `specs/coverage-reports/*` | Lineage-bearing generated artifacts and evidence. |
| `packages/literate-tools/tangled/*` | Generated canonical-reference output that still uses current terms. |

## Rename Family Readiness

| Family | Ready for physical rename? | Reason |
| --- | --- | --- |
| Docs wording only | Partially | Low-risk docs now carry aliases, but canonical docs and generated/tangled files still use current terms intentionally. |
| Schema alias exports | Partially | `ontology-aliases.ts` exists; broader aliases would need affected package tests. |
| Package renames | No | Workspace dependencies, lockfile entries, generated repo inventories, and docs all reference current package names. |
| Artifact directory renames | No | Paths are lineage and compiler/runtime contracts. |
| Arango collection renames | No | Requires data migration, dual-read compatibility, seed/init changes, and live runtime validation. |
| Gate terminology rename in workers | No | Gate 2 and lifecycle evidence are live and must remain traceable. |

## Recommended Sequence

1. Keep current paths and APIs as compatibility names.
2. Add focused aliases only where they reduce confusion and are covered by
   package tests.
3. Write package README alias notes for any packages not covered by the first
   pass only when touched for related work.
4. For each candidate rename family, create a one-family migration proposal
   from `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md` with:
   - exact files touched,
   - old-to-new compatibility strategy,
   - rollback plan,
   - local tests,
   - docs audit,
   - remote PR checks,
   - live runtime evidence validation where applicable.
5. Keep `pnpm audit:ontology` and `pnpm audit:docs` green in CI before and
   after each rename-family proposal.
6. Only after aliases and migration plans are green, decide whether the rename
   is worth the churn.

## Explicit Non-Starters

- No mass rename of `specs/prds`, `specs/workgraphs`, or
  `specs/coverage-reports`.
- No package rename of `@factory/compiler` or `@factory/coverage-gates`.
- No Arango collection rename of `specs_prds`, `specs_workgraphs`, or
  `specs_coverage_reports`.
- No replacement of `Gate2Report`, `Gate2Verdict`, MRP, or lifecycle evidence
  terms while PR #71 runtime evidence remains active.
- No edit to `packages/schemas/src/core.ts` without explicit approval.

## Next Safe Step

The additive compatibility audit script now lives at
`scripts/audit-ontology-compat.mjs` and runs with:

```bash
pnpm audit:ontology
```

It verifies:

- current compatibility names remain exported,
- ontology aliases resolve to the same schemas,
- compiler default paths still resolve,
- docs links still resolve,
- runtime collection names used by workers match infra seed/init names.

Run it before any physical rename PR. Any future physical rename PR should also
start from `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`.

The root CI workflow also runs `pnpm audit:docs` and `pnpm audit:ontology` in
the `Repository Audit` job. The Factory PR Gate depends on that job, so future
rename proposals must preserve the compatibility contract before they can pass
the PR gate.
