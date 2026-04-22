# @factory/prd-authoring

Renders structured PRD markdown from FunctionProposal demand, producing compiler-ready PRD artifacts with YAML frontmatter and required sections.

## Pipeline Position

**Stage:** 5 input
**Consumes:** `FP-*` (FunctionProposal)
**Produces:** `PRD-*` (rendered PRD markdown with frontmatter)

## Exports

- `renderPrdFromFunctionProposal()` -- Deterministic PRD renderer that transforms a FunctionProposal into a complete PRD with Problem, Goal, Constraints, Acceptance Criteria, Success Metrics, and Out of Scope sections
- `validateRenderedPrdShape()` -- Guards that rendered markdown contains all required sections and valid YAML frontmatter
- `prdIdFromFunctionProposalId()` -- Deterministic ID derivation from FP-* to PRD-*
- `ProposalAuthoringContext`, `RenderedPrd` types

## Key Invariants

- Only supported bootstrap FunctionProposal IDs are accepted; unsupported proposals fail explicitly
- Every rendered PRD must contain: Problem, Goal, Constraints, Acceptance Criteria, Success Metrics, Out of Scope
- YAML frontmatter must be present with lineage fields (source_refs, explicitness, rationale)
- Rendered PRDs preserve full lineage from FunctionProposal through capability and upstream source refs

## Dependencies

- `@factory/schemas` -- Artifact types and lineage primitives
