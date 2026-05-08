# @factory/ff-gateway

Public Factory API gateway for read-only artifact access, lineage queries,
gate evaluation, workflow triggering, and operator inbox routes.

## Ontology Alias

This worker exposes ontology-named HTTP routes while retaining current
compatibility routes. It routes Coherence Verification, spec reads,
lineage/impact lookups, CRP inbox queries, MRP inbox queries, and pipeline
workflow triggers.

Ontology v0.2 names Gate 1 as `Coherence Verification`. New callers should use
`POST /coherence-verification`; the public route `/gate/1` and package name
`@factory/ff-gateway` remain stable compatibility names and legacy
compatibility shims. Numbered gate routes are legacy compatibility shims.

## Runtime Surfaces

- `GET /specs/:collection/:key`
- `GET /lineage/:collection/:key`
- `POST /coherence-verification`
- `POST /gate/1`
- `GET /gate-status/:gate/:id`
- `GET /crps/pending`
- `GET /mrps/pending`
- `POST /pipeline`

## Compatibility Notes

- Do not introduce new numbered Gate 1 routes. Add ontology-named routes first,
  keep numbered routes as legacy shims, and require a one-family rename
  proposal before removing compatibility paths.
- CRP and MRP route names remain current runtime terms until a dedicated
  one-family rename proposal proves compatibility.
