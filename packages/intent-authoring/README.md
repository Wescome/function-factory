# @factory/intent-authoring

Renders structured Intent Specification markdown from FunctionProposal demand, producing compiler-ready Intent Specification artifacts with YAML frontmatter and required sections.

## Ontology Alias

This package renders the current Intent Specification artifact family, which ontology v0.2
aliases as `Intent Specification`. The compatibility API remains IS-oriented:
`IS-*` IDs, `specs/intent-specifications/`, and `@factory/intent-authoring` stay current.

## Pipeline Position

**Stage:** 5 input
**Consumes:** `FP-*` (FunctionProposal)
**Produces:** `IS-*` (rendered Intent Specification markdown with frontmatter)

## Exports

- `renderPrdFromFunctionProposal()` -- Deterministic Intent Specification renderer that transforms a FunctionProposal into a complete Intent Specification with Problem, Goal, Constraints, Acceptance Criteria, Success Metrics, and Out of Scope sections
- `validateRenderedPrdShape()` -- Guards that rendered markdown contains all required sections and valid YAML frontmatter
- `intentSpecificationIdFromFunctionProposalId()` -- Deterministic ID derivation from FP-* to IS-*
- `ProposalAuthoringContext`, `RenderedPrd` types

## Key Invariants

- Only supported bootstrap FunctionProposal IDs are accepted; unsupported proposals fail explicitly
- Every rendered Intent Specification must contain: Problem, Goal, Constraints, Acceptance Criteria, Success Metrics, Out of Scope
- YAML frontmatter must be present with lineage fields (source_refs, explicitness, rationale)
- Rendered Intent Specifications preserve full lineage from FunctionProposal through capability and upstream source refs

## Dependencies

- `@factory/schemas` -- Artifact types and lineage primitives
