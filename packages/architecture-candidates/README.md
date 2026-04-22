# @factory/architecture-candidates

Emits ArchitectureCandidate artifacts from compiled PRDs, describing the candidate execution topology, model binding, tool policy, and convergence posture for downstream selection.

## Pipeline Position

**Stage:** 4.5
**Consumes:** `PRD-*` (compiled PRD), `WG-*` (emitted WorkGraph)
**Produces:** `AC-*` (ArchitectureCandidate)

## Exports

- `emitArchitectureCandidate()` -- Creates an ArchitectureCandidate artifact from a PRD and WorkGraph pair with topology, model binding, tool policy, and convergence policy sections
- `renderArchitectureCandidateYaml()` -- Serializes an ArchitectureCandidate to YAML string
- `architectureCandidateIdFromPrdId()` -- Deterministic ID derivation from PRD-* to AC-*

## Key Invariants

- Bootstrap candidates use `single_node` topology, `unbound` model binding, `restricted` tool policy, and `manual_review` convergence
- Every candidate carries full lineage back to its source PRD and WorkGraph
- Candidate status is always `proposed` at emission time; promotion happens downstream

## Dependencies

- `@factory/schemas` -- `ArchitectureCandidate` type
