# @factory/assurance-graph

Incident propagation via dependency relationships. Planned to model how failures in one Function affect downstream dependents through the Factory's dependency graph.

## Ontology Alias

This package maps directly to the ontology v0.2 `Assurance Graph` structural
component. The existing `@factory/assurance-graph` package name is already the
stable compatibility name.

## Pipeline Position

**Stage:** Cross-cutting
**Consumes:** Dependency and incident data from the runtime layer
**Produces:** Propagation analysis (not yet implemented)

## Exports

Placeholder package. No public exports yet. The module compiles and resolves in the workspace but contains no implementation.

## Key Invariants

- Package exists to reserve the namespace and establish workspace resolution
- Real implementation lands in a future PR

## Dependencies

- `@factory/schemas` -- Artifact types (for future implementation)
