# @factory/ff-gates

Cloudflare Worker service binding for deterministic `Coherence Verification`.

## Ontology Alias

Ontology v0.2 names this worker's verification role `Coherence Verification`.
This worker still accepts and reports on ExecutableSpecification artifacts, which are aliased
as `Executable Specification`.

The worker package name `@factory/ff-gates` remains a stable compatibility
name. New service-binding callers should prefer
`evaluateCoherenceVerification`; `evaluateGate1`, the `CoherenceVerificationReport` shape, and
the `/gate/1` gateway route remain legacy compatibility shims.

## Runtime Surfaces

- Service binding consumed by `@factory/ff-gateway`
- ExecutableSpecification parse and completeness checks
- `specs_workgraphs` lineage roots
- fail-closed Coherence Verification report output

## Compatibility Notes

- Do not add new numbered compile-coverage APIs. Add ontology-named aliases first, keep
  legacy shims in place, and require a one-family rename proposal before any
  physical rename.
- This worker performs deterministic validation only; report persistence shapes
  stay compatible until a dedicated migration proves dual-read compatibility.
