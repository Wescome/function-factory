# @factory/ff-pipeline

Cloudflare Workflow implementation of the active Factory pipeline.

## Ontology Alias

This worker moves current compatibility artifacts through the runtime pipeline:
PRD input, WorkGraph compilation, Gate 1 evidence, synthesis, Gate 2 evidence,
MRP assembly, lifecycle transitions, and diagnostics.

Ontology v0.2 aliases WorkGraph as `Executable Specification`, Gate 1 as
`Coherence Verification`, Gate 2 as `Fidelity Verification`, and Gate 3 as
`Persistence Verification`. The worker package name `@factory/ff-pipeline` and
runtime terms WorkGraph, Gate 2, MRP, and lifecycle remain stable compatibility
names.

## Runtime Surfaces

- `specs_workgraphs` for compiled WorkGraph persistence
- `specs_coverage_reports` for Gate report persistence
- `specs_functions` for Function lifecycle state
- `lineage_edges` for artifact lineage
- diagnostic routes for function identity, Gate evidence, and MRP evidence

## Compatibility Notes

- Do not rename WorkGraph IDs, Gate 2 report names, MRP IDs, lifecycle states,
  or Arango collection names as part of ontology grounding alone.
- Future physical renames must use
  `specs/reference/ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md` and preserve live
  worker evidence compatibility.
