---
id: PRD-META-SIMULATION-COVERAGE
sourceCapabilityId: BC-META-ENFORCE-SIMULATION-COVERAGE
sourceFunctionId: FP-META-SIMULATION-COVERAGE-EXECUTION
title: Simulation Coverage Gate (Gate 2)
source_refs:
  - FP-META-SIMULATION-COVERAGE-EXECUTION
  - FP-META-SIMULATION-COVERAGE-CONTROL
  - FP-META-SIMULATION-COVERAGE-EVIDENCE
  - BC-META-ENFORCE-SIMULATION-COVERAGE
  - PRS-META-SIMULATION-COVERAGE
  - SIG-META-GATE2-REACHABLE
  - SIG-META-WHITEPAPER-V4
  - PRD-META-GATE-1-COMPILE-COVERAGE
explicitness: explicit
rationale: >
  Gate 2 PRD authored under bootstrap carve-out. Stage 6 function synthesis
  now produces Gate2Input bundles (SIG-META-GATE2-REACHABLE), but no evaluator
  consumes them. Every Function produced by Stage 6 is stuck at lifecycle state
  'implemented' indefinitely. Gate 2 evaluates whether the produced code
  satisfies the specification's invariants and scenarios before promotion to
  'verified'. It reuses the shared GateEvaluator shape from PRD-META-GATE-1-
  COMPILE-COVERAGE and operates strictly on Gate2Input -- never on raw
  Stage6TraceLogs. Derived from whitepaper section 6.3 (three coverage checks),
  ConOps section 3.4 (Gate Evaluator determinism), ratified Gate2Input schema
  (ratified-decisions.md lines 488-528), Gate2Report and Gate2Verdict schemas
  in packages/schemas/src/coverage.ts, and the three FunctionProposals
  (EXECUTION, CONTROL, EVIDENCE).
---

# Simulation Coverage Gate (Gate 2)

## Problem

Stage 6 function synthesis produces code, tests, and evidence artifacts. The evidence Function emits Gate2Input bundles conforming to the ratified Zod schema. No evaluator consumes those bundles. Every Function produced by Stage 6 remains at lifecycle state 'implemented' with no mechanism to transition to 'verified'.

Gate 1 proves the specification is internally complete. Stage 6 proves the topology can produce code from specifications. The chain is missing its next link: proof that the produced code actually satisfies the specification it was produced from. Without Gate 2, code promotion is trust-by-assumption. A Function that compiled and whose tests passed in isolation has not been proven against its invariants under scenario execution. The whitepaper names this explicitly in section 6.3: "The Factory requires that tests passing on a complete scenario corpus is the shipping condition."

The pressure is near-maximal. PRS-META-SIMULATION-COVERAGE rates strength at 1.0, urgency at 0.9, confidence at 1.0. Whitepaper section 11 non-negotiable number 6 requires three fail-closed Coverage Gates. Gate 1 is implemented. Gate 3 is deferred until Functions reach 'monitored'. Gate 2 is now reachable and its absence is an active operational gap.

Gate 2 reuses the shared GateEvaluator shape from PRD-META-GATE-1-COMPILE-COVERAGE: a deterministic pure function of the form `(input, mode) => CoverageReport`, with fail-closed semantics, lineage preservation, and emission on every invocation. The differences from Gate 1 are the inputs (Gate2Input instead of compiler intermediates), the specific checks (scenario coverage, invariant exercise, required-validation pass rate instead of atom/invariant/validation/dependency coverage), and the failure consequence (block 'implemented' to 'verified' promotion instead of halting the compiler).

## Goal

Implement Gate 2 as a deterministic pure function that takes a Gate2Input bundle (the normalized evidence from Stage 6) and the Factory mode, computes three coverage checks per whitepaper section 6.3, emits a Gate2Report conforming to `packages/schemas/src/coverage.ts#Gate2Report` and a Gate2Verdict conforming to `packages/schemas/src/coverage.ts#Gate2Verdict`, writes the report to `specs/coverage-reports/CR-<FN-ID>-GATE2-<ISO-timestamp>.yaml`, and blocks the lifecycle transition from 'implemented' to 'verified' whenever the verdict is fail.

Three co-specified Functions deliver the capability. The execution Function (FP-META-SIMULATION-COVERAGE-EXECUTION) runs the three coverage checks against Gate2Input and produces a verdict. The control Function (FP-META-SIMULATION-COVERAGE-CONTROL) enforces fail-closed discipline and resolves disagreements between the Stage 6 Verifier verdict and the Gate 2 acceptance verdict. The evidence Function (FP-META-SIMULATION-COVERAGE-EVIDENCE) captures the Gate2CoverageReport as a lineage-preserving artifact for downstream trust computation.

## Constraints

### Shared GateEvaluator shape (cited from PRD-META-GATE-1-COMPILE-COVERAGE)

Gate 2 conforms to the GateEvaluator shape: `(Gate2Input, FactoryMode) => Gate2Report`. Three invariant properties apply identically to Gate 2 as they do to Gate 1 and will to Gate 3.

Fail-closed semantics. An evaluator that cannot compute its verdict returns a fail verdict with remediation text naming the uncomputable state. A gate that cannot compute is treated as fail. There is no silent-pass fallback.

Lineage preservation. Every Gate2Report extends `Lineage`, populates `source_refs` with every artifact ID the verdict depends on (function_id, prd_id, workgraph_id, candidate_id from Gate2Input), tags derived fields with `explicitness`, and populates `rationale` substantively.

Emission on every invocation. Gate 2 writes a Coverage Report to `specs/coverage-reports/` on pass and on fail. The absence of a Coverage Report is never interpretable as a pass.

### ACL boundary constraint

Gate 2 consumes Gate2Input only. It never reads raw Stage6TraceLogs, raw execution traces, raw tool call records, or any Stage 6 intermediate artifact. The contract boundary is clean: Stage 6 produces evidence through its evidence Function; Gate 2 evaluates the normalized bundle. If Gate2Input is insufficient for a coverage check, the correct fix is to amend Gate2Input upstream, not to grant Gate 2 read access to raw traces.

### Coverage check constraints

Gate 2 computes three checks per whitepaper section 6.3 and the Gate2Report schema.

Scenario coverage. Every invariant defined in the WorkGraph that the Function implements must have at least one passing scenario in Gate2Input.evidence.validation_outcomes. An invariant without a passing scenario is untested. The check maps validation outcomes to invariant IDs via the WorkGraph's invariant-to-validation backmaps. Unexercised invariants are reported in `checks.scenario_coverage.branches_unexercised` with the WorkGraph node and reason.

Invariant exercise. Every invariant must have at least one scenario that could plausibly violate it -- a negative test. An invariant exercised only by positive tests has not been proven; it has been assumed. Invariants without negative tests are reported in `checks.invariant_exercise.invariants_without_negative_tests`.

Required-validation pass rate. 100% of validations with `priority: required` must pass. Below 100% is not partial credit; it is fail. The rate is computed from Gate2Input.evidence.validation_outcomes filtered to required-priority validations. Failing validations are reported in `checks.required_validation_pass_rate.failing_validations` with the computed rate in `checks.required_validation_pass_rate.rate`.

All three checks must pass for `overall: pass`. Partial pass is fail. There is no soft-warning mode, no degraded pass, no majority-of-checks rule.

### Compile and test precondition constraints

Gate2Input carries `evidence.compile_summary` and `evidence.test_summary`. If `compile_summary` indicates a compile failure or `test_summary` indicates test failures, Gate 2 emits `overall: fail` with remediation noting that the produced code did not compile or its tests did not pass. These are preconditions, not coverage checks -- they must hold before the three coverage checks are meaningful.

### Disagreement resolution constraints

When the Stage 6 Verifier verdict (carried in Gate2Input.verifier_verdict) is `pass` but Gate 2 verdict is `rejected`, a disagreement exists. Disagreements are classified per DECISIONS 2026-04-24 into three classes.

Repairable_local: the coverage gap is addressable by targeted repair (adding a missing scenario, fixing a failing required validation). The control Function triggers a repair cycle.

Architectural: the coverage gap indicates a structural problem with the ArchitectureCandidate or WorkGraph. Blind replay is forbidden. The control Function flags the disagreement for candidate re-evaluation.

Governance: the disagreement involves scope violations or hard-constraint violations (Gate2Input.evidence.scope_violation or hard_constraint_violation is true). The control Function routes to human approval. No autonomous retry.

### Determinism constraint

Given identical Gate2Input and Factory mode, Gate 2 produces identical Gate2Report contents modulo the `id` field (timestamp-suffixed) and `timestamp` field. This determinism is load-bearing for audit per ConOps section 3.4: "The Gate Evaluator has no discretion. It applies coverage formulas to Zod-validated inputs and produces a verdict: pass or fail."

### Lifecycle transition constraint

Gate 2's verdict governs the 'implemented' to 'verified' lifecycle transition. On `overall: pass`, the Function is authorized to transition. On `overall: fail`, the Function remains at 'implemented'. The transition itself is not executed by Gate 2 -- Gate 2 emits the verdict and the lifecycle manager reads the verdict. Gate 2 does not mutate lifecycle state directly; it produces the evidence the lifecycle manager consumes. This separation ensures Gate 2 remains a pure evaluator with no side effects beyond report emission.

A Function that fails Gate 2 is not broken. It compiled (Gate 1 passed). It was produced by Stage 6 (the Verifier may have passed). It simply lacks proof that its produced code satisfies its specification under scenario execution. The remediation path is additive: add scenarios, add negative tests, fix failing validations, or re-run synthesis with an improved ArchitectureCandidate.

### No check relaxation constraint

Gate 2 does not vary its thresholds based on Function complexity, PRD size, urgency, or Coding Agent request. An Architect override is the only mechanism by which a failing Gate 2 verdict can be bypassed, and overrides are per-artifact, per-incident, and DECISIONS.md-logged per ConOps section 5.4. No override mechanism exists within Gate 2 itself.

### No placeholder generation constraint

Gate 2 does not auto-create scenarios, negative tests, or validation results to paper over coverage misses. It reports the miss; remediation is upstream in Stage 6 (re-synthesis with better scenario coverage) or in the WorkGraph (add missing invariant-to-validation mappings).

### Scope constraints (I/We boundary)

Gate 2 operates strictly on Stage 6 evidence. It does not observe Work Orders, commissioning purpose, the Constraint Chain Index, Purpose Over Execution enforcement, or any We-layer concept. A Gate 2 implementation that referenced any of these would be an I/We collapse.

## Acceptance criteria

### Execution Function (coverage evaluation)

1. Given a Gate2Input where every invariant in the referenced WorkGraph has at least one passing scenario, at least one negative test, and all required validations pass, Gate 2 emits a Gate2Report with `overall: pass` and a Gate2Verdict with `verdict: accepted`. Test: construct a Gate2Input with full scenario and invariant coverage; verify Gate2Report.overall is `pass` and Gate2Verdict.verdict is `accepted`.

2. Given a Gate2Input where one or more invariants have no passing scenario in validation_outcomes, Gate 2 emits `overall: fail` with those invariants identified in `checks.scenario_coverage.branches_unexercised`. Test: construct a Gate2Input missing scenario coverage for two invariants; verify both appear in branches_unexercised with workgraph_node references.

3. Given a Gate2Input where one or more invariants have only positive tests (no negative/violation test), Gate 2 emits `overall: fail` with those invariant IDs in `checks.invariant_exercise.invariants_without_negative_tests`. Test: construct a Gate2Input with an invariant covered only by positive scenarios; verify the invariant ID appears in the failing array.

4. Given a Gate2Input where any required-priority validation in validation_outcomes has status `fail`, Gate 2 emits `overall: fail` with the failing validation IDs in `checks.required_validation_pass_rate.failing_validations` and the computed rate below 1.0. Test: construct a Gate2Input with one required validation failing out of four; verify rate is 0.75 and overall is fail.

5. Given a Gate2Input where compile_summary indicates compile failure, Gate 2 emits `overall: fail` without computing the three coverage checks. Remediation text names the compile failure as the blocking precondition. Test: provide a Gate2Input with a failing compile_summary; verify overall is fail and remediation references compilation.

6. Given a Gate2Input where test_summary indicates test failures, Gate 2 emits `overall: fail` without computing the three coverage checks. Remediation text names the test failure as the blocking precondition. Test: provide a Gate2Input with a failing test_summary; verify overall is fail and remediation references test failures.

7. Given any combination of coverage check failures, Gate 2's `overall` verdict is `fail` and the lifecycle transition from 'implemented' to 'verified' is blocked. Test: construct a Gate2Input failing all three checks simultaneously; verify overall is fail and all three check statuses are fail.

### Control Function (fail-closed discipline and disagreement)

8. Every Gate 2 invocation produces a verdict. No Gate2Input enters the evaluator and exits without a Gate2Report and Gate2Verdict being emitted. Test: invoke Gate 2 with valid Gate2Input; verify both a Gate2Report file and Gate2Verdict object are produced.

9. When Gate2Input.verifier_verdict is `pass` but Gate 2 verdict is `rejected`, the control Function classifies the disagreement. Given a missing-scenario gap with no scope or hard-constraint violations, classification is `repairable_local`. Test: provide matching conditions; verify disagreement classification.

10. When Gate2Input.evidence.scope_violation or hard_constraint_violation is true and the Verifier verdict was `pass`, disagreement classification is `governance` and no autonomous retry occurs. Test: set scope_violation to true; verify classification is governance and no retry is triggered.

11. No partial-credit promotion. A Gate2Input that passes two of three checks but fails one results in `overall: fail` and the Function remains at 'implemented'. Test: construct a Gate2Input passing scenario_coverage and invariant_exercise but failing required_validation_pass_rate; verify overall is fail.

### Evidence Function (report persistence and lineage)

12. On every invocation, pass or fail, Gate 2 writes a Gate2Report to `specs/coverage-reports/CR-<FN-ID>-GATE2-<ISO-8601-timestamp>.yaml`. Test: invoke Gate 2 twice (one pass, one fail); verify two distinct Coverage Report files exist at the expected paths.

13. Every Gate2Report validates against the Zod `Gate2Report` schema in `packages/schemas/src/coverage.ts`. A Gate2Report that fails schema validation is a Gate 2 implementation defect. Test: parse every emitted Gate2Report with Gate2Report.safeParse; verify success.

14. Every Gate2Report's `source_refs` contains the function_id, prd_id, workgraph_id, and candidate_id from the Gate2Input, plus every artifact ID referenced in any failing check's detail arrays. Test: invoke Gate 2 with a failing Gate2Input; verify source_refs includes all expected IDs.

15. Every Gate2Verdict validates against the Zod `Gate2Verdict` schema in `packages/schemas/src/coverage.ts`. Test: parse every emitted Gate2Verdict with Gate2Verdict.safeParse; verify success.

16. The Gate2Report's `remediation` field is non-empty on every invocation. On pass, it contains the literal string "no remediation required". On fail, it contains human-readable text naming each failing check, the specific artifact IDs that failed, and the remediation action. Test: verify remediation field on both pass and fail invocations.

### Determinism and purity

17. Given identical Gate2Input and Factory mode, Gate 2 produces Gate2Report contents that are byte-identical modulo the `id` and `timestamp` fields. Test: invoke Gate 2 twice with the same inputs; verify output identity modulo timestamps.

18. Gate 2 is implemented as a pure function with no side effects other than Coverage Report file emission. No network calls. No environment reads beyond the validated inputs. No mutation of Gate2Input. No reads from `.agent/memory/` during evaluation. Test: instrument the evaluator boundary; verify no external I/O occurs during evaluation.

### Bootstrap-mode compliance

19. Given Factory mode `bootstrap`, the Gate2Report's function_id, prd_id, and workgraph_id all match the regex `^(FN|PRD|WG)-META-`. Gate 2 does not enforce the META- prefix itself (that is Gate 1's job); it validates that its own inputs carry the prefix. Test: provide a Gate2Input with non-META prd_id in bootstrap mode; verify Gate 2 emits fail with remediation noting the prefix violation.

### Schema conformance

20. Every Gate2Input consumed by Gate 2 must pass Gate2Input.safeParse before evaluation proceeds. If the input fails schema validation, Gate 2 emits `overall: fail` with remediation naming the schema validation error. Gate 2 does not attempt to evaluate malformed input. Test: provide a Gate2Input missing the required `evidence.validation_outcomes` field; verify Gate 2 emits fail with schema-validation remediation text.

21. The Gate2Verdict emitted by Gate 2 carries `scenario_coverage_score` and `invariant_exercise_rate` as numbers between 0 and 1. The scenario_coverage_score is the fraction of invariants with at least one passing scenario. The invariant_exercise_rate is the fraction of invariants with at least one negative test. Both scores are 1.0 on pass. Test: construct a Gate2Input where 3 of 4 invariants have passing scenarios and 2 of 4 have negative tests; verify scenario_coverage_score is 0.75 and invariant_exercise_rate is 0.5.

## Success metrics

Zero false passes across the Factory's operational lifetime. A false pass is a Gate2Report with `overall: pass` where one of the three checks should have flagged a real coverage miss. A single false pass triggers the coverage-gate-2 SKILL.md self-rewrite hook and root-cause review by the Architect.

Gate 2 pass rate by check class. Concentration of failures in scenario_coverage versus invariant_exercise versus required_validation_pass_rate is a diagnostic signal about upstream Stage 6 discipline. A dominant failure class triggers review of the corresponding Function synthesis role contracts or the evidence Function's normalization logic.

Disagreement resolution correctness. Zero governance-class disagreements resolved without human approval. Zero architectural disagreements resolved via blind replay. Disagreement classification accuracy is auditable from Gate2Reports and Gate2Verdicts.

Remediation-text actionability. On every Gate 2 failure, a Coding Agent should be able to execute the remediation without consulting Gate 2's source code. Ambiguous remediation text is a PRD authorship defect upstream; misdirected remediation text is a Gate 2 implementation defect.

Determinism verification. Quarterly, a Gate 2 regression test replays a canonical Gate2Input through the current Gate 2 implementation and asserts byte-identical Gate2Report contents modulo timestamp and id. Divergence is a P0 issue.

Coverage Report emission rate. 100% of Gate 2 invocations produce a persisted Gate2Report. A missing Coverage Report is an evidence Function defect. The emission rate is the most basic operational health metric for Gate 2.

Architect override rate on Gate 2 verdicts, per ConOps section 10.3. A rising rate signals either miscalibrated checks or systematically incomplete Stage 6 evidence production. Either warrants investigation; neither is resolved by relaxing Gate 2.

## Out of scope

Gate 1 compile coverage. Gate 1 operates at the end of Stage 5 on compiler intermediates. Gate 2 operates downstream on Stage 6 evidence. The two gates share the GateEvaluator shape but are separate Functions with separate inputs and separate failure consequences.

Gate 3 assurance coverage. Gate 3 operates continuously on deployed, monitored Functions. Gate 2 operates as a one-shot evaluation before the 'implemented' to 'verified' transition. Gate 3 is deferred until Functions reach 'monitored'.

Stage 6 function synthesis. Gate 2 consumes the Gate2Input bundle that Stage 6 produces. The synthesis topology, role contracts, binding modes, and repair loops are specified in PRD-META-FUNCTION-SYNTHESIS. Gate 2 evaluates what Stage 6 produces; it does not participate in production.

Gate2Input schema amendments. If Gate2Input is insufficient for a coverage check, the amendment is a separate DECISIONS.md entry and a schema change in the ratified schema module. Gate 2 operates on the current Gate2Input schema as ratified.

Trust composite computation. Gate 2 produces evidence (Gate2Report, Gate2Verdict) that feeds into downstream trust computation. The computation of the five trust dimensions (correctness, compliance, observability, stability, user response) is a separate capability. Gate 2 does not compute trust scores.

Architecture search and candidate selection. The ArchitectureCandidate referenced in Gate2Input.candidate_id was selected upstream. Gate 2 does not evaluate or score candidates; it evaluates the evidence produced by a synthesis that used a given candidate.

Work Order governance, CCI, POE, PII, or any We-layer concept. Explicitly out of scope per whitepaper section 8. Gate 2 is an I-layer evaluator.

Digital Twin Universe orchestration. Whitepaper section 6.3 describes Gate 2 running "after the generated artifact has been deployed into the Digital Twin Universe." The deployment into and orchestration of the Digital Twin is upstream of Gate 2. Gate 2 consumes the evidence that Digital Twin execution produced, normalized into Gate2Input. It does not manage the Digital Twin.
