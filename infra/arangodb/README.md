# ArangoDB Infrastructure

ArangoDB initialization, seeding, verification, and one-time migration scripts
for the Function Factory runtime store.

## Ontology Alias

This directory owns persisted collection contracts. Ontology v0.2 aliases Intent Specification
as `Intent Specification`, Executable Specification as `Executable Specification`, Verification
Report as `Verification Report`, and assurance coverage as `Persistence Verification`.

The physical collection names remain stable compatibility names. Do not rename
collections from ontology terminology alone.

## Stable Collections

- `specs_functions`
- `intent_specifications`
- `executable_specifications`
- `specs_invariants`
- `verification_reports`
- `lineage_edges`
- `ontology_classes`
- `ontology_properties`
- `ontology_constraints`
- `ontology_instances`

## Runtime Contracts

- `intent_specifications` stores current Intent Specification/Intent Specification artifacts.
- `executable_specifications` stores current Executable Specification/Executable Specification
  artifacts.
- `verification_reports` stores current Verification Report/Verification Report
  and Gate evidence artifacts.
- `specs_functions` stores Function lifecycle state used by worker diagnostics.
- `lineage_edges` stores traceability between persisted artifacts.

## Compatibility Notes

Any future collection rename requires dual-read compatibility, write
compatibility, a one-family rename proposal, data migration, rollback plan, and
live worker evidence validation. The first proposal must start from
`specs/reference/ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`.
