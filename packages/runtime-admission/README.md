# @factory/runtime-admission

Evaluates whether a ExecutableSpecification is admitted to runtime execution based on bootstrap mode status and linked ArchitectureCandidate selection decision.

## Ontology Alias

This package admits a ExecutableSpecification, aliased by ontology v0.2 as an `Executable
Specification`, into runtime execution. The compatibility names remain
ExecutableSpecification, `WG-*`, `RAD-*`, and `@factory/runtime-admission`.

## Pipeline Position

**Stage:** 6
**Consumes:** `ACS-*` (ArchitectureCandidateSelection), `WG-*` (ExecutableSpecification)
**Produces:** `RAD-*` (RuntimeAdmissionArtifact with allow/deny decision)

## Exports

- `evaluateRuntimeAdmission()` -- Produces an allow or deny RuntimeAdmissionArtifact based on bootstrap mode and selection decision
- `renderRuntimeAdmissionYaml()` -- Serializes a RuntimeAdmissionArtifact to YAML string
- `runtimeAdmissionIdFromWorkGraphId()` -- Deterministic ID derivation from WG-* to RAD-*

## Key Invariants

- Admission is denied if bootstrap mode is not active
- Admission is denied if the linked ArchitectureCandidate selection decision is not `selected`
- Every admission artifact carries full lineage (ExecutableSpecification, candidate, selection)
- The decision is binary (allow/deny) with an explicit reason string

## Dependencies

- `@factory/schemas` -- `RuntimeAdmissionArtifact` type
