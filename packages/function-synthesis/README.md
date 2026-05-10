# @factory/function-synthesis

Five-role synthesis runtime for turning a compiled ExecutableSpecification and selected
ArchitectureCandidate into Function implementation evidence.

## Ontology Alias

This package operates on ExecutableSpecification artifacts, which ontology v0.2 aliases as
`Executable Specification`. It emits `FidelityVerificationInput` evidence and
synthesis traces that support `Fidelity Verification`. Numbered simulation
coverage names are legacy compatibility shims only; new code should use
Fidelity Verification terms.
The package name `@factory/function-synthesis` remains the stable compatibility
name.

## Pipeline Position

**Stage:** Worker synthesis process
**Consumes:** ExecutableSpecification, ArchitectureCandidate, binding mode, synthesis config
**Produces:** SynthesisResult, role traces, FidelityVerificationInput,
candidate-selection evidence, and patch proposals

## Runtime Concepts

- Planner, Coder, Critic, Tester, and Verifier role contracts
- Binding modes for stub, Pi agent, and live synthesis paths
- Decision-state transitions for pass, retry, escalation, and failure
- Fidelity Verification evidence inputs for semantic fidelity review

## Compatibility Notes

- `synthesize(workGraph, candidate, bindingMode, config)` remains the primary
  compatibility API.
- `Gate2Input` remains as a temporary legacy export that points at
  `FidelityVerificationInput`.
- This package must not be renamed as part of ontology grounding alone.
