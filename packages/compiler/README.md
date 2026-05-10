# @factory/compiler

Stage 5 compiler that transforms a PRD into compiler intermediates, runs
Coherence Verification, and emits a WorkGraph. Eight narrow passes from
normalization through workgraph assembly.

## Ontology Alias

This package implements compilation transformations from the ontology v0.2
`Intent Specification` alias to the `Executable Specification` alias. The
stable compatibility names remain PRD, WorkGraph, legacy compile-coverage
artifact IDs, and `@factory/compiler`. New code should prefer Coherence
Verification APIs; numbered compile-coverage APIs remain legacy compatibility
shims.

## Pipeline Position

**Stage:** 5
**Consumes:** `PRD-*` (PRD markdown files)
**Produces:** `CR-*` (Coherence Verification Coverage Reports), `WG-*` (WorkGraphs)

## Exports

- `compile()` -- Orchestrator that reads a PRD file, runs Passes 0-8, emits a Coverage Report and WorkGraph, and returns the aggregate result
- `CompileOptions` type -- Override factory mode, output directories, and timestamp
- `CompileResult`, `CompilerIntermediates`, `FactoryMode`, `NormalizedPRD` types

### Passes (via `@factory/compiler/passes`)

- Pass 0: `normalize` -- Parse PRD markdown and YAML frontmatter
- Pass 1: `extractAtoms` -- Derive atomic work units
- Pass 2: `deriveContracts` -- Derive interface contracts
- Pass 3: `deriveInvariants` -- Derive system invariants
- Pass 4: `deriveDependencies` -- Derive dependency graph
- Pass 5: `deriveValidations` -- Derive validation rules
- Pass 6: `consistencyCheck` -- Cross-check intermediates
- Pass 7: `runCoherenceVerificationPass` -- Coherence Verification via @factory/coverage-gates
- Pass 7 compatibility: `runGate1Pass` -- legacy compatibility shim
- Pass 8: `assembleWorkgraph` / `emitWorkgraph` -- Assemble and emit the WorkGraph

## Key Invariants

- Individual passes are pure functions; IO is confined to the compile orchestrator
- Timestamp is generated once in the orchestrator and threaded through all passes
- Coherence Verification failure does not prevent Coverage Report emission; the report is the product
- Deterministic: identical inputs produce identical outputs (modulo timestamp)

## Dependencies

- `@factory/schemas` -- All artifact types
- `@factory/coverage-gates` -- Coherence Verification evaluation (Pass 7)
- `yaml` -- YAML parsing and emission
