---
id: PRD-META-DETECT-REGRESSION
sourceCapabilityId: BC-META-DETECT-REGRESSION
sourceFunctionId: FP-META-DETECT-REGRESSION
title: Detect Regression (control Function)
source_refs:
  - FP-META-DETECT-REGRESSION
  - BC-META-DETECT-REGRESSION
  - PRS-META-DETECT-REGRESSION
  - SIG-META-WHITEPAPER-V4
explicitness: explicit
rationale: >
  Second meta-PRD authored under Factory discipline. First non-Gate-1 PRD,
  authored specifically to exercise the compiler against divergent input
  shape — runtime rather than compile-time, evidence-driven rather than
  structural, stateful rather than per-invocation. If the compiler
  produces a Gate 1: PASS verdict on this PRD, Gate 1's discipline is
  architecturally general. If it fails, the failure diagnostic (orphan
  atoms, unmatched invariant templates, dependency surprises) is the
  first real divergence signal the Factory has observed, which the
  self-rewrite hooks on coverage-gate-1 and prd-compiler skills are
  designed to consume.

  Derived authoritatively from whitepaper §5 for the FunctionLifecycle
  state machine and the five trust dimensions; §3.2 for the control
  Function type; §6.4 for Gate 3's relationship to detector freshness
  (distinct from regression detection, which this PRD specifies);
  ConOps §3.4 for deterministic evaluation and audit replay; ConOps
  §10.1 for false-pass discipline as applied to detection; the
  invariant-authoring SKILL for detector well-formedness. This PRD
  deliberately avoids naming an implementation language or scheduling
  mechanism — those are compiler/Pass 8/runtime-package concerns, not
  PRD concerns.
---

# Detect Regression (control Function)

## Problem

Monitored Functions in the Factory accumulate TrustSignal observations over time — per-dimension scores for correctness, compliance, observability, stability, and userResponse, plus an optional composite. The whitepaper §5 defines `regressed` as a FunctionLifecycle state downstream of `monitored`, and frames the transition as the appropriate response to sustained trust degradation. The transition itself has no implementation. The Factory has the schema for the data (`TrustSignal` in core.ts), the state machine for the destination (`FunctionLifecycle`), and no control function that connects them.

In practice this means a Function whose correctness score drifts from 0.95 at verification time to 0.78 six weeks later remains in `monitored` state. The scoreboard reflects the degradation, but `monitored` is what gates its continued operation, and `monitored` does not self-modify based on its own history. The transition to `regressed` is the mechanism by which the Factory stops trusting a Function that has stopped being trustworthy; without it, trust is an output-only metric with no feedback loop to lifecycle state.

This is the third control Function the Factory needs to be architecturally complete (Gate 1 is the first, Gate 3 — assurance coverage — is the second; regression detection is distinct from both). Unlike the Coverage Gates, which run synchronously at compile time or at fixed lifecycle transitions, regression detection is continuous and stateful — it operates over time series, not over a single artifact. That shape is new to the Factory and is deliberately chosen as the first compiler stress test against non-Gate-1 shape.

## Goal

Implement `detect_regression` as a deterministic control Function that ingests a Function's TrustSignal stream and historical baseline, evaluates a detection policy (per-dimension thresholds plus a sustained-degradation window), and emits a FunctionLifecycle transition from `monitored` to `regressed` plus a DetectionReport artifact when the policy fires. The Function runs continuously against every Function currently in `monitored` state, produces no transition when the policy does not fire, and produces exactly one transition plus one DetectionReport when it does.

## Constraints

### Architectural constraints (inherited from the six non-negotiables)

Fail-closed discipline is absolute. An invocation of detect_regression that cannot read the TrustSignal store, cannot read the policy configuration, or encounters a schema mismatch does not emit a transition — it emits a DetectionReport with `status: uncomputable` and the reason recorded in its rationale. Silent passes are rejected; silent fails are equally rejected. A detect_regression instance that cannot compute its verdict for any reason must make that inability visible via a DetectionReport, not absent output.

Lineage preservation is absolute. Every emitted FunctionLifecycle transition carries a DetectionReport reference in its source. Every DetectionReport carries in source_refs the Function whose trust was evaluated, the TrustSignal observations that drove the verdict, and the detection policy version that was applied. Explicitness tags on the DetectionReport are explicit for fields derived directly from the signal stream and inferred for fields that required policy interpretation. Rationale substantively names the triggering dimension and the trajectory of values that crossed the threshold.

Determinism is absolute. Given the same TrustSignal history and the same policy configuration, detect_regression produces the same verdict, the same DetectionReport, and the same FunctionLifecycle transition (or non-transition) on every invocation. This is load-bearing for audit replay — a quarterly regression test replays historical signal streams against the current implementation and asserts that produced DetectionReports are byte-identical to the committed originals modulo timestamps.

Narrow-function discipline. detect_regression detects regression and emits transitions. It does not alert, does not open pages, does not notify, does not roll back deployments, does not interact with the harness bridge. Those are separate Functions derivable from the same BC-META-DETECT-REGRESSION Capability in future iterations. detect_regression emits; consumers react.

### Operational constraints

No placeholder transitions. A DetectionReport with `status: uncomputable` is not a regression event; it is a diagnostic that the regression evaluator could not run. Consumers of transition events must be able to distinguish "regression detected" from "regression undetectable" — the DetectionReport's `status` field is the discriminant. Consumers that treat `uncomputable` as regressed conflate observability failures with quality failures and corrupt the regression rate metric.

Policy is explicit, versioned, and audited. The detection policy (per-dimension thresholds, sustained-degradation window duration, any per-Function overrides) is a first-class artifact committed to `specs/detection-policies/` with its own lineage, explicitness tags, and rationale. A detect_regression invocation cites the policy version it applied; a policy change is a Class B architectural change that lands through DECISIONS.md per ConOps §12.1.

Idempotency is absolute. Rerunning detect_regression against a signal history that has already triggered a transition produces no second transition. The DetectionReport is reproduced (determinism requires it), but the FunctionLifecycle state machine does not accept a second `monitored → regressed` edge on an already-regressed Function. Implementations may short-circuit by reading current state first, but must do so in a way that preserves the deterministic-replay property.

### Scope constraints

detect_regression observes TrustSignal and emits FunctionLifecycle transitions. It does not compute TrustSignal values — that is the runtime package's responsibility per whitepaper §5. It does not observe incidents — that is the assurance-graph package's responsibility per §5. It does not observe detector freshness — that is Gate 3's concern per §6.4. A detect_regression implementation that read from the detector freshness store would be a Gate 3 / regression-detection collapse and must be rejected at Critic Agent review.

detect_regression operates on monitored Functions only. Functions in `verified`, `in_progress`, `designed`, or any pre-monitored state are out of scope — they have no meaningful TrustSignal history to regress against. Functions in `regressed` or `assurance_regressed` are also out of scope — they are already in a terminal degradation state; re-regressing them is a no-op the state machine rejects.

## Acceptance criteria

1. Given a monitored Function with a TrustSignal history where no per-dimension score falls below its policy threshold and the composite score remains above its threshold, detect_regression emits no FunctionLifecycle transition and emits a DetectionReport with `status: pass` and rationale naming the observed stable trajectory.

2. Given a monitored Function with a TrustSignal history where a single per-dimension score falls below its policy threshold for a duration shorter than the sustained-degradation window, detect_regression emits no FunctionLifecycle transition and emits a DetectionReport with `status: pass` and rationale naming the transient dip.

3. Given a monitored Function with a TrustSignal history where a single per-dimension score falls below its policy threshold and remains below for the full sustained-degradation window, detect_regression emits a FunctionLifecycle transition from `monitored` to `regressed` and a DetectionReport with `status: regressed`, the triggering dimension named, and the full trajectory of values through the window recorded.

4. Given a monitored Function where the composite score falls below its threshold for the full window while no individual dimension does, detect_regression emits a transition and a DetectionReport with the composite named as the trigger and the constituent per-dimension scores recorded for audit.

5. Given multiple simultaneous threshold violations (two or more dimensions cross simultaneously for the full window), detect_regression emits a single transition and a DetectionReport that names every triggering dimension in order of severity (ratio of observed-to-threshold).

6. Given a Function not currently in `monitored` state, detect_regression emits no transition and no DetectionReport. The Function is out of scope; silent skip is correct behavior, not a fail-closed violation.

7. Given a TrustSignal store that is unreadable (schema mismatch, missing file, permission error), detect_regression emits no transition and emits a DetectionReport with `status: uncomputable` and the read failure described in the rationale. The Function's lifecycle state is not modified.

8. Given a detection policy configuration that is unreadable or schema-invalid, detect_regression emits no transition against any Function and emits one DetectionReport with `status: uncomputable` per Function it was invoked against, each citing the same policy read failure.

9. On every invocation per Function, pass or fail, a DetectionReport is written to `specs/detection-reports/DR-<FUNCTION-ID>-<ISO-8601-timestamp>.yaml` before detect_regression returns. Absence of a DetectionReport is never interpretable as "no regression"; it is interpretable only as "detect_regression did not run."

10. Every DetectionReport validates against a Zod DetectionReport schema in `packages/schemas/src/regression.ts`. A DetectionReport that fails schema validation is an implementation defect; the self-rewrite hook on the detect-regression skill fires.

11. Given identical TrustSignal history and identical policy configuration, detect_regression produces DetectionReports that are byte-identical modulo `id` (timestamp-suffixed) and `timestamp` fields. A quarterly regression test replays a canonical fixture and asserts byte-equality.

12. Every DetectionReport's source_refs contains the Function ID being evaluated, the TrustSignal artifact IDs that were read, and the detection policy artifact ID that was applied.

13. A FunctionLifecycle transition emitted by detect_regression carries in its own source_refs the DetectionReport ID that justified it. Transitions without a justifying DetectionReport are rejected by the runtime package's state machine per ConOps §5.2.

14. Given a Function already in `regressed` state, detect_regression emits a DetectionReport with `status: pass` and rationale "Function already in regressed state; idempotent no-op" and emits no transition. The state machine is not invoked.

15. The DetectionReport's rationale is non-empty on every emission. On `status: pass` it names the observed stable trajectory or the transient-dip character of sub-window violations. On `status: regressed` it names the triggering dimension(s), the trajectory, and the policy rule that fired. On `status: uncomputable` it names the specific read or parse failure and its file source.

## Success metrics

False positive rate. A false positive is a `status: regressed` DetectionReport emitted against a Function whose subsequent re-evaluation under the same policy returns to `pass` without remediation. Target: below 1% of all emitted `regressed` reports quarterly. A rising false positive rate is a policy calibration issue; the remediation is a policy revision DECISIONS entry, not a detect_regression implementation change.

False negative rate. A false negative is a Function that the Architect or a Stage 7 reviewer determines should have been detected as regressed but was not. False negatives cannot be measured mechanically — they require human review of Functions where trust degraded without a transition. Target: below one false negative per quarter aggregated across all monitored Functions. A single false negative triggers a root-cause review per ConOps §10.1.

Mean time to transition. Time from the first TrustSignal observation that would later be identified as the start of the triggering trajectory, to the `status: regressed` DetectionReport. Target: at most one detection-window duration plus one detect_regression invocation interval. Exceeding this bound indicates either window overfitting (too long a window) or invocation-interval overfitting (too sparse invocation).

Determinism verification. Quarterly, a fixture of historical TrustSignal data plus a committed policy is replayed through the current detect_regression implementation. The produced DetectionReports must be byte-identical to the committed originals modulo `id` and `timestamp`. Any divergence is a P0 issue and triggers immediate Architect review per ConOps §10.3.

Uncomputable rate. The fraction of invocations that produce `status: uncomputable` reports. Target: below 0.5% quarterly. A rising uncomputable rate is an observability-pipeline failure, not a regression-detection failure; the remediation is Gate 3's concern (detector freshness), which detect_regression is not permitted to absorb into its own scope.

## Out of scope

Alerting, paging, notification. detect_regression emits transitions and reports; it does not notify. An alerting Function consumes the transition event stream and decides who to page. That is a separate Function under the same BC-META-DETECT-REGRESSION Capability.

Automatic rollback or Function retirement. detect_regression transitions a Function to `regressed`. What happens next — retraining, rollback, retirement, manual re-verification — is governed by the broader Factory lifecycle and is out of scope for this Function. A detect_regression implementation that triggered rollbacks would collapse detection and remediation into a single artifact and violate narrow-function discipline.

TrustSignal computation. The values detect_regression reads are produced by the runtime package per whitepaper §5. detect_regression does not compute, smooth, aggregate, or transform signal values — it reads them at the schema layer and applies a threshold policy. A detect_regression implementation that reached into the TrustSignal computation pipeline would be a runtime / detection collapse.

Incident correlation. detect_regression emits regression transitions; the assurance-graph package propagates related incidents. Linking a regression event to a causal incident is the assurance-graph's job. detect_regression does not read incident data and does not annotate DetectionReports with suspected causes.

Detector freshness. Whether the TrustSignal pipeline is live, whether named evidence sources are emitting, whether the audit path is intact — these are Gate 3's concerns per whitepaper §6.4. detect_regression assumes the pipeline is live; if it is not, the `uncomputable` DetectionReport status surfaces that assumption's failure but does not diagnose the root cause. Root-cause diagnosis is Gate 3's scope.

Policy authoring. The detection policy is an input to detect_regression, not its output. Authoring the policy is a separate task — potentially itself compiled from a PRD under Factory discipline in a later iteration. For the first detect_regression implementation, a committed baseline policy is assumed.

## Shared ControlFunction shape

Regression detection, Gate 2, and Gate 3 are all control Functions per whitepaper §3.2. Recording the shape here avoids drift across their three PRDs the same way the Gate 1 PRD recorded the shared GateEvaluator shape.

A ControlFunction is a deterministic function of the form `(observation, policy, mode) => (transition | none, report)` where `observation` is a Zod-validated input drawn from the runtime state of the Factory, `policy` is a Zod-validated configuration artifact committed alongside the Function, `mode` is the FactoryMode enum from `@factory/schemas`, and the return is an optional lifecycle transition plus a mandatory report artifact. Three properties are invariant across all control Functions.

First, report emission is mandatory and transition emission is conditional. The report is always produced; the transition only when the policy fires. A control Function that emits a transition without a report, or a silent no-transition without a report, violates the shape. The report is the mechanism by which the control Function's inaction is made auditable.

Second, fail-closed discipline applies to transitions, not to reports. A control Function that cannot compute still emits a report — with `status: uncomputable` and a substantive rationale. It emits no transition. This distinguishes "the system is healthy" (report pass, no transition) from "the control Function could not tell" (report uncomputable, no transition), which from a pure transition-stream perspective would be identical.

Third, lineage preservation extends beyond the report's own source_refs. Every transition a control Function emits carries the report's ID in the transition's own source_refs. A transition without a justifying report is rejected by the state machine per ConOps §5.2. This is the mechanism by which the Factory guarantees that every lifecycle state change is auditable back to the evidence that justified it.

The shape applies here and will apply to Gate 2's PRD and Gate 3's PRD without modification. Differences among control Functions are in the observation type, the policy type, the specific transitions emitted, and the report schema — not in the shape itself.

## Schema additions required

This PRD requires two new schemas in `packages/schemas/src/`:

`regression.ts` defining `DetectionReport` as a Lineage-extending artifact with `id` matching `^DR-`, a `functionId: ArtifactId`, a `status: z.enum(["pass", "regressed", "uncomputable"])`, a `triggeringDimensions: z.array(...)` (populated on `regressed`), an `observedTrajectory: z.array(...)` recording the signal values through the detection window, a `policyVersion: ArtifactId`, and a `rationale` inherited from Lineage with its usual non-empty constraint.

`detection-policy.ts` defining `DetectionPolicy` as a Lineage-extending artifact with `id` matching `^POL-`, per-dimension threshold maps, a `sustainedDegradationWindow: z.string()` (duration string), and an optional `perFunctionOverrides: z.record(ArtifactId, ...)`.

Two prefix additions to the ArtifactId regex in `lineage.ts`: `DR` for detection reports and `POL` for policies. Same paired-PR discipline as the recent CONTRACT addition — regex in lineage.ts and META_PREFIX_REGEX in coverage-gates must be updated in lockstep.

These are Class B architectural changes per ConOps §12.1 and require a DECISIONS.md entry before the implementation PR. The schema PR for this work is sequenced to land before the detect_regression implementation PR, same pattern as the Gate 1 bootstrap.

## Downstream artifacts detect_regression will enable

A passing Gate 1 verdict on this PRD is the precondition for compiling detect_regression into a WorkGraph and implementing it. If the first compile fails, the failure diagnostic becomes the first non-self-referential divergence signal the Factory has emitted — which is the signal the self-rewrite hooks on coverage-gate-1 and prd-compiler skills exist to consume. In that case the remediation sequence is: diagnose the failure (which check failed, which specific atoms or artifacts were named), determine whether the failure is a skill-derivation gap (Pass 3's template matching, Pass 0's section mapping) or a genuine specification gap in this PRD, commit the remediation to the appropriate skill or PRD, recompile. A failing first compile is not a setback; it is the Factory's first observation that Gate 1 generalized imperfectly, and is more valuable than a passing compile that provided no such signal.

Whether the first compile passes or fails, the Coverage Report (`CR-PRD-META-DETECT-REGRESSION-GATE1-<timestamp>.yaml`) is the artifact of interest. That is the second Coverage Report the Factory will have committed — the first one being Gate 1's own. Two Coverage Reports in `specs/coverage-reports/` is the smallest evidence base from which the Factory's audit claim can start to generalize.
