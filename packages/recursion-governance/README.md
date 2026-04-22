# @factory/recursion-governance

Guards against unbounded self-modification by evaluating whether the Factory may author PRDs from its own FunctionProposals, enforcing bootstrap allowlists and same-run recursion limits.

## Pipeline Position

**Stage:** Cross-cutting (governs Stage 4-5 self-authoring loops)
**Consumes:** `FP-*` (FunctionProposal), governance policy, authoring context
**Produces:** `RGD-*` (GovernanceDecisionArtifact as YAML)

## Exports

- `evaluateRecursionGovernance()` -- Evaluates whether a FunctionProposal is permitted to trigger PRD self-authoring under the current policy
- `evaluatePrdQualityGate()` -- Validates rendered PRD candidates against required sections, forbidden placeholder tokens, and minimum length
- `renderGovernanceDecisionArtifact()` -- Serializes a governance evaluation result as a YAML artifact with lineage
- `governanceDecisionArtifactId()` -- Deterministic ID generation for governance decisions
- `GovernanceEvaluationInput`, `GovernanceEvaluationResult`, `RenderedPrdCandidate` types

## Key Invariants

- Only bootstrap mode is supported; non-bootstrap mode proposals are denied
- FunctionProposal must appear in the bootstrap self-author allowlist
- Same-run recursion is blocked: if a PRD derived from a proposal was already authored in the current run, the proposal is denied
- PRD quality gate rejects documents with TODO/TBD/placeholder tokens or missing required sections
- Rendered PRDs must exceed 600 characters minimum length

## Dependencies

- `@factory/schemas` -- Artifact types and lineage primitives
