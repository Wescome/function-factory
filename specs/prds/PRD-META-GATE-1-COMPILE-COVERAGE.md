---
id: PRD-META-GATE-1-COMPILE-COVERAGE
sourceCapabilityId: BC-META-ENFORCE-COVERAGE-GATES
sourceFunctionId: FP-META-GATE-1-COMPILE-COVERAGE
title: Compile Coverage Gate (Gate 1)
source_refs:
  - FP-META-GATE-1-COMPILE-COVERAGE
  - BC-META-ENFORCE-COVERAGE-GATES
  - PRS-META-THREE-COVERAGE-GATES
  - SIG-META-WHITEPAPER-V4
explicitness: explicit
rationale: >
  First PRD authored under the Factory's own discipline during Bootstrap.
  Specifies Gate 1 (the Compile Coverage Gate) as a control Function running
  between Pass 7 (consistency_check) and Pass 8 (assemble_workgraph) of the
  Stage 5 compiler. Derived authoritatively from whitepaper §6.2 for the
  four coverage checks, §6.1 for the four coverage relationships the checks
  implement, §6.5 for Coverage Reports as first-class artifacts, §11 #6 for
  the non-negotiable status of the three-gate discipline; from ConOps §7.2
  for the operational remediation flow per defect class; from ConOps §4.1
  for the Bootstrap-specific META- prefix rule; and from the existing
  .agent/skills/coverage-gate-1/SKILL.md for agent-facing operational
  guidance. This PRD supersedes the SKILL.md as the architectural spec where
  they disagree — the SKILL.md is amended in a subsequent pass once this PRD
  compiles. The PRD also specifies a shared GateEvaluator shape that the
  subsequent Gate 2 and Gate 3 PRDs will cite, avoiding drift across the
  three gates' interface contracts.
---

# Compile Coverage Gate (Gate 1)

## Problem

The Stage 5 compiler transforms a PRD into a WorkGraph through eight narrow passes. Before Gate 1 exists as a fail-closed artifact-producing component, Pass 7 (consistency_check) is informal and Pass 8 (assemble_workgraph) will accept whatever Pass 7 returns. Nothing prevents a WorkGraph from emitting when the compiled specification is internally incomplete — an atom with no downstream contract, an invariant without a validation, a validation with no backmap, a dependency with a dangling endpoint. The compiler has no mechanism to observe incompleteness because the pass that should check it was specified informally.

This is the cheapest coverage failure to catch and the most expensive one to miss. A WorkGraph emitted from an incomplete spec will pass Stage 6 harness execution — the harness does not validate specification completeness; it executes the WorkGraph it was given. The coverage gap surfaces only in Stage 7 simulation or, worse, in production runtime telemetry, where the diagnostic trail is orders of magnitude noisier than a compile-time report. The trust computation for the resulting Function becomes a claim rather than a proof- the scoreboard reports healthy because it has no mechanism to observe the missing spec coverage.

Gate 1 closes this gap by hardening Pass 7 into an explicit, fail-closed, lineage-preserving coverage evaluation that runs before Pass 8. It is the first of the three Coverage Gates named in whitepaper §6 and the sixth non-negotiable in whitepaper §11. During Bootstrap mode, Gate 1 additionally enforces the META- prefix rule from ConOps §4.1 as a fifth check- a Bootstrap-phase PRD without the META- prefix, or a PRD whose intermediates reference non-META artifact IDs, is a Gate 1 failure.

## Goal

Implement Gate 1 as a pure deterministic function that takes the compiler's Pass 1–5 intermediate outputs (RequirementAtom[], Contract[], Invariant[], Dependency[], ValidationSpec[]) plus the PRD ID and Factory mode, computes four coverage checks per whitepaper §6.2 (atom coverage, invariant coverage, validation coverage, dependency closure) plus the Bootstrap META- prefix check per ConOps §4.1, emits a Gate1Report conforming to `packages/schemas/src/coverage.ts#Gate1Report`, writes the report to `specs/coverage-reports/CR-<PRD-ID>-GATE1-<ISO-timestamp>.yaml`, and halts the compiler before Pass 8 whenever the verdict is fail.

## Constraints

### Architectural constraints (inherited from the six non-negotiables)

Fail-closed discipline is absolute. All four coverage checks must pass for `overall: pass`; partial pass is fail. There is no soft-warning mode, no "degraded pass," no majority-of-checks rule. Whitepaper §6.2- "The cost of failing this gate is the cost of re-running the compiler. The cost of not having this gate is a generated implementation that passes Stage 6 and only discovers its specification gap in Stage 7, where the diagnostic trail is orders of magnitude noisier."

Lineage preservation is absolute. Gate1Report extends `Lineage` from `packages/schemas/src/lineage.ts`. `source_refs` must cite the PRD ID compiled and every artifact ID flagged in any failing check's detail arrays. `explicitness` is `explicit` for fields directly derived from the compiler intermediates; `inferred` only when the check's conclusion requires cross-pass reasoning not stated in any single input. `rationale` must be substantive — the literal string "TODO" is rejected by the schema.

Narrow-pass discipline. Gate 1 is a single evaluation between Pass 7 and Pass 8 of the Stage 5 compiler. It does not modify compiler intermediates. It does not derive new artifacts. It reads the validated inputs, computes the checks, produces the Gate1Report, writes it to disk, and returns.

Determinism. Identical validated inputs must produce identical Gate1Report contents modulo the `id` field (timestamp-suffixed) and `timestamp` field. This is load-bearing for audit- two auditors running Gate 1 against the same compiler intermediates must reach the same verdict with the same failing-artifact lists, and the Gate Evaluator role is defined in ConOps §3.4 by this determinism.

### Operational constraints (from ConOps §7.2 and §4.1)

Remediation text is populated on every Gate1Report, pass or fail. On fail, the text names each failing check, the specific artifact IDs that failed, and the upstream remediation required — referencing ConOps §7.2 Scenario B as the canonical remediation flow per defect class. On pass, the text is the literal string "no remediation required". Silent passes — Coverage Reports without remediation text — are rejected by the schema's `remediation: z.string().min(1)` constraint.

Bootstrap-mode additional check. Per ConOps §4.1 Rule 2, every artifact during Bootstrap must be tagged with the `META-` prefix. Gate 1 in Bootstrap mode additionally verifies that (a) the PRD ID being compiled matches the regex `^PRD-META-`, and (b) every artifact ID referenced in the compiler intermediates (atoms' source_refs, contracts' derivedFromAtomIds, invariants' derivedFromAtomIds and derivedFromContractIds, dependencies' from and to, validations' covers* arrays) has a `META-` prefix in its type-prefix segment. Absence of `META-` prefix during Bootstrap is a fifth class of Gate 1 failure, reported in a new `checks.bootstrap_prefix_check` field. The check is skipped entirely in Steady-State mode.

No placeholder generation. Gate 1 does not auto-create contracts, invariants, validations, or dependencies to paper over coverage misses. It reports the miss; remediation is upstream in the PRD, the FunctionProposal, or the Capability.

No check relaxation. Gate 1 does not vary its thresholds based on PRD size, urgency, or Coding Agent request. An Architect override is the only mechanism by which a failing Gate 1 verdict can be bypassed, and overrides are per-artifact, per-incident, and DECISIONS.md-logged per ConOps §5.4.

### Scope constraints (I/We boundary per whitepaper §2.1 and §8)

Gate 1 operates strictly on compiled specifications. It does not observe Work Orders, commissioning purpose, the Constraint Chain Index, Purpose Over Execution enforcement, or the Purpose Integrity Index. These are We-layer concerns governed by WeOps and are explicitly out of scope. A Gate 1 implementation that referenced any of these would be an I/We collapse and must be rejected at Critic Agent review.

## Acceptance criteria

1. Given a compiled specification in which all four coverage checks pass (no orphan atoms; every invariant has ≥1 validation and ≥1 well-formed detector; every validation has ≥1 covers* backmap; every dependency's `from` and `to` resolve to artifact IDs present in the compiler intermediates), Gate 1 emits a Gate1Report with `overall: pass` and allows compiler Pass 8 to run.

2. Given a compiled specification with one or more RequirementAtom IDs that do not appear in any downstream Contract's `derivedFromAtomIds`, Invariant's `derivedFromAtomIds`, or ValidationSpec's `coversAtomIds`, Gate 1 emits `overall: fail` with the offending atom IDs in `checks.atom_coverage.orphan_atoms` and `atom_coverage.status: fail`.

3. Given an Invariant with no ValidationSpec whose `coversInvariantIds` array contains its ID, Gate 1 emits `overall: fail` with the invariant ID in `checks.invariant_coverage.invariants_missing_validation` and `invariant_coverage.status: fail`.

4. Given an Invariant whose `detector` field does not conform to the DetectorSpec Zod schema (missing `evidence_sources`, empty `direct_rules`, empty `regression_policy`, or any other required-field violation), Gate 1 emits `overall: fail` with the invariant ID in `checks.invariant_coverage.invariants_missing_detector` and `invariant_coverage.status: fail`.

5. Given a ValidationSpec with all three of its `coversAtomIds`, `coversContractIds`, and `coversInvariantIds` arrays empty, Gate 1 emits `overall: fail` with the validation ID in `checks.validation_coverage.validations_covering_nothing` and `validation_coverage.status: fail`.

6. Given a Dependency whose `from` or `to` does not resolve to an artifact ID present in the union of Pass 1–5 outputs, Gate 1 emits `overall: fail` with the dependency ID in `checks.dependency_closure.dangling_dependencies` and `dependency_closure.status: fail`.

7. Given any combination of the above failures, Gate 1's `overall` verdict is `fail` and compiler Pass 8 does not execute. The partial pipeline state (Pass 1–5 intermediates, Pass 7 consistency report, the Gate1Report) is preserved on disk for debugging per ConOps §7.2 step 2.

8. On every invocation, pass or fail, Gate 1 writes the Gate1Report to `specs/coverage-reports/CR-<PRD-ID>-GATE1-<ISO-8601-timestamp>.yaml` before returning control to compiler orchestration. The file naming convention matches the coverage-gate-1 SKILL.md spec.

9. Every Gate1Report's `source_refs` contains the PRD ID and every artifact ID referenced in any failing check's detail arrays (orphan_atoms, invariants_missing_validation, invariants_missing_detector, validations_covering_nothing, dangling_dependencies, and on Bootstrap runs, bootstrap_prefix_check.non_meta_artifact_ids).

10. Every Gate1Report validates against the Zod `Gate1Report` schema in `packages/schemas/src/coverage.ts`. A Gate1Report that fails schema validation is a Gate 1 implementation defect, not a specification defect, and triggers the coverage-gate-1 SKILL.md self-rewrite hook.

11. Given identical validated inputs, Gate 1 produces Gate1Report contents that are byte-identical modulo the `id` (timestamp-suffixed) and `timestamp` fields. A non-deterministic Gate 1 is an implementation defect; the Gate Evaluator role's authority (ConOps §3.4) depends on this determinism.

12. Given Factory mode `bootstrap` and a PRD ID that does not match the regex `^PRD-META-`, Gate 1 emits `overall: fail` with `checks.bootstrap_prefix_check.status: fail` and the PRD ID in `bootstrap_prefix_check.non_meta_artifact_ids`. The check is skipped entirely in Factory mode `steady_state`.

13. Given Factory mode `bootstrap` and any artifact ID referenced in Pass 1–5 intermediates (atom IDs, contract IDs, invariant IDs, dependency endpoints, validation IDs, their source_refs, their covers* targets) that does not have a `META-` prefix in its type-prefix segment, Gate 1 emits `overall: fail` and includes those IDs in `bootstrap_prefix_check.non_meta_artifact_ids`.

14. The Gate1Report's `remediation` field is non-empty on every invocation. On pass, it contains the literal string "no remediation required". On fail, it contains human-readable text naming each failing check, the specific artifact IDs that failed, and the upstream remediation action the Coding Agent should take (per ConOps §7.2 Scenario B).

15. Gate 1 is implemented as a pure function with no side effects other than the Coverage Report file emission. No network calls. No environment reads beyond the validated inputs. No mutation of input arrays. No reads from `.agent/memory/` during evaluation (memory writes happen in the compiler orchestration layer, not inside Gate 1).

## Success metrics

Gate 1 pass rate by defect class, per ConOps §10.1. Concentration of failures in a single class (e.g., `invariants_missing_detector` dominating) is a diagnostic signal about upstream skill discipline, not about Gate 1 itself. A dominant failure class triggers review of the corresponding authoring skill (invariant-authoring, prd-compiler, or lineage-preservation).

Zero false passes across the Factory's operational lifetime. A false pass is a Gate1Report with `overall: pass` where one of the four checks should have flagged a real coverage miss. A single false pass is an implementation defect that triggers the coverage-gate-1 SKILL.md self-rewrite hook and a root-cause review by the Architect per ConOps §10.1.

Remediation-text actionability. On every Gate 1 failure, a Coding Agent should be able to execute the remediation per ConOps §7.2 without consulting Gate 1's source code. If the remediation text is ambiguous, the failure mode is a PRD authorship defect (the upstream PRD did not provide enough structure); if the remediation text points in the wrong direction, the failure mode is a Gate 1 implementation defect.

Determinism verification. Quarterly, a Gate 1 regression test replays a canonical compile intermediate through the current Gate 1 implementation and asserts byte-identical Gate1Report contents modulo the timestamp and id fields. Any divergence is a P0 issue and triggers immediate Architect review.

Architect override rate specifically on Gate 1 verdicts, per ConOps §10.3. A rising rate is a signal that either (a) Gate 1's checks are miscalibrated relative to PRD authorship reality, or (b) PRD authorship is systematically producing incomplete specifications the Architect is choosing to ship anyway. Either is a diagnostic signal warranting investigation; neither is resolved by relaxing Gate 1.

## Out of scope

Simulation coverage (Gate 2) and assurance coverage (Gate 3) are not implemented by this Function. They are separate Functions derived from the same Capability (BC-META-ENFORCE-COVERAGE-GATES) and will be specified in `PRD-META-GATE-2-SIMULATION-COVERAGE` and `PRD-META-GATE-3-ASSURANCE-COVERAGE` respectively.

Runtime detector liveness. Gate 1 checks that DetectorSpecs are well-formed at compile time (presence of evidence_sources, direct_rules, regression_policy). Whether the detector actually emits, whether the named evidence source is live, whether the audit pipeline is intact — all Gate 3 concerns per whitepaper §6.4.

Scenario coverage. Whether invariants are actually exercised by test scenarios is Gate 2's domain per whitepaper §6.3. Gate 1 checks that scenarios exist as ValidationSpecs with valid backmaps; Gate 2 checks that they run and exercise what they claim to cover.

Trust composite computation. Gate 1 does not compute any of the five trust dimensions (correctness, compliance, observability, stability, user response). Trust applies to Functions in `monitored` state (whitepaper §5); Gate 1 operates at compile time before any Function exists.

Automatic PRD remediation. Gate 1 produces remediation text. The Coding Agent executes the remediation per ConOps §7.2 Scenario B. Gate 1 does not edit PRDs, does not open pull requests, does not notify reviewers beyond Coverage Report emission.

Work Order governance, CCI, POE, PII, or any We-layer concept. These are governed by WeOps per whitepaper §8. A Gate 1 implementation that referenced any of these would be an I/We collapse.

Persistent state across invocations. Gate 1 holds no state between invocations. Coverage history is reconstructed from the Coverage Reports committed to `specs/coverage-reports/`, not from Gate 1's memory. Rate-of-failure analysis and trend detection run outside Gate 1.

## Shared GateEvaluator shape

Gate 2 and Gate 3 will be specified in their own PRDs. Those PRDs will reuse the evaluator shape defined here. Recording the shape in this PRD rather than in each of the three individually avoids drift and gives a single cite-able specification for the abstract contract.

A GateEvaluator is a deterministic pure function of the form `(input, mode) => CoverageReport` where `input` is a gate-specific Zod-validated structure, `mode` is the Factory mode (`bootstrap` | `steady_state`), and `CoverageReport` is the discriminated union in `packages/schemas/src/coverage.ts`. Three properties are invariant across all three gates.

First, fail-closed semantics. An evaluator that cannot compute its verdict — because an input is missing, a schema has drifted, a dependency is offline — does not return a pass verdict. It returns a fail verdict with remediation text naming the uncomputable state. Per ConOps §4.3, a gate that cannot compute is treated as fail for any artifact awaiting its verdict; there is no silent-pass fallback.

Second, lineage preservation. Every Coverage Report a GateEvaluator emits extends `Lineage`, populates `source_refs` with every artifact ID the verdict depends on, tags derived fields with `explicitness`, and populates `rationale` substantively. Coverage Reports are themselves first-class Factory artifacts (whitepaper §6.5) and are committed to git alongside the artifacts they concern.

Third, emission on every invocation. A GateEvaluator writes a Coverage Report to `specs/coverage-reports/` on pass and on fail. The absence of a Coverage Report is never interpretable as a pass. Silent gate invocations are architecturally forbidden.

The shape applies here, to Gate 2's PRD, and to Gate 3's PRD without modification. Differences among gates are in the inputs, the specific checks, and the failure-consequence behavior — halt compile (Gate 1), block `verified` → `monitored` promotion (Gate 2), transition to `assurance_regressed` (Gate 3). The shape itself is shared.

## Schema amendment required

The Bootstrap META- prefix check (acceptance criteria 12 and 13) requires a new field on the Gate1Report schema in `packages/schemas/src/coverage.ts`. Proposed shape:

```typescript
bootstrap_prefix_check: CoverageCheck.extend({
  non_meta_artifact_ids: z.array(ArtifactId).default([]),
}).optional(),  // optional because only populated when Factory mode is bootstrap
```

This is a Class B architectural change per ConOps §12.1 — it modifies a canonical schema in `packages/schemas/src/core.ts`'s sibling `coverage.ts`, both under the "never allowed" list in `.agent/protocols/permissions.md` for unapproved modification. The amendment requires Architect approval via a DECISIONS.md entry before the schema PR can be merged.

The PRD is authored before the schema is amended so that the amendment is explicitly requested in context. Proceeding with Gate 1 implementation without the amendment would require either (a) silently skipping the Bootstrap check, which is unacceptable because ConOps §4.1 names it as a Bootstrap rule, or (b) inlining the check outside the Gate1Report schema, which is unacceptable because Coverage Reports are first-class lineage-preserving artifacts and inline checks break that discipline.

Two companion Class B changes should be bundled with the schema amendment:

1. The `coverage-gate-1/SKILL.md` file does not currently mention the META- prefix check. The SKILL.md should be amended to include the Bootstrap check in its "Four coverage checks" section (which becomes "Five coverage checks" in Bootstrap mode, four of which run in Steady-State).

2. The `lineage-preservation/SKILL.md` anti-pattern #1 ("Empty source_refs. Never.") does not carve out an exception for Stage 1 Signals. Now that a Signal (SIG-META-WHITEPAPER-V4) exists with empty `source_refs` by design, the skill anti-pattern should be amended to read "Empty source_refs. Never, except for Stage 1 Signals, whose origin is cited in the `source` field rather than in `source_refs`."

Both skill amendments are proposed in this PRD's downstream DECISIONS.md entry.

## Downstream artifacts Gate 1 will enable

A passing Gate 1 verdict is the precondition for compiler Pass 8 to execute, which in turn is the precondition for every subsequent Factory stage against this PRD. A Gate 1 implementation is therefore the precondition for the Factory's first WorkGraph emission.

The first WorkGraph the Factory emits will be `WG-META-GATE-1-COMPILE-COVERAGE` — the implementation of Gate 1 itself, compiled from this PRD through the compiler Gate 1 itself gated. That is the bootstrap proof- the Factory's first compiled artifact is the gate that compiled it.

Whether that compile passes or fails on its first run is not the point. The Coverage Report from that first compile (`CR-PRD-META-GATE-1-COMPILE-COVERAGE-GATE1-<timestamp>.yaml`) is the artifact that matters. Whether it reports pass (Gate 1 as specified is internally complete) or fail (Gate 1 as specified is not internally complete), the report is the evidence that the Factory is checking itself by the same discipline it will apply to every subsequent artifact. A failing first report is not a setback; it is the Factory's first diagnostic about its own state. A passing first report is not the end of Bootstrap; it is the beginning.
