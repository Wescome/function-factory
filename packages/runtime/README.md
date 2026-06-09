# @factory/runtime

Trust scoring and invariant health monitoring for deployed Functions. Planned to provide the runtime evaluation layer that feeds Persistence Verification monitoring.

## Ontology Alias

This package is the reserved implementation surface for runtime trust,
invariant health, and the continuous-assurance side of `Persistence
Verification`. The current package name remains `@factory/runtime`; ontology
terminology does not imply a package rename.

## Pipeline Position

**Stage:** Cross-cutting
**Consumes:** Deployed Function state, invariant detector outputs
**Produces:** Trust scores, health assessments (not yet implemented)

## Exports

Placeholder package. No public exports yet. The module compiles and resolves in the workspace but contains no implementation.

## Key Invariants

- Package exists to reserve the namespace and establish workspace resolution
- Real implementation lands in a future PR

## Dependencies

- `@factory/schemas` -- Artifact types (for future implementation)
