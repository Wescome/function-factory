# @factory/harness-bridge

Harness-agnostic execution bridge that dispatches WorkGraph nodes through pluggable adapters, producing deterministic execution plans and structured ExecutionLog artifacts.

## Pipeline Position

**Stage:** Cross-cutting (Stage 6 execution infrastructure)
**Consumes:** `WG-*` (WorkGraph)
**Produces:** `EL-*` (ExecutionLog artifacts as YAML)

## Exports

- `derivePlan()` -- Deterministic dispatch plan from a WorkGraph (alphabetical node ordering)
- `harnessExecute()` -- Orchestrator that validates a WorkGraph, resolves an adapter, dispatches each node, and returns an ExecutionLog
- `registerAdapter()` -- Registers a HarnessAdapter in an adapter registry
- `emitExecutionLog()` -- Writes an ExecutionLog to disk as YAML
- `dryRunAdapter` -- Reference adapter that simulates execution with status `simulated`
- `HarnessAdapter` interface -- Pluggable boundary for adapter implementations
- `HarnessAdapterRegistry` type -- Map of adapter ID to adapter implementation
- `AdapterNodeOutcome` type -- Per-node result shape returned by adapters

## Key Invariants

- WorkGraph is schema-validated at the boundary before any adapter invocation
- Missing adapter produces an ExecutionLog with `adapter_unavailable` status, never a thrown exception
- Per-node adapter failures produce `failed` status; the harness does not retry or roll back
- Plan fields are deterministic; outcome fields may vary across invocations
- Pure/IO split: `harnessExecute` produces in-memory logs; `emitExecutionLog` handles disk writes

## Dependencies

- `@factory/schemas` -- `WorkGraph`, `ExecutionLog`, `ExecutionNodeRecord` schemas
- `yaml` -- YAML serialization for log emission
