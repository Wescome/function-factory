# @factory/effector-realization

Realizes effector artifacts into concrete side effects under triple guard: safe_execute mode, trusted environment, and realizable effector type. Produces EFFR-* realization evidence.

## Pipeline Position

**Stage:** 6.75
**Consumes:** `EFF-*` (EffectorArtifact)
**Produces:** `EFFR-*` (EffectorRealization)

## Exports

- `emitEffectorRealization()` -- Emits an EFFR artifact after asserting all three realization guards
- `assertSafeExecuteMode()` -- Guard: only `safe_execute` mode may produce EFFR artifacts
- `assertTrustedEnvironment()` -- Guard: environment must be `trusted`
- `assertRealizableEffectorType()` -- Guard: bootstrap realization supports only sandboxed `file_write`
- `enrichNodeRecordWithRealization()` -- Enriches an ExecutionNodeRecord with realization evidence (artifact ID, output reference)
- `effectorRealizationIdFromEffectorId()` -- Deterministic ID derivation from EFF-* to EFFR-*

## Key Invariants

- Triple guard: all three assertions must pass before realization emission
- Bootstrap realization is restricted to sandboxed file_write only
- Simulate mode cannot produce realization artifacts
- Untrusted environments are rejected unconditionally
- Enriched node records carry the realization artifact ID and output evidence reference

## Dependencies

- `@factory/schemas` -- `EffectorRealization`, `EffectorArtifact`, `ExecutionNodeRecord` types
