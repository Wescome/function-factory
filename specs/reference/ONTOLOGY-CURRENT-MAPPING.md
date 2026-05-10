# Ontology Current Mapping

**Status:** Current-state compatibility crosswalk
**Date:** 2026-05-08
**Source references:** `DOMAIN-FACTORY-KERNEL.md`,
`FF-ONTOLOGY-v0.2.md`, `FF-ONTOLOGY-ADDENDUM-A.md`,
`FF-REFACTORING-PLAN.md`,
`.agent/memory/semantic/DECISIONS.md`,
`.agent/memory/working/WORKSPACE.md`

This document maps the current repository vocabulary to the domain-neutral
Factory kernel and ontology v0.2 vocabulary.

The domain-neutral kernel is canonical. Coding-specific names are adapter terms
or implementation debt, not ontology categories. New refactors should hard-cut
active surfaces to kernel names rather than accumulating permanent dual names.
Physical renames still require an explicit migration plan, docs audit, tests,
and an explicit rename decision.

## Domain Kernel Policy

The Factory kernel terms are Signal, Pressure, Capability, Function Proposal,
Function, Intent Specification, Executable Specification, Verification,
Evidence, Lifecycle, and Domain Adapter. Coding terms such as repository,
branch, pull request, diff, CI check, code review, deployment, Coder, and Tester
belong inside the coding Domain Adapter.

Do not promote coding-adapter terms into the kernel. When an active surface is
refactored, remove the old active name in that slice and migrate persisted data
where needed. Historical artifacts may keep their original names.

## Legacy Implementation Name Policy

| Current term | Ontology term | Status | Notes |
| --- | --- | --- | --- |
| Intent Specification | Intent Specification | Legacy implementation name | `IS-*` IDs and `specs/intent-specifications/` exist today; active refactors should cut to Intent Specification names. |
| Executable Specification | Executable Specification | Legacy implementation name | `ES-*` IDs and `specs/executable-specifications/` exist today; active refactors should cut to Executable Specification names. |
| Compile coverage numbered compatibility term | Coherence Verification | Legacy implementation name | Existing numbered APIs and IDs are migration debt. |
| Simulation coverage numbered compatibility term | Fidelity Verification | Legacy implementation name | Existing numbered APIs and IDs are migration debt. |
| Assurance coverage numbered compatibility term | Persistence Verification | Legacy implementation name | Existing numbered APIs and IDs are migration debt. |
| Verification Report | Verification Report | Legacy implementation name | `VR-*` IDs and `specs/verification-reports/` exist today; active refactors should cut to Verification Report names. |
| FunctionProposal | Function Proposal | Aligned | `FP-*` remains the proposal identity prefix. |
| Function | Function | Aligned | `FN-*` remains the executable unit identity prefix. |
| Invariant | Invariant Specification | Legacy implementation name | `INV-*` IDs and `specs/invariants/` exist today. |
| Contract | Execution Contract | Partial alias | `CONTRACT-*` artifacts remain current; Pan-aligned term is interpretive. |

## Coding Adapter Boundary

The current repository proves the kernel through a coding adapter. These terms
are adapter-local and should not appear as kernel categories in new
architecture.

| Coding adapter term | Kernel role | Migration status |
| --- | --- | --- |
| repository | Domain substrate | Keep inside coding adapter docs and runtime integration. |
| branch | Execution workspace | Do not model as a kernel lifecycle state. |
| pull request | Handoff artifact | Do not generalize as the Function output. |
| diff | Effector realization artifact | Domain-specific evidence/effect, not kernel evidence itself. |
| CI check | Verification evidence source | One possible evidence source among many. |
| code review | Human governance input | Adapter-local review workflow. |
| deployment | Lifecycle substrate transition | Adapter-local realization of promotion. |
| Coder / Tester | Adapter execution roles | Kernel role is Agent Call / Domain Adapter execution. |

## Legacy Pipeline Stage Concordance

`FF-ONTOLOGY-ADDENDUM-A.md` maps legacy numbered stages to ontology terms.
The numbered labels remain historical labels for interpreting historical
ConOps, memory, and skill material. Active docs and new code should lead with
the ontology category and include the numbered label only when it clarifies a
deferred migration surface.

| Legacy label | Ontology term | Current implementation surface |
| --- | --- | --- |
| Stage 1 | Signal Artifact collection | `specs/signals/`, `SIG-*`, `ExternalSignal` |
| Stage 2 | Pressure Artifact interpretation | `specs/pressures/`, `PRS-*`, `Pressure` |
| Stage 3 | Capability Artifact scoping | `specs/capabilities/`, `BC-*`, `BusinessCapability` |
| Stage 4 | Function Proposal decomposition | `specs/functions/`, `FP-*`, `FunctionProposal` |
| Stage 5 input | Intent Specification authoring | `specs/intent-specifications/`, `IS-*`, `IntentSpecificationDraft` |
| Stage 5 output | Executable Specification compilation | `specs/executable-specifications/`, `ES-*`, `Executable Specification` |
| Stage 6 | Agent Call execution / orchestration | `workers/ff-pipeline`, synthesis coordinator, agent role execution |
| Stage 7 | Persistence Verification / continuous assurance | runtime monitoring, detector freshness, regression evidence |

## Legacy Verification Gate Concordance

| Legacy label | Ontology term | Current implementation surface |
| --- | --- | --- |
| Coherence Verification | Coherence Verification | `CoherenceVerificationReport`, `runCoherenceVerification`, `coherence-verification`, `VR-*-COHERENCE-*` |
| Fidelity Verificationa | Fidelity Verification (learned) | simulated acceptance / model-assisted behavioral correspondence |
| Fidelity Verificationb | Fidelity Verification (deterministic) | deterministic scenario, invariant, and validation-result checks |
| Fidelity Verification | Fidelity Verification umbrella | `FidelityVerificationReport`, `FidelityVerificationInput`, `fidelity-verification`, `VR-*-FIDELITY-*` |
| Persistence Verification | Persistence Verification | `PersistenceVerificationReport`, `persistence-verification`, `VR-*-PERSISTENCE-*` |

## Legacy Compiler Pass Concordance

The current compiler has a live implementation-name conflict:
the repo historically implemented `Pass 8` as Executable Specification assembly, while
`FF-ONTOLOGY-ADDENDUM-A.md` reserves `Pass 8` for future Instruction Tuning.
Until a physical rename lands, current `08-assemble-executable-specification.ts`,
`assembleWorkgraph`, and `emitWorkgraph` remain migration-debt names for the
Structural Assembly completion step. New code must prefer
`assembleExecutableSpecification` and `emitExecutableSpecification`.

| Legacy label | Ontology term | Current implementation surface |
| --- | --- | --- |
| Pass 1 | Decomposition | `extractAtoms` |
| Pass 2 | Binding | `deriveContracts` |
| Pass 3 | Obligation Extraction | `deriveInvariants` |
| Pass 4 | Structural Assembly (dependency resolution) | `deriveDependencies` |
| Pass 5 | Structural Assembly (validation wiring) | `deriveValidations` |
| Pass 6 | Structural Assembly (graph construction / consistency reservation) | `consistencyCheck` plus current assembly flow |
| Pass 7 | Completeness Certification / Coherence Verification | `runCoherenceVerificationPass`, legacy `runCoherenceVerificationPass` |
| Current repo Pass 8 | Structural Assembly completion migration-debt label | `assembleWorkgraph`, `emitWorkgraph`, `08-assemble-executable-specification.ts` |
| Ontology Pass 8 | Instruction Tuning (future) | Not implemented; do not use current Executable Specification assembly as this category |

## Artifact ID Prefix Concordance

These prefixes are stable implementation identifiers, not ontology names.

| Prefix | Ontology category |
| --- | --- |
| `PRS-*` | Pressure Artifact |
| `BC-*` | Capability Artifact |
| `FP-*` / `FN-*` | Function Proposal / Function identity records |
| `IS-*` | Intent Specification |
| `ES-*` | Executable Specification |
| `INV-*` | Invariant Specification |
| `VR-*` | Verification Report |

## Skill File Concordance

Skill filenames remain current implementation names until a separate
charter/harness migration lands.

| Legacy skill file | Ontology role | Charter or harness |
| --- | --- | --- |
| `factory-meta/SKILL.md` | Factory bootstrap harness skill | Harness |
| `prd-compiler/SKILL.md` | Compilation harness skill | Harness |
| `coherence-verification/SKILL.md` | Coherence Verification enforcement | Charter |
| `fidelity-verification/SKILL.md` | Fidelity Verification enforcement | Charter |
| `persistence-verification/SKILL.md` | Persistence Verification enforcement | Charter |
| `invariant-authoring/SKILL.md` | Invariant authoring harness skill | Harness |
| `lineage-preservation/SKILL.md` | Lineage discipline enforcement | Charter |
| `memory-manager/SKILL.md` | Memory management harness skill | Harness |

## Post-v0.2 Stage Extensions

The current repo contains later numbered labels that are outside Addendum A's
original Stage 1-7 scope. They are repo-local process labels
extensions until the ontology receives a v0.3/addendum-B update.

| Current label | Ontology interpretation | Current surface |
| --- | --- | --- |
| Stage 8 | Merge Readiness / PR Handoff / Function identity materialization | MRP assembly, PR draft evidence, `FP-*` to `FN-*` materialization |
| Stage 8.5 | Selection-bias correction overlay | `packages/selection-bias`, historical adaptation notes |
| Stage 9 | Meta-Governance / policy evolution | `packages/meta-governance`, governance proposal artifacts |
| Stage 10 | Policy Activation / rollback control | `packages/policy-activation`, activation artifacts |

## Artifact Buckets

| Current path | Ontology bucket | Migration status |
| --- | --- | --- |
| `specs/signals/` | Signal Artifact | Keep path. No rename planned in grounding slice. |
| `specs/pressures/` | Pressure Artifact | Keep path. Existing `PRS-*` references stay canonical. |
| `specs/capabilities/` | Capability Artifact | Keep path. Existing `BC-*` references stay canonical. |
| `specs/functions/` | Function Proposal and Function records | Keep path. Mixed `FP-*` and `FN-*` usage is current repo behavior. |
| `specs/intent-specifications/` | Intent Specification | Keep path. Alias in docs only. |
| `specs/executable-specifications/` | Executable Specification | Keep path. Executable Specifications are compiler output and must not be hand-authored. |
| `specs/invariants/` | Invariant Specification | Keep path. Detector completeness rules remain unchanged. |
| `specs/verification-reports/` | Verification Report | Keep path. Verification report schemas keep legacy aliases. |
| `specs/reference/` | Architecture/reference corpus | Keep path. Ontology v0.2 and stale-baseline plan live here. |
| `specs/ontology/` | Machine-readable ontology and shapes | Keep path. Current TTL/SHACL-like files are implementation assets. |

## Package Mapping

| Current package/path | Ontology responsibility | Migration status |
| --- | --- | --- |
| `packages/schemas/` | Canonical artifact schemas | Keep path and exports. `core.ts` is protected. |
| `packages/compiler/` | Compilation transformations | Keep path. Future docs may describe decomposition, binding, obligation extraction, assembly, and certification aliases. |
| `packages/verification/` | Coherence/Fidelity/Persistence verification support | Keep path. Do not rename to `verification` in this slice. |
| `packages/runtime/` | Runtime substrate | Keep path. Stubs and APIs remain current names until implementation work lands. |
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
| Compile coverage | Coherence Verification | `@factory/verification`, compiler reports, `specs/verification-reports/` |
| Simulation coverage | Fidelity Verification | `workers/ff-pipeline/src/fidelityVerification-simulation.ts` and persisted Fidelity Verification reports |
| Assurance coverage | Persistence Verification | Minimal blocker registration exists; monitored promotion remains out of scope here |
| `CoherenceVerificationReport`, `FidelityVerificationReport`, `PersistenceVerificationReport` | Verification Report variants | Existing schemas are migration debt; new code should use Verification names. |
| Merge Readiness Pack (MRP) | Readiness evidence overlay | Current runtime concept, not replaced by ontology v0.2 |
| Function identity diagnostic | Lineage and identity consistency check | Current runtime concept, not replaced by ontology v0.2 |
| Lifecycle transition guard | Fail-closed transition enforcement | Current runtime concept; ontology term is constraint enforcement |

## Runtime Current State

The refactoring plan was written against an older skeleton-state repository.
Current repo state is materially ahead of that baseline:

| Runtime concept | Current state | Mapping consequence |
| --- | --- | --- |
| `FN-MOTDWVR2-W7UN` | Materialized and accepted in live runtime evidence | Do not rename or rematerialize as part of ontology grounding. |
| PR #71 evidence | Live worker, Fidelity Verification, MRP, lifecycle, and identity diagnostics exercised | Treat as authoritative current-state evidence. |
| Worker pipeline | Active under `workers/ff-pipeline/` | Keep paths stable until cutover checks exist. |
| Fidelity Verification reports | Persisted in `verification_reports` live storage | Current legacy storage discriminators remain deferred migration surfaces. |
| MRP records | Active merge-readiness evidence | Keep MRP terminology unless a separate ontology extension replaces it. |
| Function proposal/runtime split | `FP-*` proposal identity and `FN-*` function identity both matter | Preserve both identities and their lineage edge. |

## Migration Status Legend

| Status | Meaning |
| --- | --- |
| Legacy implementation name | Current name exists in active implementation but is not the desired kernel term. |
| Aligned | Current name already matches ontology vocabulary closely enough. |
| Partial alias | Ontology term is useful but current implementation has extra semantics. |
| Deferred | Requires a separate cutover PR, tests, and approval. |

## Deferred Work

- Package and specs README alias language exists from earlier grounding work;
  do not treat it as the target architecture.
- Non-breaking schema aliases exist in `packages/schemas/src/ontology-aliases.ts`;
  existing schema names are migration debt.
- Do not edit `.agent/AGENTS.md`, `.agent/skills/*`, protected schema modules,
  or directory names in this ontology-alignment pass.
- Do not promote any Function to `monitored` from this roadmap. Persistence
  Verification active monitoring remains a separate runtime workstream.

## Physical Cutover Decision

Physical renames are still explicit migration work, but the target is a hard
cutover to kernel terms rather than permanent compatibility baggage. The legacy
implementation names in this document remain present in current paths, package
names, artifact IDs, schema exports, and runtime API terms until their
respective cutover slices migrate them.

Do not create ontology-named replacement directories or packages in parallel
with legacy paths as a shortcut around the rename process. Examples
include `specs/intent-specifications`, `specs/executable-specifications`,
`specs/verification-reports`, `packages/verification`, or
`workers/ff-fidelity-verification`. Those targets require the same one-family
rename proposal and audit updates as any physical rename.

Do not introduce ontology-named replacement collection identifiers such as
`specs_intent_specifications`, `specs_executable_specifications`,
`specs_verification_reports`, `coherence_verifications`, or
`fidelity_verifications` without the same one-family proposal and data
migration plan.

The machine-readable hard-cutover guardrails live in
`ONTOLOGY-CUTOVER-CONSTRAINTS.json` and are enforced by `pnpm audit:ontology`.

A future cutover PR must first satisfy
`ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md`, be scoped to one rename family at a
time, start from `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`, and include:

1. A hard-cutover decision for the rename family.
2. `pnpm audit:docs`.
3. `pnpm audit:ontology`.
4. Package tests for affected exports.
5. Full `pnpm -r typecheck`.
6. Reference search for stale paths and stale ontology aliases.
7. Explicit migration handling for live worker, MRP, lifecycle, and
   Verification evidence references.
8. Green remote `Repository Audit`, `Test`, `Typecheck`, and Factory PR Gate
   checks.
