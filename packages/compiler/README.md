# @factory/compiler

Intent-to-Executable compilation package that transforms a PRD into compiler
intermediates, runs Coherence Verification, and emits a ExecutableSpecification. Historical
pass numbers are reference documentation only; ontology terms are primary.

## Ontology Alias

This package implements compilation transformations from the ontology v0.2
`Intent Specification` alias to the `Executable Specification` alias. The
persisted artifact IDs remain `PRD-*`, `WG-*`, and `CR-*` until the deferred
storage migration. Active APIs use Intent Specification, Executable
Specification, and Verification terminology.

## Pipeline Position

**Stage:** Intent-to-Executable compilation (legacy Stage 5)
**Consumes:** `PRD-*` (PRD markdown files)
**Produces:** `CR-*` (Coherence Verification Coverage Reports), `WG-*` (WorkGraphs)

## Exports

- `compile()` -- Orchestrator that reads an Intent Specification file, runs the transformation pipeline, emits a Verification Report and ExecutableSpecification, and returns the aggregate result
- `CompileOptions` type -- Override factory mode, output directories, and timestamp
- `CompileResult`, `CompilerIntermediates`, `FactoryMode`, `NormalizedPRD` types

### Transformations (via `@factory/compiler/passes`)

- Normalize: `normalize` -- Parse Intent Specification markdown and YAML frontmatter
- Decomposition (legacy Pass 1): `extractAtoms` -- Derive atomic work units
- Binding (legacy Pass 2): `deriveContracts` -- Derive interface contracts
- Obligation Extraction (legacy Pass 3): `deriveInvariants` -- Derive system invariants
- Structural Assembly subdivision (legacy Pass 4): `deriveDependencies` -- Derive dependency graph
- Structural Assembly subdivision (legacy Pass 5): `deriveValidations` -- Derive validation rules
- Completeness preflight slot (legacy Pass 6): `consistencyCheck` -- Cross-check intermediates
- Completeness Certification / Coherence Verification: `runCoherenceVerificationPass` -- Coherence Verification via @factory/coverage-gates
- Executable Specification Assembly: `assembleExecutableSpecification` / `emitExecutableSpecification` -- Assemble and emit the ExecutableSpecification
- Ontology Pass 8: Instruction Tuning -- future, not implemented by current ExecutableSpecification assembly

## Key Invariants

- Individual passes are pure functions; IO is confined to the compile orchestrator
- Timestamp is generated once in the orchestrator and threaded through all passes
- Coherence Verification failure does not prevent Coverage Report emission; the report is the product
- Deterministic: identical inputs produce identical outputs (modulo timestamp)

## Dependencies

- `@factory/schemas` -- All artifact types
- `@factory/coverage-gates` -- Coherence Verification evaluation (Pass 7)
- `yaml` -- YAML parsing and emission
