# @factory/signal-hygiene

Normalizes, deduplicates, and weights raw signals before they re-enter the pipeline as clean upstream input.

## Pipeline Position

**Stage:** 7.25
**Consumes:** Raw signals (from Stage 7 observability feedback)
**Produces:** `SNB-*` (SignalNormalizationArtifact batches)

## Exports

- `normalizeSignals()` -- Trims titles/sources, assigns trust scores by kind, and computes dedupe keys
- `deduplicateSignals()` -- Removes duplicate signals by dedupe key, returning kept signals and duplicate IDs
- `weightSignals()` -- Computes effective weight as `confidence * severity * trustScore`, capped per kind
- `emitSignalBatch()` -- Assembles a `SignalNormalizationArtifact` from processed signals with lineage
- `signalBatchIdFromRunId()` -- Deterministic ID generation for signal batches
- `SIGNAL_TRUST_BY_KIND` -- Trust score policy: external=0.95, feedback=0.75, inferred=0.6
- `SIGNAL_WEIGHT_CAP_BY_KIND` -- Weight cap policy: external=1.0, feedback=0.6, inferred=0.5
- `SIGNAL_WEIGHTING_POLICY_ID` -- Canonical policy ID for the weighting rules

## Key Invariants

- Trust scores and weight caps are deterministic and governed by named policy constants
- Deduplication is keyed on `kind::title::source` (case-insensitive, trimmed)
- Effective weight never exceeds the per-kind cap
- Emitted batches carry full lineage and reference the governing weighting policy

## Dependencies

- `@factory/schemas` -- `NormalizedSignal`, `SignalNormalizationArtifact` types
