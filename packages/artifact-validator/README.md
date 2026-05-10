# @factory/artifact-validator

Pure TypeScript validation for persisted Factory artifacts.

## Ontology Alias

This package enforces selected ontology constraints before ArangoDB persistence.
It is the current implementation surface for fail-closed artifact creation and
constraint enforcement. The package name `@factory/artifact-validator` remains
the stable compatibility name; ontology terminology does not imply a package
rename.

## Pipeline Position

**Stage:** Cross-cutting persistence guard
**Consumes:** Collection name and artifact document
**Produces:** Validation result with violations and optional CRP signal

## Current Constraints

- C1 lineage completeness for non-signal artifact collections
- C7 low-confidence CRP warning
- C9 fail-closed coverage report pass/fail evidence
- C15 recursive secret-pattern rejection

## Compatibility Notes

- `specs_workgraphs` remains the persisted ExecutableSpecification compatibility collection.
- `specs_coverage_reports` remains the persisted Verification Report
  compatibility collection.
- Gate report names remain current runtime evidence terms until a dedicated
  one-family rename proposal proves compatibility.
