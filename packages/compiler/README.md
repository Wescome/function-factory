# @factory/compiler

Stage 5 compiler that transforms a PRD into compiler intermediates, runs Gate 1 coverage evaluation, and emits a WorkGraph. Eight narrow passes from normalization through workgraph assembly.

## Pipeline Position

**Stage:** 5
**Consumes:** `PRD-*` (PRD markdown files)
**Produces:** `CR-*` (Gate 1 Coverage Reports), `WG-*` (WorkGraphs)

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
- Pass 7: `runGate1Pass` -- Gate 1 coverage evaluation via @factory/coverage-gates
- Pass 8: `assembleWorkgraph` / `emitWorkgraph` -- Assemble and emit the WorkGraph

## Key Invariants

- Individual passes are pure functions; IO is confined to the compile orchestrator
- Timestamp is generated once in the orchestrator and threaded through all passes
- Gate 1 failure does not prevent Coverage Report emission; the report is the product
- Deterministic: identical inputs produce identical outputs (modulo timestamp)

## Dependencies

- `@factory/schemas` -- All artifact types
- `@factory/coverage-gates` -- Gate 1 evaluation (Pass 7)
- `yaml` -- YAML parsing and emission
