# @factory/selection-bias

Computes candidate reliability from observation history and derives a bounded selection bias adjustment that feeds back into candidate scoring to correct for systematic over- or under-selection.

## Pipeline Position

**Stage:** 8.5
**Consumes:** Observation match/deviation counts, drift indicator from Stage 8
**Produces:** `CRL-*` (CandidateReliability), `SBI-*` (SelectionBiasInput)

## Exports

- `computeCandidateReliability()` -- Derives a reliability score from match/deviation counts using configurable reward/penalty steps and a baseline
- `computeSelectionBiasAdjustment()` -- Centers reliability around 0.5, scales by 0.3, and subtracts a drift penalty to produce a bounded bias adjustment
- `emitCandidateReliability()` -- Emits a CRL artifact with reliability score and lineage
- `emitSelectionBiasInput()` -- Emits an SBI artifact with the computed bias adjustment
- `MATCH_REWARD_STEP`, `DEVIATION_PENALTY_STEP`, `RELIABILITY_BASELINE` -- Reliability policy constants
- `MAX_NEGATIVE_BIAS`, `MAX_POSITIVE_BIAS`, `DRIFT_PENALTY_MULTIPLIER` -- Bias adjustment policy constants

## Key Invariants

- Reliability score is bounded between 0 and 1
- Bias adjustment is bounded between `MAX_NEGATIVE_BIAS` and `MAX_POSITIVE_BIAS`
- Drift penalty multiplicatively reduces positive bias to prevent runaway selection entrenchment
- All policy constants are named and exported for governance transparency

## Dependencies

- `@factory/schemas` -- `CandidateReliability`, `SelectionBiasInput` types
