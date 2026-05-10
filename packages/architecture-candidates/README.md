# @factory/architecture-candidates

Emits ArchitectureCandidate artifacts from compiled Intent Specifications, describing the candidate execution topology, model binding, tool policy, and convergence posture for downstream selection.

## Pipeline Position

**Stage:** 4.5
**Consumes:** `IS-*` (compiled Intent Specification), `ES-*` (emitted ExecutableSpecification)
**Produces:** `AC-*` (ArchitectureCandidate)

## Exports

- `emitArchitectureCandidate()` -- Creates an ArchitectureCandidate artifact from a Intent Specification and ExecutableSpecification pair with topology, model binding, tool policy, and convergence policy sections
- `renderArchitectureCandidateYaml()` -- Serializes an ArchitectureCandidate to YAML string
- `architectureCandidateIdFromIntentSpecificationId()` -- Deterministic ID derivation from IS-* to AC-*

## Key Invariants

- Bootstrap candidates use `single_node` topology, `unbound` model binding, `restricted` tool policy, and `manual_review` convergence
- Every candidate carries full lineage back to its source Intent Specification and ExecutableSpecification
- Candidate status is always `proposed` at emission time; promotion happens downstream

## Dependencies

- `@factory/schemas` -- `ArchitectureCandidate` type
