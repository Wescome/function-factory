# @factory/capability-delta

Evaluates the gap between a declared BusinessCapability and the current repo state, then emits typed FunctionProposal demand for each identified deficit.

## Pipeline Position

**Stage:** 4
**Consumes:** `BC-*` (BusinessCapability), `RepoInventory`
**Produces:** `DEL-*` (CapabilityDelta), `FP-*` (FunctionProposal)

## Exports

- `evaluateDelta()` -- Compares a BusinessCapability against repo inventory; returns a CapabilityDelta with findings across execution, control, evidence, and integration dimensions
- `emitFunctionProposals()` -- Derives FunctionProposal artifacts from a CapabilityDelta for each identified gap
- `validateInventory()` -- Phase 0 seam for structured repo inventory input
- `capabilityDeltaId()` -- Deterministic ID generation for delta artifacts
- `RepoInventory` type -- Structured inventory input shape

## Key Invariants

- Only supported bootstrap capabilities are accepted; unsupported IDs throw explicitly
- Findings are deterministic and rule-based with no LLM inference
- Every emitted FunctionProposal carries lineage back to its source BusinessCapability
- Delta classification uses four dimensions: execution, control, evidence, integration

## Dependencies

- `@factory/schemas` -- `BusinessCapability`, `CapabilityDelta`, `FunctionProposal` types
- `yaml` -- YAML serialization for artifact emission
