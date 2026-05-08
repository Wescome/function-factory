# @factory/function-synthesis

Five-role synthesis runtime for turning a compiled WorkGraph and selected
ArchitectureCandidate into Function implementation evidence.

## Ontology Alias

This package operates on WorkGraph artifacts, which ontology v0.2 aliases as
`Executable Specification`. It emits Gate 2 inputs and synthesis traces that
support `Fidelity Verification`. The stable compatibility names remain
WorkGraph, ArchitectureCandidate, Gate 2, and `@factory/function-synthesis`.

## Pipeline Position

**Stage:** Worker synthesis process
**Consumes:** WorkGraph, ArchitectureCandidate, binding mode, synthesis config
**Produces:** SynthesisResult, role traces, Gate2Input, candidate-selection
evidence, and patch proposals

## Runtime Concepts

- Planner, Coder, Critic, Tester, and Verifier role contracts
- Binding modes for stub, Pi agent, and live synthesis paths
- Decision-state transitions for pass, retry, escalation, and failure
- Gate 2 evidence inputs for semantic fidelity review

## Compatibility Notes

- `synthesize(workGraph, candidate, bindingMode, config)` remains the primary
  compatibility API.
- WorkGraph IDs and Gate 2 evidence names remain live runtime terms until a
  dedicated one-family rename proposal proves compatibility.
- This package must not be renamed as part of ontology grounding alone.
