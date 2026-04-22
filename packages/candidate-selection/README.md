# @factory/candidate-selection

Scores ArchitectureCandidates across five dimensions and produces a selection decision (selected/rejected) against a configurable threshold.

## Pipeline Position

**Stage:** 4.75
**Consumes:** `AC-*` (ArchitectureCandidate)
**Produces:** `ACS-*` (ArchitectureCandidateSelection)

## Exports

- `scoreCandidate()` -- Evaluates a candidate across topologyComplexity, policyRisk, toolExposure, convergenceStrictness, and runtimeReadiness; returns a CandidateScorecard
- `selectCandidate()` -- Scores a candidate and applies a threshold (default 0.8) to produce a selected/rejected decision
- `assertExecutionEligibility()` -- Guard that throws if the linked candidate is not selected
- `renderSelectionYaml()` -- Serializes an ArchitectureCandidateSelection to YAML string
- `selectionArtifactIdFromCandidateId()` -- Deterministic ID derivation from AC-* to ACS-*

## Key Invariants

- Bootstrap scoring supports only the canonical bootstrap candidate ID
- Score is the arithmetic mean of five dimension scores
- Selection threshold is configurable but defaults to 0.8
- Execution eligibility is a hard gate: non-selected candidates cannot proceed to runtime admission

## Dependencies

- `@factory/schemas` -- `ArchitectureCandidateSelection`, `CandidateScorecard`, `CandidateSelectionDecision` types
