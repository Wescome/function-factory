# Ontology Current Mapping

**Status:** Current-state compatibility crosswalk
**Date:** 2026-05-08
**Source references:** `FF-ONTOLOGY-v0.2.md`, `FF-REFACTORING-PLAN.md`,
`.agent/memory/semantic/DECISIONS.md`,
`.agent/memory/working/WORKSPACE.md`

This document maps the current repository vocabulary to the ontology v0.2
vocabulary without renaming live paths, packages, schemas, or APIs.

The current physical names are stable compatibility names. Ontology terms are
aliases for interpretation, documentation, and future non-breaking API aliases.
Physical renames require a separate compatibility audit, docs audit, tests, and
explicit rename decision.

## Alias Policy

| Current term | Ontology term | Status | Notes |
| --- | --- | --- | --- |
| PRD | Intent Specification | Stable compatibility name | `PRD-*` IDs and `specs/prds/` remain current. |
| WorkGraph | Executable Specification | Stable compatibility name | `WG-*` IDs and `specs/workgraphs/` remain current. |
| Gate 1 | Coherence Verification | Stable compatibility name | Compile coverage remains the live implementation name. |
| Gate 2 | Fidelity Verification | Stable compatibility name | Simulation coverage remains the live implementation name. |
| Gate 3 | Persistence Verification | Stable compatibility name | Assurance coverage remains the live implementation name. |
| Coverage Report | Verification Report | Stable compatibility name | `CR-*` IDs and `specs/coverage-reports/` remain current. |
| FunctionProposal | Function Proposal | Aligned | `FP-*` remains the proposal identity prefix. |
| Function | Function | Aligned | `FN-*` remains the executable unit identity prefix. |
| Invariant | Invariant Specification | Stable compatibility name | `INV-*` IDs and `specs/invariants/` remain current. |
| Contract | Execution Contract | Partial alias | `CONTRACT-*` artifacts remain current; Pan-aligned term is interpretive. |

## Artifact Buckets

| Current path | Ontology bucket | Migration status |
| --- | --- | --- |
| `specs/signals/` | Signal Artifact | Keep path. No rename planned in grounding slice. |
| `specs/pressures/` | Pressure Artifact | Keep path. Existing `PRS-*` references stay canonical. |
| `specs/capabilities/` | Capability Artifact | Keep path. Existing `BC-*` references stay canonical. |
| `specs/functions/` | Function Proposal and Function records | Keep path. Mixed `FP-*` and `FN-*` usage is current repo behavior. |
| `specs/prds/` | Intent Specification | Keep path. Alias in docs only. |
| `specs/workgraphs/` | Executable Specification | Keep path. WorkGraphs are compiler output and must not be hand-authored. |
| `specs/invariants/` | Invariant Specification | Keep path. Detector completeness rules remain unchanged. |
| `specs/coverage-reports/` | Verification Report | Keep path. Gate-specific report schemas remain current. |
| `specs/reference/` | Architecture/reference corpus | Keep path. Ontology v0.2 and stale-baseline plan live here. |
| `specs/ontology/` | Machine-readable ontology and shapes | Keep path. Current TTL/SHACL-like files are implementation assets. |

## Package Mapping

| Current package/path | Ontology responsibility | Migration status |
| --- | --- | --- |
| `packages/schemas/` | Canonical artifact schemas | Keep path and exports. `core.ts` is protected. |
| `packages/compiler/` | Compilation transformations | Keep path. Future docs may describe decomposition, binding, obligation extraction, assembly, and certification aliases. |
| `packages/coverage-gates/` | Coherence/Fidelity/Persistence verification support | Keep path. Do not rename to `verification` in this slice. |
| `packages/runtime/` | Runtime substrate | Keep path. Stubs and APIs remain compatibility names. |
| `packages/assurance-graph/` | Assurance Graph | Keep path. Alias already close to ontology. |
| `packages/artifact-validator/` | Artifact creation constraint enforcement | Keep path. Maps to ontology constraints and fail-closed persistence checks. |
| `packages/ontology-loader/` | Ontology loading/query substrate | Keep path. Implements the queryable ontology layer. |
| `packages/function-synthesis/` | Worker synthesis process | Keep path. Maps to ontology Agent Call / Worker execution processes. |
| `workers/ff-pipeline/` | Active runtime pipeline and diagnostics | Keep path. Current live evidence comes from this worker. |
| `workers/ff-gates/` | Gate worker boundary | Keep path. Maps to verification process execution. |
| `workers/ff-gateway/` | Gateway/API boundary | Keep path. Maps to orchestration entry points. |

## Verification Mapping

| Current implementation | Ontology alias | Current authority |
| --- | --- | --- |
| Gate 1 compile coverage | Coherence Verification | `@factory/coverage-gates`, compiler Gate 1 reports, `specs/coverage-reports/` |
| Gate 2 simulation coverage | Fidelity Verification | `workers/ff-pipeline/src/gate2-simulation.ts` and persisted Gate 2 reports |
| Gate 3 assurance coverage | Persistence Verification | Minimal blocker registration exists; monitored promotion remains out of scope here |
| `Gate1Report`, `Gate2Report`, `Gate3Report` | Verification Report variants | Existing schemas remain compatibility APIs |
| Merge Readiness Pack (MRP) | Readiness evidence overlay | Current runtime concept, not replaced by ontology v0.2 |
| Function identity diagnostic | Lineage and identity consistency check | Current runtime concept, not replaced by ontology v0.2 |
| Lifecycle transition guard | Fail-closed transition enforcement | Current runtime concept; ontology term is constraint enforcement |

## Runtime Current State

The refactoring plan was written against an older skeleton-state repository.
Current repo state is materially ahead of that baseline:

| Runtime concept | Current state | Mapping consequence |
| --- | --- | --- |
| `FN-MOTDWVR2-W7UN` | Materialized and accepted in live runtime evidence | Do not rename or rematerialize as part of ontology grounding. |
| PR #71 evidence | Live worker, Gate 2, MRP, lifecycle, and identity diagnostics exercised | Treat as authoritative current-state evidence. |
| Worker pipeline | Active under `workers/ff-pipeline/` | Keep paths stable until compatibility checks exist. |
| Gate 2 reports | Persisted in `specs_coverage_reports` live storage | Current Gate 2 naming remains compatibility API. |
| MRP records | Active merge-readiness evidence | Keep MRP terminology unless a separate ontology extension replaces it. |
| Function proposal/runtime split | `FP-*` proposal identity and `FN-*` function identity both matter | Preserve both identities and their lineage edge. |

## Migration Status Legend

| Status | Meaning |
| --- | --- |
| Stable compatibility name | Current name remains valid and should not be mass-renamed. |
| Aligned | Current name already matches ontology vocabulary closely enough. |
| Partial alias | Ontology term is useful but current implementation has extra semantics. |
| Deferred | Requires a separate compatibility PR, tests, and approval. |

## Deferred Work

- Package and specs README alias language has been added for low-risk docs.
- Non-breaking schema aliases have been added in
  `packages/schemas/src/ontology-aliases.ts`; existing schema names remain the
  compatibility APIs.
- Do not edit `.agent/AGENTS.md`, `.agent/skills/*`, protected schema modules,
  or directory names in this ontology-alignment pass.
- Do not promote any Function to `monitored` from this roadmap. Gate 3 active
  monitoring remains a separate runtime workstream.

## Physical Rename Decision

Physical renames are deferred. The compatibility names in this document remain
the active paths, package names, artifact IDs, schema exports, and runtime API
terms.

Do not create ontology-named replacement directories or packages in parallel
with the compatibility paths as a shortcut around the rename process. Examples
include `specs/intent-specifications`, `specs/executable-specifications`,
`specs/verification-reports`, `packages/verification`, or
`workers/ff-fidelity-verification`. Those targets require the same one-family
rename proposal and audit updates as any physical rename.

Do not introduce ontology-named replacement collection identifiers such as
`specs_intent_specifications`, `specs_executable_specifications`,
`specs_verification_reports`, `coherence_verifications`, or
`fidelity_verifications` without the same one-family proposal, dual-read
compatibility, and migration plan.

The machine-readable compatibility contract lives in
`ONTOLOGY-COMPATIBILITY-CONTRACT.json` and is enforced by
`pnpm audit:ontology`.

A future rename PR must first satisfy
`ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md`, be scoped to one rename family at a
time, start from `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`, and include:

1. Compatibility aliases already merged.
2. `pnpm audit:docs`.
3. `pnpm audit:ontology`.
4. Package tests for affected exports.
5. Full `pnpm -r typecheck`.
6. Reference search for stale paths and stale ontology aliases.
7. Explicit confirmation that live worker, MRP, lifecycle, and Gate evidence
   references remain valid.
8. Green remote `Repository Audit`, `Test`, `Typecheck`, and Factory PR Gate
   checks.
