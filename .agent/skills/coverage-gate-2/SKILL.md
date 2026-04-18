---
name: coverage-gate-2
version: 2026-04-18
triggers:
  - "Gate 2"
  - "simulation coverage"
  - "promote to monitored"
  - "scenario coverage"
tools: [bash, view]
preconditions:
  - "Function is in verified state"
  - "Digital Twin Universe scenarios are configured"
  - "required validations have run"
constraints:
  - "no promotion to monitored without gate pass"
  - "negative tests must exist for every invariant"
  - "100% required validation pass rate is required"
category: factory-core
---

# Simulation Coverage Gate (Gate 2)

Runs in Stage 7, between the `verified` and `monitored` lifecycle states.
Verifies that the Function's scenario suite actually exercises its
specification in practice, not just in isolation.

## Inputs

- Function ID (lifecycle state: `verified`)
- WorkGraph that implements it
- Scenario corpus from the Digital Twin Universe
- ValidationSpec[] from the Function's PRD compilation
- Invariant[] from the Function's PRD compilation
- Run results for every validation

## Three coverage checks

### 1. Scenario coverage
Every branch in the Function's WorkGraph has been exercised by at least one
scenario. Unreached branches are dead code or untested code; either way the
Function is not ready for production trust.

### 2. Invariant exercise
Every Invariant has at least one scenario that could plausibly violate it.
A negative test must exist, even if it never fires during the normal suite.
An invariant with only positive tests has not been proven; it has been
assumed.

### 3. Required-validation pass rate
100% of validations with `priority: required` must pass in the Digital
Twin. Below 100% is not partial credit; it is fail.

## Output

A `CoverageReport` written to
`specs/coverage-reports/CR-<FN-ID>-GATE2-<timestamp>.yaml`:

```yaml
id: CR-<FN-ID>-GATE2-<timestamp>
gate: 2
function_id: <FN-ID>
timestamp: <ISO-8601>
overall: pass | fail
checks:
  scenario_coverage:
    status: pass | fail
    branches_unexercised:
      - workgraph_node: <NODE-ID>
        edge: <EDGE-ID>
        reason: "no scenario reaches this branch"
  invariant_exercise:
    status: pass | fail
    invariants_without_negative_tests: [INV-ID, ...]
  required_validation_pass_rate:
    status: pass | fail
    rate: <0.0..1.0>
    failing_validations: [VAL-ID, ...]
remediation: |
  Human-readable description of which scenarios to add or which validations
  to fix. Always populated.
```

## Behavior

- **On pass:** Function transitions from `verified` to `monitored`. Gate 3
  monitoring activates immediately.
- **On fail:** Function stays in `verified`. It is deployable (the harness
  can run it) but it is not governed (the trust computation refuses to
  certify it). Remediation is additive — add scenarios, add negative tests,
  fix failing required validations.

## Anti-patterns

- **Promoting a Function on majority pass.** Never. All three checks must
  pass.
- **Marking positive-only test suites as sufficient.** Never. The existence
  of a negative test is a hard requirement for every invariant.
- **Lowering a validation priority from required to recommended to pass
  the gate.** This is a scope violation. Requirements are requirements.
  Surface to architect if a requirement seems wrong.

## Self-rewrite hook

After every 10 Gate 2 runs OR on any runtime regression traceable to
coverage this gate should have caught:
1. Review recent Coverage Reports.
2. If a class of coverage miss keeps slipping through, propose an
   additional check or tighter threshold.
3. Commit: `META: skill-update: coverage-gate-2, {one-line reason}`
