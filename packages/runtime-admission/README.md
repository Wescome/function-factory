# @factory/runtime-admission

Evaluates whether a WorkGraph is admitted to runtime execution based on bootstrap mode status and linked ArchitectureCandidate selection decision.

## Pipeline Position

**Stage:** 6
**Consumes:** `ACS-*` (ArchitectureCandidateSelection), `WG-*` (WorkGraph)
**Produces:** `RAD-*` (RuntimeAdmissionArtifact with allow/deny decision)

## Exports

- `evaluateRuntimeAdmission()` -- Produces an allow or deny RuntimeAdmissionArtifact based on bootstrap mode and selection decision
- `renderRuntimeAdmissionYaml()` -- Serializes a RuntimeAdmissionArtifact to YAML string
- `runtimeAdmissionIdFromWorkGraphId()` -- Deterministic ID derivation from WG-* to RAD-*

## Key Invariants

- Admission is denied if bootstrap mode is not active
- Admission is denied if the linked ArchitectureCandidate selection decision is not `selected`
- Every admission artifact carries full lineage (WorkGraph, candidate, selection)
- The decision is binary (allow/deny) with an explicit reason string

## Dependencies

- `@factory/schemas` -- `RuntimeAdmissionArtifact` type
