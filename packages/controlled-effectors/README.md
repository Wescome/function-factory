# @factory/controlled-effectors

Guards tool invocations against the ArchitectureCandidate's tool policy and emits EFF-* effector artifacts that record what each execution node is permitted to do.

## Pipeline Position

**Stage:** 6.5
**Consumes:** `EXS-*` (ExecutionStart), tool policy from ArchitectureCandidate
**Produces:** `EFF-*` (EffectorArtifact)

## Exports

- `assertToolPolicyAllows()` -- Guard that enforces tool policy: `none` blocks all non-no_op effectors; `restricted` blocks direct tool_call in bootstrap mode
- `emitEffectorArtifact()` -- Emits an EFF artifact for a target node after asserting tool policy compliance
- `buildExecutionNodeRecord()` -- Constructs an ExecutionNodeRecord from an EffectorArtifact
- `effectorIdFromNodeId()` -- Deterministic ID derivation from node ID to EFF-*

## Key Invariants

- Tool policy is enforced before any effector emission; violations throw
- Bootstrap mode uses `restricted` policy, which allows `file_write` and `no_op` but blocks `tool_call`
- `none` policy allows only `no_op` effectors
- Every effector artifact records its mode (simulate or safe_execute) and the governing policy

## Dependencies

- `@factory/schemas` -- `EffectorArtifact`, `ExecutionNodeRecord` types
