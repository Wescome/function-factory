# @factory/ff-pipeline

Cloudflare Workflow implementation of the active Factory pipeline.

## Ontology Alias

This worker moves current compatibility artifacts through the runtime pipeline:
PRD input, ExecutableSpecification compilation, Coherence Verification evidence, synthesis, Fidelity
Verification evidence, MRP assembly, lifecycle transitions, and diagnostics.

Ontology v0.2 aliases ExecutableSpecification as `Executable Specification`, compile coverage
as `Coherence Verification`, simulation coverage as `Fidelity Verification`,
and assurance coverage as `Persistence Verification`. Numbered runtime names
are legacy compatibility shims only; new worker code should use ontology-named
terms.
The worker package name `@factory/ff-pipeline` remains the stable compatibility
name.

## Runtime Surfaces

- `specs_workgraphs` for compiled ExecutableSpecification persistence
- `specs_coverage_reports` for Verification Report persistence
- `specs_functions` for Function lifecycle state
- `lineage_edges` for artifact lineage
- diagnostic routes for function identity, Fidelity Verification, Persistence
  Verification, and MRP evidence

## Compatibility Notes

- Do not introduce new numbered verification APIs. Add ontology-named
  aliases and routes first, then keep numbered routes and fields only as
  temporary legacy compatibility shims during migration.
- Future physical renames must use
  `specs/reference/ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md` and preserve live
  worker evidence compatibility.
