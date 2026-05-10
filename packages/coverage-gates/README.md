# @factory/coverage-gates

Fail-closed verification evaluators for the Factory pipeline. The canonical
ontology name for the implemented evaluator is `Coherence Verification`; the
numbered compile-coverage names remain legacy compatibility shims.

## Ontology Alias

Ontology v0.2 names the three coverage classes as verification processes:

| Compatibility name | Ontology alias |
| --- | --- |
| Compile Coverage | Coherence Verification |
| Simulation Coverage | Fidelity Verification |
| Assurance Coverage | Persistence Verification |

The package name remains a stable compatibility name. New code should prefer
`runCoherenceVerification`, `emitCoherenceVerificationReport`, and
`CoherenceVerificationInput`; `runGate1`, `emitGate1Report`, `Gate1Input`, and
`Gate1Report` remain legacy compatibility shims.

## Pipeline Position

**Stage:** 5.5
**Consumes:** Compiler intermediates (atoms, invariants, validations, dependencies, PRD ID, factory mode)
**Produces:** `CR-*` (`CoherenceVerificationReport` coverage reports as YAML)

## Exports

- `runCoherenceVerification()` -- Pure function that composes five coverage checks and returns a validated report
- `emitCoherenceVerificationReport()` -- Side-effect module that writes the report to disk as YAML
- `CoherenceVerificationInput` type -- Typed input for the five coverage checks
- `runGate1()`, `emitGate1Report()`, and `Gate1Input` -- legacy compatibility shims

### Coverage Checks (internal)

- `checkAtomCoverage` -- Detects orphan atoms with no contract or invariant coverage
- `checkInvariantCoverage` -- Detects invariants missing validation or detector coverage
- `checkValidationCoverage` -- Detects validations that cover nothing
- `checkDependencyClosure` -- Detects dangling dependency references
- `checkBootstrapPrefix` -- (bootstrap mode only) Ensures all artifact IDs carry META- prefix

## Key Invariants

- Verification evaluators are deterministic pure functions over Zod-validated inputs
- Coverage Reports are emitted on every verification run, pass or fail
- Pure/IO split: `runCoherenceVerification` has no side effects; `emitCoherenceVerificationReport` handles disk writes
- Bootstrap mode adds a fifth check (bootstrap prefix); steady-state mode runs four checks
- Remediation advice is generated for every failing check

## Dependencies

- `@factory/schemas` -- `CoherenceVerificationReport`, `ArtifactId`, coverage schemas
- `yaml` -- YAML serialization for report emission
