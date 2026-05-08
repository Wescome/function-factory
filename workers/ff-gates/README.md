# @factory/ff-gates

Cloudflare Worker service binding for deterministic Gate 1 evaluation.

## Ontology Alias

Gate 1 maps to ontology v0.2 `Coherence Verification`. This worker still
accepts and reports on WorkGraph artifacts, which are aliased as `Executable
Specification`.

The worker package name `@factory/ff-gates`, the `Gate1Report` shape, and the
`/gate/1` gateway route remain stable compatibility names.

## Runtime Surfaces

- Service binding consumed by `@factory/ff-gateway`
- WorkGraph parse and completeness checks
- `specs_workgraphs` lineage roots
- fail-closed Gate 1 report output

## Compatibility Notes

- Do not rename Gate 1, Gate1Report, WorkGraph, or `specs_workgraphs` without a
  one-family rename proposal and remote `Repository Audit` evidence.
- This worker performs deterministic validation only; it does not introduce
  new ontology terminology into runtime API shapes.
