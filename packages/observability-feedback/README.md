# @factory/observability-feedback

Compares execution expectations against realized outcomes, emits observation artifacts, and derives feedback signals for upstream reinjection into the signal pipeline.

## Pipeline Position

**Stage:** 7
**Consumes:** `EXR-*` (ExecutionResult), `EFFR-*` (EffectorRealization), `EXT-*` (ExecutionTrace)
**Produces:** `OBS-*` (ObservationArtifact), `SIG-*` (feedback signal YAML)

## Exports

- `emitObservation()` -- Compares expected vs realized summaries; emits an OBS artifact with outcome (`matched_expectation` or `deviated`) and delta summary
- `emitFeedbackSignal()` -- Derives a feedback signal YAML string from an observation for upstream reinjection
- `renderObservationYaml()` -- Serializes an ObservationArtifact to YAML string
- `observationIdFromExecutionResultId()` -- Deterministic ID derivation from EXR-* to OBS-*

## Key Invariants

- Observation outcome is deterministic: exact string match = `matched_expectation`, otherwise `deviated`
- Feedback signals carry the observation ID in their lineage and tag the outcome type
- Signal type is always `meta_feedback` with source "Stage 7 Observability & Feedback"
- Feedback confidence is fixed at 0.95 for bootstrap signals

## Dependencies

- `@factory/schemas` -- `ObservationArtifact` type
