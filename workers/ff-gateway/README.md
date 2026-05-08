# @factory/ff-gateway

Public Factory API gateway for read-only artifact access, lineage queries,
gate evaluation, workflow triggering, and operator inbox routes.

## Ontology Alias

This worker exposes current compatibility names over HTTP and service bindings.
It routes Gate 1 evaluation, spec reads, lineage/impact lookups, CRP inbox
queries, MRP inbox queries, and pipeline workflow triggers.

Ontology v0.2 aliases Gate 1 as `Coherence Verification`, but the public route
`/gate/1` and package name `@factory/ff-gateway` remain stable compatibility
names.

## Runtime Surfaces

- `GET /specs/:collection/:key`
- `GET /lineage/:collection/:key`
- `POST /gate/1`
- `GET /gate-status/:gate/:id`
- `GET /crps/pending`
- `GET /mrps/pending`
- `POST /pipeline`

## Compatibility Notes

- HTTP paths are external API contracts and must not be renamed from ontology
  terminology alone.
- CRP and MRP route names remain current runtime terms until a dedicated
  one-family rename proposal proves compatibility.
