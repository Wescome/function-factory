# @factory/ontology-loader

Queryable ontology loading for Factory runtime and agent support.

## Ontology Alias

This package loads the current machine-readable ontology assets into ArangoDB
collections that agents can query. It supports ontology-grounded execution but
does not replace current compatibility names such as Intent Specification, ExecutableSpecification, Verification
Report, or Gate terminology.

The package name `@factory/ontology-loader` remains the stable compatibility
name; ontology terminology does not imply a package rename.

## Pipeline Position

**Stage:** Cross-cutting ontology substrate
**Consumes:** TypeScript translations of ontology classes, properties,
constraints, and instances
**Produces:** Queryable ArangoDB ontology collections

## Runtime Collections

- `ontology_classes`
- `ontology_properties`
- `ontology_constraints`
- `ontology_instances`

## Compatibility Notes

- Persistence targets returned by this package must stay aligned with active
  runtime collections such as `intent_specifications`, `executable_specifications`, and
  `verification_reports`.
- Future ontology rename work must preserve read compatibility for existing
  persisted artifacts and live worker evidence.
