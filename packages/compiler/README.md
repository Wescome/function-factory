# @factory/compiler

Intent-to-Executable compilation package that transforms a PRD into compiler
intermediates, runs Coherence Verification, and emits a WorkGraph. Historical
pass numbers remain compatibility labels; ontology terms are primary.

## Ontology Alias

This package implements compilation transformations from the ontology v0.2
`Intent Specification` alias to the `Executable Specification` alias. The
stable compatibility names remain PRD, WorkGraph, legacy compile-coverage
artifact IDs, and `@factory/compiler`. New code should prefer Coherence
Verification APIs; numbered compile-coverage APIs remain legacy compatibility
shims.

## Pipeline Position

**Stage:** Intent-to-Executable compilation (legacy Stage 5)
**Consumes:** `PRD-*` (PRD markdown files)
**Produces:** `CR-*` (Coherence Verification Coverage Reports), `WG-*` (WorkGraphs)

## Exports

- `compile()` -- Orchestrator that reads a PRD file, runs the compatibility pass pipeline, emits a Coverage Report and WorkGraph, and returns the aggregate result
- `CompileOptions` type -- Override factory mode, output directories, and timestamp
- `CompileResult`, `CompilerIntermediates`, `FactoryMode`, `NormalizedPRD` types

### Transformations (via `@factory/compiler/passes`)

- Compatibility Pass 0: `normalize` -- Parse PRD markdown and YAML frontmatter
- Decomposition (legacy Pass 1): `extractAtoms` -- Derive atomic work units
- Binding (legacy Pass 2): `deriveContracts` -- Derive interface contracts
- Obligation Extraction (legacy Pass 3): `deriveInvariants` -- Derive system invariants
- Structural Assembly subdivision (legacy Pass 4): `deriveDependencies` -- Derive dependency graph
- Structural Assembly subdivision (legacy Pass 5): `deriveValidations` -- Derive validation rules
- Completeness preflight slot (legacy Pass 6): `consistencyCheck` -- Cross-check intermediates
- Completeness Certification / Coherence Verification (legacy Pass 7): `runCoherenceVerificationPass` -- Coherence Verification via @factory/coverage-gates
- Legacy Pass 7 compatibility: `runGate1Pass` -- legacy compatibility shim
- Executable Specification Assembly: `assembleExecutableSpecification` / `emitExecutableSpecification` -- Assemble and emit the WorkGraph
- Legacy Pass 8 compatibility: `assembleWorkgraph` / `emitWorkgraph` -- compatibility aliases for Executable Specification Assembly
- Ontology Pass 8: Instruction Tuning -- future, not implemented by current WorkGraph assembly

## Key Invariants

- Individual passes are pure functions; IO is confined to the compile orchestrator
- Timestamp is generated once in the orchestrator and threaded through all passes
- Coherence Verification failure does not prevent Coverage Report emission; the report is the product
- Deterministic: identical inputs produce identical outputs (modulo timestamp)

## Dependencies

- `@factory/schemas` -- All artifact types
- `@factory/coverage-gates` -- Coherence Verification evaluation (Pass 7)
- `yaml` -- YAML parsing and emission
