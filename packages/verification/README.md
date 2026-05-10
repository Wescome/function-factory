# @factory/verification

Fail-closed verification evaluators for the Factory pipeline. The canonical
ontology name for the implemented evaluator is `Coherence Verification`.

## Ontology Alias

Ontology v0.2 names the three coverage classes as verification processes:

| Former name | Ontology name |
| --- | --- |
| Compile Verification | Coherence Verification |
| Simulation Verification | Fidelity Verification |
| Assurance Verification | Persistence Verification |

New code uses `runCoherenceVerification`, `emitCoherenceVerificationReport`,
`CoherenceVerificationInput`, and `CoherenceVerificationReport`.

## Pipeline Position

**Stage:** 5.5
**Consumes:** Compiler intermediates (atoms, invariants, validations, dependencies, Intent Specification ID, factory mode)
**Produces:** `VR-*` (`CoherenceVerificationReport` verification reports as YAML)

## Exports

- `runCoherenceVerification()` -- Pure function that composes five coverage checks and returns a validated report
- `emitCoherenceVerificationReport()` -- Side-effect module that writes the report to disk as YAML
- `CoherenceVerificationInput` type -- Typed input for the five coverage checks

### Verification Checks (internal)

- `checkAtomVerification` -- Detects orphan atoms with no contract or invariant coverage
- `checkInvariantVerification` -- Detects invariants missing validation or detector coverage
- `checkValidationVerification` -- Detects validations that cover nothing
- `checkDependencyClosure` -- Detects dangling dependency references
- `checkBootstrapPrefix` -- (bootstrap mode only) Ensures all artifact IDs carry META- prefix

## Key Invariants

- Verification evaluators are deterministic pure functions over Zod-validated inputs
- Verification Reports are emitted on every verification run, pass or fail
- Pure/IO split: `runCoherenceVerification` has no side effects; `emitCoherenceVerificationReport` handles disk writes
- Bootstrap mode adds a fifth check (bootstrap prefix); steady-state mode runs four checks
- Remediation advice is generated for every failing check

## Dependencies

- `@factory/schemas` -- `CoherenceVerificationReport`, `ArtifactId`, coverage schemas
- `yaml` -- YAML serialization for report emission
