---
id: IS-META-SIMULATION-COVERAGE
sourceCapabilityId: BC-META-ENFORCE-SIMULATION-COVERAGE
sourceFunctionId: FP-META-SIMULATION-COVERAGE-EXECUTION
title: Simulation Verification (Fidelity Verification)
source_refs:
  - FP-META-SIMULATION-COVERAGE-EXECUTION
  - FP-META-SIMULATION-COVERAGE-CONTROL
  - FP-META-SIMULATION-COVERAGE-EVIDENCE
  - BC-META-ENFORCE-SIMULATION-COVERAGE
  - PRS-META-SIMULATION-COVERAGE
  - SIG-META-FIDELITY-REACHABLE
  - SIG-META-WHITEPAPER-V4
  - IS-META-COHERENCE-VERIFICATION
explicitness: explicit
rationale: >
  Fidelity Verification Intent Specification authored under bootstrap carve-out. Stage 6 function synthesis
  now produces FidelityVerificationInput bundles (SIG-META-FIDELITY-REACHABLE), but no evaluator
  consumes them. Every Function produced by Stage 6 is stuck at lifecycle state
  'implemented' indefinitely. Fidelity Verification evaluates whether the produced code
  satisfies the specification's invariants and scenarios before promotion to
  'verified'. It reuses the shared verification evaluator shape from
  IS-META-COHERENCE-VERIFICATION and operates strictly on FidelityVerificationInput -- never on raw
  Stage6TraceLogs. Derived from whitepaper section 6.3 (three coverage checks),
  ConOps section 3.4 (Verification Evaluator determinism), ratified FidelityVerificationInput schema
  (ratified-decisions.md lines 488-528), FidelityVerificationReport and FidelityVerificationVerdict schemas
  in packages/schemas/src/coverage.ts, and the three FunctionProposals
  (EXECUTION, CONTROL, EVIDENCE).
---

# Simulation Verification (Fidelity Verification)

## Problem

Stage 6 function synthesis produces code, tests, and evidence artifacts. The evidence Function emits FidelityVerificationInput bundles conforming to the ratified Zod schema. No evaluator consumes those bundles. Every Function produced by Stage 6 remains at lifecycle state 'implemented' with no mechanism to transition to 'verified'.

Coherence Verification proves the specification is internally complete. Stage 6 proves the topology can produce code from specifications. The chain is missing its next link: proof that the produced code actually satisfies the specification it was produced from. Without Fidelity Verification, code promotion is trust-by-assumption. A Function that compiled and whose tests passed in isolation has not been proven against its invariants under scenario execution. The whitepaper names this explicitly in section 6.3: "The Factory requires that tests passing on a complete scenario corpus is the shipping condition."

The pressure is near-maximal. PRS-META-SIMULATION-COVERAGE rates strength at 1.0, urgency at 0.9, confidence at 1.0. Whitepaper section 11 non-negotiable number 6 requires three fail-closed Verification Gates. Coherence Verification is implemented. Persistence Verification is deferred until Functions reach 'monitored'. Fidelity Verification is now reachable and its absence is an active operational gap.

Fidelity Verification reuses the shared GateEvaluator shape from IS-META-COHERENCE-VERIFICATION: a deterministic pure function of the form `(input, mode) => VerificationReport`, with fail-closed semantics, lineage preservation, and emission on every invocation. The differences from Coherence Verification are the inputs (FidelityVerificationInput instead of compiler intermediates), the specific checks (scenario coverage, invariant exercise, required-validation pass rate instead of atom/invariant/validation/dependency coverage), and the failure consequence (block 'implemented' to 'verified' promotion instead of halting the compiler).

## Goal

Implement Fidelity Verification as a deterministic pure function that takes a FidelityVerificationInput bundle (the normalized evidence from Stage 6) and the Factory mode, computes three coverage checks per whitepaper section 6.3, emits a FidelityVerificationReport conforming to `packages/schemas/src/coverage.ts#FidelityVerificationReport` and a FidelityVerificationVerdict conforming to `packages/schemas/src/coverage.ts#FidelityVerificationVerdict`, writes the report to `specs/verification-reports/VR-<FN-ID>-FIDELITY-<ISO-timestamp>.yaml`, and blocks the lifecycle transition from 'implemented' to 'verified' whenever the verdict is fail.

Three co-specified Functions deliver the capability. The execution Function (FP-META-SIMULATION-COVERAGE-EXECUTION) runs the three coverage checks against FidelityVerificationInput and produces a verdict. The control Function (FP-META-SIMULATION-COVERAGE-CONTROL) enforces fail-closed discipline and resolves disagreements between the Stage 6 Verifier verdict and the Fidelity Verification acceptance verdict. The evidence Function (FP-META-SIMULATION-COVERAGE-EVIDENCE) captures the FidelityVerificationVerificationReport as a lineage-preserving artifact for downstream trust computation.

## Constraints

### Shared GateEvaluator shape (cited from IS-META-COHERENCE-VERIFICATION)

Fidelity Verification conforms to the GateEvaluator shape: `(FidelityVerificationInput, FactoryMode) => FidelityVerificationReport`. Three invariant properties apply identically to Fidelity Verification as they do to Coherence Verification and will to Persistence Verification.

Fail-closed semantics. An evaluator that cannot compute its verdict returns a fail verdict with remediation text naming the uncomputable state. A verification that cannot compute is treated as fail. There is no silent-pass fallback.

Lineage preservation. Every FidelityVerificationReport extends `Lineage`, populates `source_refs` with every artifact ID the verdict depends on (function_id, intent_specification_id, executable-specification_id, candidate_id from FidelityVerificationInput), tags derived fields with `explicitness`, and populates `rationale` substantively.

Emission on every invocation. Fidelity Verification writes a Verification Report to `specs/verification-reports/` on pass and on fail. The absence of a Verification Report is never interpretable as a pass.

### ACL boundary constraint

Fidelity Verification consumes FidelityVerificationInput only. It never reads raw Stage6TraceLogs, raw execution traces, raw tool call records, or any Stage 6 intermediate artifact. The contract boundary is clean: Stage 6 produces evidence through its evidence Function; Fidelity Verification evaluates the normalized bundle. If FidelityVerificationInput is insufficient for a coverage check, the correct fix is to amend FidelityVerificationInput upstream, not to grant Fidelity Verification read access to raw traces.

### Verification check constraints

Fidelity Verification computes three checks per whitepaper section 6.3 and the FidelityVerificationReport schema.

Scenario coverage. Every invariant defined in the Executable Specification that the Function implements must have at least one passing scenario in FidelityVerificationInput.evidence.validation_outcomes. An invariant without a passing scenario is untested. The check maps validation outcomes to invariant IDs via the Executable Specification's invariant-to-validation backmaps. Unexercised invariants are reported in `checks.scenario_coverage.branches_unexercised` with the Executable Specification node and reason.

Invariant exercise. Every invariant must have at least one scenario that could plausibly violate it -- a negative test. An invariant exercised only by positive tests has not been proven; it has been assumed. Invariants without negative tests are reported in `checks.invariant_exercise.invariants_without_negative_tests`.

Required-validation pass rate. 100% of validations with `priority: required` must pass. Below 100% is not partial credit; it is fail. The rate is computed from FidelityVerificationInput.evidence.validation_outcomes filtered to required-priority validations. Failing validations are reported in `checks.required_validation_pass_rate.failing_validations` with the computed rate in `checks.required_validation_pass_rate.rate`.

All three checks must pass for `overall: pass`. Partial pass is fail. There is no soft-warning mode, no degraded pass, no majority-of-checks rule.

### Compile and test precondition constraints

FidelityVerificationInput carries `evidence.compile_summary` and `evidence.test_summary`. If `compile_summary` indicates a compile failure or `test_summary` indicates test failures, Fidelity Verification emits `overall: fail` with remediation noting that the produced code did not compile or its tests did not pass. These are preconditions, not coverage checks -- they must hold before the three coverage checks are meaningful.

### Disagreement resolution constraints

When the Stage 6 Verifier verdict (carried in FidelityVerificationInput.verifier_verdict) is `pass` but Fidelity Verification verdict is `rejected`, a disagreement exists. Disagreements are classified per DECISIONS 2026-04-24 into three classes.

Repairable_local: the coverage gap is addressable by targeted repair (adding a missing scenario, fixing a failing required validation). The control Function triggers a repair cycle.

Architectural: the coverage gap indicates a structural problem with the ArchitectureCandidate or Executable Specification. Blind replay is forbidden. The control Function flags the disagreement for candidate re-evaluation.

Governance: the disagreement involves scope violations or hard-constraint violations (FidelityVerificationInput.evidence.scope_violation or hard_constraint_violation is true). The control Function routes to human approval. No autonomous retry.

### Determinism constraint

Given identical FidelityVerificationInput and Factory mode, Fidelity Verification produces identical FidelityVerificationReport contents modulo the `id` field (timestamp-suffixed) and `timestamp` field. This determinism is load-bearing for audit per ConOps section 3.4: "The Verification Evaluator has no discretion. It applies coverage formulas to Zod-validated inputs and produces a verdict: pass or fail."

### Lifecycle transition constraint

Fidelity Verification's verdict governs the 'implemented' to 'verified' lifecycle transition. On `overall: pass`, the Function is authorized to transition. On `overall: fail`, the Function remains at 'implemented'. The transition itself is not executed by Fidelity Verification -- Fidelity Verification emits the verdict and the lifecycle manager reads the verdict. Fidelity Verification does not mutate lifecycle state directly; it produces the evidence the lifecycle manager consumes. This separation ensures Fidelity Verification remains a pure evaluator with no side effects beyond report emission.

A Function that fails Fidelity Verification is not broken. It compiled (Coherence Verification passed). It was produced by Stage 6 (the Verifier may have passed). It simply lacks proof that its produced code satisfies its specification under scenario execution. The remediation path is additive: add scenarios, add negative tests, fix failing validations, or re-run synthesis with an improved ArchitectureCandidate.

### No check relaxation constraint

Fidelity Verification does not vary its thresholds based on Function complexity, Intent Specification size, urgency, or Coding Agent request. An Architect override is the only mechanism by which a failing Fidelity Verification verdict can be bypassed, and overrides are per-artifact, per-incident, and DECISIONS.md-logged per ConOps section 5.4. No override mechanism exists within Fidelity Verification itself.

### No placeholder generation constraint

Fidelity Verification does not auto-create scenarios, negative tests, or validation results to paper over coverage misses. It reports the miss; remediation is upstream in Stage 6 (re-synthesis with better scenario coverage) or in the Executable Specification (add missing invariant-to-validation mappings).

### Scope constraints (I/We boundary)

Fidelity Verification operates strictly on Stage 6 evidence. It does not observe Work Orders, commissioning purpose, the Constraint Chain Index, Purpose Over Execution enforcement, or any We-layer concept. A Fidelity Verification implementation that referenced any of these would be an I/We collapse.

## Acceptance criteria

### Execution Function (coverage evaluation)

1. Given a FidelityVerificationInput where every invariant in the referenced Executable Specification has at least one passing scenario, at least one negative test, and all required validations pass, Fidelity Verification emits a FidelityVerificationReport with `overall: pass` and a FidelityVerificationVerdict with `verdict: accepted`. Test: construct a FidelityVerificationInput with full scenario and invariant coverage; verify FidelityVerificationReport.overall is `pass` and FidelityVerificationVerdict.verdict is `accepted`.

2. Given a FidelityVerificationInput where one or more invariants have no passing scenario in validation_outcomes, Fidelity Verification emits `overall: fail` with those invariants identified in `checks.scenario_coverage.branches_unexercised`. Test: construct a FidelityVerificationInput missing scenario coverage for two invariants; verify both appear in branches_unexercised with executable-specification_node references.

3. Given a FidelityVerificationInput where one or more invariants have only positive tests (no negative/violation test), Fidelity Verification emits `overall: fail` with those invariant IDs in `checks.invariant_exercise.invariants_without_negative_tests`. Test: construct a FidelityVerificationInput with an invariant covered only by positive scenarios; verify the invariant ID appears in the failing array.

4. Given a FidelityVerificationInput where any required-priority validation in validation_outcomes has status `fail`, Fidelity Verification emits `overall: fail` with the failing validation IDs in `checks.required_validation_pass_rate.failing_validations` and the computed rate below 1.0. Test: construct a FidelityVerificationInput with one required validation failing out of four; verify rate is 0.75 and overall is fail.

5. Given a FidelityVerificationInput where compile_summary indicates compile failure, Fidelity Verification emits `overall: fail` without computing the three coverage checks. Remediation text names the compile failure as the blocking precondition. Test: provide a FidelityVerificationInput with a failing compile_summary; verify overall is fail and remediation references compilation.

6. Given a FidelityVerificationInput where test_summary indicates test failures, Fidelity Verification emits `overall: fail` without computing the three coverage checks. Remediation text names the test failure as the blocking precondition. Test: provide a FidelityVerificationInput with a failing test_summary; verify overall is fail and remediation references test failures.

7. Given any combination of coverage check failures, Fidelity Verification's `overall` verdict is `fail` and the lifecycle transition from 'implemented' to 'verified' is blocked. Test: construct a FidelityVerificationInput failing all three checks simultaneously; verify overall is fail and all three check statuses are fail.

### Control Function (fail-closed discipline and disagreement)

8. Every Fidelity Verification invocation produces a verdict. No FidelityVerificationInput enters the evaluator and exits without a FidelityVerificationReport and FidelityVerificationVerdict being emitted. Test: invoke Fidelity Verification with valid FidelityVerificationInput; verify both a FidelityVerificationReport file and FidelityVerificationVerdict object are produced.

9. When FidelityVerificationInput.verifier_verdict is `pass` but Fidelity Verification verdict is `rejected`, the control Function classifies the disagreement. Given a missing-scenario gap with no scope or hard-constraint violations, classification is `repairable_local`. Test: provide matching conditions; verify disagreement classification.

10. When FidelityVerificationInput.evidence.scope_violation or hard_constraint_violation is true and the Verifier verdict was `pass`, disagreement classification is `governance` and no autonomous retry occurs. Test: set scope_violation to true; verify classification is governance and no retry is triggered.

11. No partial-credit promotion. A FidelityVerificationInput that passes two of three checks but fails one results in `overall: fail` and the Function remains at 'implemented'. Test: construct a FidelityVerificationInput passing scenario_coverage and invariant_exercise but failing required_validation_pass_rate; verify overall is fail.

### Evidence Function (report persistence and lineage)

12. On every invocation, pass or fail, Fidelity Verification writes a FidelityVerificationReport to `specs/verification-reports/VR-<FN-ID>-FIDELITY-<ISO-8601-timestamp>.yaml`. Test: invoke Fidelity Verification twice (one pass, one fail); verify two distinct Verification Report files exist at the expected paths.

13. Every FidelityVerificationReport validates against the Zod `FidelityVerificationReport` schema in `packages/schemas/src/coverage.ts`. A FidelityVerificationReport that fails schema validation is a Fidelity Verification implementation defect. Test: parse every emitted FidelityVerificationReport with FidelityVerificationReport.safeParse; verify success.

14. Every FidelityVerificationReport's `source_refs` contains the function_id, intent_specification_id, executable-specification_id, and candidate_id from the FidelityVerificationInput, plus every artifact ID referenced in any failing check's detail arrays. Test: invoke Fidelity Verification with a failing FidelityVerificationInput; verify source_refs includes all expected IDs.

15. Every FidelityVerificationVerdict validates against the Zod `FidelityVerificationVerdict` schema in `packages/schemas/src/coverage.ts`. Test: parse every emitted FidelityVerificationVerdict with FidelityVerificationVerdict.safeParse; verify success.

16. The FidelityVerificationReport's `remediation` field is non-empty on every invocation. On pass, it contains the literal string "no remediation required". On fail, it contains human-readable text naming each failing check, the specific artifact IDs that failed, and the remediation action. Test: verify remediation field on both pass and fail invocations.

### Determinism and purity

17. Given identical FidelityVerificationInput and Factory mode, Fidelity Verification produces FidelityVerificationReport contents that are byte-identical modulo the `id` and `timestamp` fields. Test: invoke Fidelity Verification twice with the same inputs; verify output identity modulo timestamps.

18. Fidelity Verification is implemented as a pure function with no side effects other than Verification Report file emission. No network calls. No environment reads beyond the validated inputs. No mutation of FidelityVerificationInput. No reads from `.agent/memory/` during evaluation. Test: instrument the evaluator boundary; verify no external I/O occurs during evaluation.

### Bootstrap-mode compliance

19. Given Factory mode `bootstrap`, the FidelityVerificationReport's function_id, intent_specification_id, and executable-specification_id all match the regex `^(FN|Intent Specification|ES)-META-`. Fidelity Verification does not enforce the META- prefix itself (that is Coherence Verification's job); it validates that its own inputs carry the prefix. Test: provide a FidelityVerificationInput with non-META intent_specification_id in bootstrap mode; verify Fidelity Verification emits fail with remediation noting the prefix violation.

### Schema conformance

20. Every FidelityVerificationInput consumed by Fidelity Verification must pass FidelityVerificationInput.safeParse before evaluation proceeds. If the input fails schema validation, Fidelity Verification emits `overall: fail` with remediation naming the schema validation error. Fidelity Verification does not attempt to evaluate malformed input. Test: provide a FidelityVerificationInput missing the required `evidence.validation_outcomes` field; verify Fidelity Verification emits fail with schema-validation remediation text.

21. The FidelityVerificationVerdict emitted by Fidelity Verification carries `scenario_verification_score` and `invariant_exercise_rate` as numbers between 0 and 1. The scenario_verification_score is the fraction of invariants with at least one passing scenario. The invariant_exercise_rate is the fraction of invariants with at least one negative test. Both scores are 1.0 on pass. Test: construct a FidelityVerificationInput where 3 of 4 invariants have passing scenarios and 2 of 4 have negative tests; verify scenario_verification_score is 0.75 and invariant_exercise_rate is 0.5.

## Success metrics

Zero false passes across the Factory's operational lifetime. A false pass is a FidelityVerificationReport with `overall: pass` where one of the three checks should have flagged a real coverage miss. A single false pass triggers the fidelity-verification SKILL.md self-rewrite hook and root-cause review by the Architect.

Fidelity Verification pass rate by check class. Concentration of failures in scenario_coverage versus invariant_exercise versus required_validation_pass_rate is a diagnostic signal about upstream Stage 6 discipline. A dominant failure class triggers review of the corresponding Function synthesis role contracts or the evidence Function's normalization logic.

Disagreement resolution correctness. Zero governance-class disagreements resolved without human approval. Zero architectural disagreements resolved via blind replay. Disagreement classification accuracy is auditable from FidelityVerificationReports and FidelityVerificationVerdicts.

Remediation-text actionability. On every Fidelity Verification failure, a Coding Agent should be able to execute the remediation without consulting Fidelity Verification's source code. Ambiguous remediation text is a Intent Specification authorship defect upstream; misdirected remediation text is a Fidelity Verification implementation defect.

Determinism verification. Quarterly, a Fidelity Verification regression test replays a canonical FidelityVerificationInput through the current Fidelity Verification implementation and asserts byte-identical FidelityVerificationReport contents modulo timestamp and id. Divergence is a P0 issue.

Verification Report emission rate. 100% of Fidelity Verification invocations produce a persisted FidelityVerificationReport. A missing Verification Report is an evidence Function defect. The emission rate is the most basic operational health metric for Fidelity Verification.

Architect override rate on Fidelity Verification verdicts, per ConOps section 10.3. A rising rate signals either miscalibrated checks or systematically incomplete Stage 6 evidence production. Either warrants investigation; neither is resolved by relaxing Fidelity Verification.

## Out of scope

Coherence Verification compile coverage. Coherence Verification operates at the end of Stage 5 on compiler intermediates. Fidelity Verification operates downstream on Stage 6 evidence. The two gates share the GateEvaluator shape but are separate Functions with separate inputs and separate failure consequences.

Persistence Verification assurance coverage. Persistence Verification operates continuously on deployed, monitored Functions. Fidelity Verification operates as a one-shot evaluation before the 'implemented' to 'verified' transition. Persistence Verification is deferred until Functions reach 'monitored'.

Stage 6 function synthesis. Fidelity Verification consumes the FidelityVerificationInput bundle that Stage 6 produces. The synthesis topology, role contracts, binding modes, and repair loops are specified in IS-META-FUNCTION-SYNTHESIS. Fidelity Verification evaluates what Stage 6 produces; it does not participate in production.

FidelityVerificationInput schema amendments. If FidelityVerificationInput is insufficient for a coverage check, the amendment is a separate DECISIONS.md entry and a schema change in the ratified schema module. Fidelity Verification operates on the current FidelityVerificationInput schema as ratified.

Trust composite computation. Fidelity Verification produces evidence (FidelityVerificationReport, FidelityVerificationVerdict) that feeds into downstream trust computation. The computation of the five trust dimensions (correctness, compliance, observability, stability, user response) is a separate capability. Fidelity Verification does not compute trust scores.

Architecture search and candidate selection. The ArchitectureCandidate referenced in FidelityVerificationInput.candidate_id was selected upstream. Fidelity Verification does not evaluate or score candidates; it evaluates the evidence produced by a synthesis that used a given candidate.

Work Order governance, CCI, POE, PII, or any We-layer concept. Explicitly out of scope per whitepaper section 8. Fidelity Verification is an I-layer evaluator.

Digital Twin Universe orchestration. Whitepaper section 6.3 describes Fidelity Verification running "after the generated artifact has been deployed into the Digital Twin Universe." The deployment into and orchestration of the Digital Twin is upstream of Fidelity Verification. Fidelity Verification consumes the evidence that Digital Twin execution produced, normalized into FidelityVerificationInput. It does not manage the Digital Twin.
