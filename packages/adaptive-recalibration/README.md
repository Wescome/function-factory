# @factory/adaptive-recalibration

Recalibrates Pressure strength and urgency by blending baseline values with weighted external signals, bounded feedback influence, and drift indicators derived from observation outcomes.

## Pipeline Position

**Stage:** 8
**Consumes:** `OBS-*` outcomes (deviation/match counts), weighted signals, baseline Pressure values
**Produces:** `RPRS-*` (RecalibratedPressure), `DDI-*` (DeltaDriftInput)

## Exports

- `computeDriftIndicator()` -- Computes a bounded drift value from deviation and match counts using configurable step sizes
- `recalibratePressure()` -- Blends baseline strength/urgency with external signal weight, feedback influence, and drift to produce recalibrated values
- `emitRecalibratedPressure()` -- Emits an RPRS artifact with full lineage and recalibrated values
- `emitDeltaDriftInput()` -- Emits a DDI artifact recording drift state for downstream consumption
- `DEVIATION_DRIFT_STEP`, `MATCH_RELIEF_STEP`, `DRIFT_CAP`, `MAX_FEEDBACK_INFLUENCE` -- Policy constants

## Key Invariants

- Drift indicator is bounded between 0 and `DRIFT_CAP`
- Feedback influence is capped at `MAX_FEEDBACK_INFLUENCE` to prevent runaway self-reinforcement
- Recalibrated strength and urgency are capped at 1.0
- Blending weights are fixed: strength = 0.7 baseline + 0.2 external + 0.1 feedback + 0.1 drift; urgency = 0.65 baseline + 0.15 external + 0.1 feedback + 0.2 drift

## Dependencies

- `@factory/schemas` -- `RecalibratedPressure`, `DeltaDriftInput` types
