# @factory/meta-governance

Detects policy stress from drift and deviation evidence, emits governance proposals for policy changes, records human decisions, and tracks policy successor lineage.

## Pipeline Position

**Stage:** 9
**Consumes:** Drift indicators, deviation counts, repeated proposal counts
**Produces:** `PSR-*` (PolicyStressReport), `GOVP-*` (GovernanceProposal), `GOVD-*` (GovernanceDecision), `GOVS-*` (PolicySuccessorNote)

## Exports

- `detectPolicyStress()` -- Evaluates drift, deviation, and repeat counts against threshold policies to classify stress as low/moderate/high
- `emitGovernanceProposal()` -- Emits a GOVP artifact proposing a specific policy change (threshold, weight, cap, or other adjustment)
- `emitGovernanceDecision()` -- Records a GOVD artifact capturing an explicit human approved/rejected decision
- `emitPolicySuccessorNote()` -- Emits a GOVS artifact linking predecessor policy, proposal, decision, and successor policy for lineage tracking
- `HIGH_STRESS_*_THRESHOLD`, `MODERATE_STRESS_*_THRESHOLD` -- Stress detection policy constants
- `policyStressReportIdFromPolicyId()`, `governanceProposalIdFromPolicyId()`, `governanceDecisionIdFromProposalId()`, `policySuccessorNoteIdFromPolicyId()` -- Deterministic ID generators

## Key Invariants

- Stress level is `high` when 2+ of 3 indicators exceed high thresholds; `moderate` when 1+ exceed moderate thresholds
- Governance decisions carry `explicit` explicitness because they record human authority
- Policy successor notes preserve full lineage chain: predecessor -> proposal -> decision -> successor
- Activation state tracks whether a successor is proposed-only, approved but not activated, or activated

## Dependencies

- `@factory/schemas` -- `PolicyStressReport`, `GovernanceProposal`, `GovernanceDecision`, `PolicySuccessorNote` types
