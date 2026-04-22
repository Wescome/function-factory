# @factory/execution-lifecycle

Manages the EXS/EXT/EXR lifecycle: emits execution start, trace, and result artifacts with strict ordering invariants enforced by guard assertions.

## Pipeline Position

**Stage:** 6.25
**Consumes:** `RAD-*` (RuntimeAdmissionArtifact with allow decision)
**Produces:** `EXS-*` (ExecutionStart), `EXT-*` (ExecutionTrace), `EXR-*` (ExecutionResult)

## Exports

- `emitExecutionStart()` -- Emits an EXS artifact after asserting RAD allow; marks execution as started
- `emitExecutionTrace()` -- Emits an EXT artifact recording traversed nodes; requires prior EXS
- `emitExecutionResult()` -- Emits an EXR artifact with final status; requires prior EXS
- `assertExecutionStartAllowed()` -- Guard: EXS requires RAD decision = allow
- `assertTraceAllowed()` -- Guard: EXT requires existing EXS
- `assertResultAllowed()` -- Guard: EXR requires existing EXS
- `executionStartIdFromWorkGraphId()`, `executionTraceIdFromWorkGraphId()`, `executionResultIdFromWorkGraphId()` -- Deterministic ID generators

## Key Invariants

- Lifecycle ordering is enforced: EXS must precede EXT and EXR
- EXS is gated on RAD allow; denied admissions cannot start execution
- Trace records node traversal count and completion mode
- Bootstrap execution uses `deterministic_single_path` completion mode

## Dependencies

- `@factory/schemas` -- `ExecutionStart`, `ExecutionTrace`, `ExecutionResult` types
