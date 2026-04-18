---
name: coverage-gate-3
version: 2026-04-18
triggers:
  - "Gate 3"
  - "assurance coverage"
  - "detector freshness"
  - "monitoring liveness"
tools: [bash, view]
preconditions:
  - "Function is in monitored state"
constraints:
  - "runs continuously, not one-shot"
  - "silence is not evidence of correctness"
  - "assurance regression is a first-class regression class"
category: factory-core
---

# Assurance Coverage Gate (Gate 3)

Runs continuously on every Function that has reached `monitored` status.
Verifies that the runtime evidence base under the Function has not silently
decayed.

## Inputs (continuous)

- Function ID (lifecycle state: `monitored`)
- Invariant[] with detector specs
- Live evidence streams (telemetry, audit, incidents)
- Expected audit volume per Function (baseline)

## Three continuous checks

### 1. Detector freshness
Every invariant's detector has emitted a judgment (healthy OR violation)
within its configured freshness threshold. Typical threshold: 15 minutes
for high-impact invariants, 1 hour for medium, 24 hours for low.

A detector that has gone silent is not passing silently. It is missing.
Silence is not evidence of correctness.

### 2. Evidence source liveness
Every named evidence source (telemetry stream, audit topic, incident
channel) is still emitting at expected cadence. An evidence source that
has gone quiet invalidates every detector that consumes it — even if
those detectors haven't yet noticed.

### 3. Audit pipeline integrity
For every action a Function should produce an audit event for, the audit
event exists. Compare expected audit volume (derived from Function call
count and audit ratio) against observed audit volume. Divergence is a
fail.

## Output

A rolling `AssuranceCoverageReport` updated continuously at
`specs/coverage-reports/CR-<FN-ID>-GATE3-latest.yaml` with versioned
history in `CR-<FN-ID>-GATE3-history.jsonl`:

```yaml
id: CR-<FN-ID>-GATE3-<timestamp>
gate: 3
function_id: <FN-ID>
timestamp: <ISO-8601>
overall: pass | fail
checks:
  detector_freshness:
    status: pass | fail
    stale_detectors:
      - invariant_id: <INV-ID>
        detector: <detector_name>
        last_report: <ISO-8601>
        threshold: <duration>
  evidence_source_liveness:
    status: pass | fail
    quiet_sources:
      - source: <source_name>
        last_emission: <ISO-8601>
        expected_cadence: <duration>
  audit_pipeline_integrity:
    status: pass | fail
    expected_vs_observed:
      expected: <count>
      observed: <count>
      divergence_pct: <percentage>
remediation: |
  Which detector, evidence source, or audit pipeline needs repair.
```

## Behavior

- **On pass:** Function remains in `monitored`.
- **On fail:** Function transitions to `assurance regressed` (fourth
  regression class, per whitepaper §5). This is not a runtime bug
  regression — the Function may still be behaving correctly — it is a
  loss of visibility regression. Trust without evidence is not trust;
  it is assumption.

## Anti-patterns

- **Treating detector silence as pass.** Never. Silence is missing data,
  not positive data. Fail closed.
- **Widening freshness thresholds to avoid alerts.** This is scoreboard-
  gaming. Freshness thresholds are set based on invariant impact; do not
  loosen them to suppress signal.
- **Recovering from assurance regressed without re-running the relevant
  Gate 2 scenarios.** If evidence was missing for a period, the Function's
  behavior during that period is unverified. Treat as if it had been in
  `regressed` state.

## Self-rewrite hook

After every 100 Gate 3 runs OR on any incident traceable to a coverage
miss this gate should have caught:
1. Review the rolling history.
2. If a class of miss keeps slipping through, propose a tighter threshold
   or additional check.
3. Commit: `META: skill-update: coverage-gate-3, {one-line reason}`
