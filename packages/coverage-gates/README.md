# @factory/coverage-gates

Fail-closed coverage evaluators for the Factory pipeline. Currently implements Gate 1 (Compile Coverage Gate); Gates 2 and 3 are planned for subsequent PRs.

## Pipeline Position

**Stage:** 5.5
**Consumes:** Compiler intermediates (atoms, invariants, validations, dependencies, PRD ID, factory mode)
**Produces:** `CR-*` (Gate1Report coverage reports as YAML)

## Exports

- `runGate1()` -- Pure function that composes five coverage checks and returns a validated Gate1Report
- `emitGate1Report()` -- Side-effect module that writes a Gate1Report to disk as YAML
- `Gate1Input` type -- Typed input for the five coverage checks

### Coverage Checks (internal)

- `checkAtomCoverage` -- Detects orphan atoms with no contract or invariant coverage
- `checkInvariantCoverage` -- Detects invariants missing validation or detector coverage
- `checkValidationCoverage` -- Detects validations that cover nothing
- `checkDependencyClosure` -- Detects dangling dependency references
- `checkBootstrapPrefix` -- (bootstrap mode only) Ensures all artifact IDs carry META- prefix

## Key Invariants

- Gate evaluators are deterministic pure functions over Zod-validated inputs
- Coverage Reports are emitted on every gate run, pass or fail
- Pure/IO split: `runGate1` has no side effects; `emitGate1Report` handles disk writes
- Bootstrap mode adds a fifth check (bootstrap prefix); steady-state mode runs four checks
- Remediation advice is generated for every failing check

## Dependencies

- `@factory/schemas` -- `Gate1Report`, `ArtifactId`, coverage schemas
- `yaml` -- YAML serialization for report emission
