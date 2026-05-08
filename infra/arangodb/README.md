# ArangoDB Infrastructure

ArangoDB initialization, seeding, verification, and one-time migration scripts
for the Function Factory runtime store.

## Ontology Alias

This directory owns persisted collection contracts. Ontology v0.2 aliases PRD
as `Intent Specification`, WorkGraph as `Executable Specification`, Coverage
Report as `Verification Report`, and Gate 3 as `Persistence Verification`.

The physical collection names remain stable compatibility names. Do not rename
collections from ontology terminology alone.

## Stable Collections

- `specs_functions`
- `specs_prds`
- `specs_workgraphs`
- `specs_invariants`
- `specs_coverage_reports`
- `lineage_edges`
- `ontology_classes`
- `ontology_properties`
- `ontology_constraints`
- `ontology_instances`

## Runtime Contracts

- `specs_prds` stores current PRD/Intent Specification artifacts.
- `specs_workgraphs` stores current WorkGraph/Executable Specification
  artifacts.
- `specs_coverage_reports` stores current Coverage Report/Verification Report
  and Gate evidence artifacts.
- `specs_functions` stores Function lifecycle state used by worker diagnostics.
- `lineage_edges` stores traceability between persisted artifacts.

## Compatibility Notes

Any future collection rename requires dual-read compatibility, write
compatibility, a one-family rename proposal, data migration, rollback plan, and
live worker evidence validation. The first proposal must start from
`specs/reference/ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`.
