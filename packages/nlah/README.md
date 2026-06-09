# @factory/nlah

Factory-facing wrapper around the `@wescome/nlah` harness runtime.

## Purpose

The Factory consumes NLAH (Natural-Language Agent Harness) as the execution
engine for Executable Specifications. This workspace package is a thin
re-export shim that:

1. Pins the NLAH dependency in one place (`file:/Users/wes/nlah` during
   bootstrap; a published version later).
2. Exposes ONLY the symbols the Factory needs — explicit named re-exports,
   never `export *` — so the deferred DAG surface in NLAH's `graph.ts` and
   other internal modules stay out of Factory code.

Factory packages import from `@factory/nlah`; they never depend on
`@wescome/nlah` directly. That keeps the upstream coupling auditable in a
single file.

## Re-exported surface

Types: `HarnessSpec`, `StageSpec`, `ArtifactSpec`, `GateSpec`,
`ArtifactManager`, `ArtifactStorageHandle`, `CompiledHarness`, `HarnessSource`,
`HarnessState`, `HarnessAdvance`, `StageResult`, `GateResult`,
`HarnessRunResult`, `WorkerAdapter`, `WorkerInput`, `WorkerOutput`,
`FileReader`.

Values: `FsArtifactManager`, `loadHarness`, `compileHarness`, `initHarness`,
`advanceHarness`, `runHarness`, `WorkerRegistry`, `registerGate`,
`gateRegistry`, `buildStageContext`.

## Notes

- `GateResult` upstream has two definitions (a pure runtime record in
  `runtime.ts` and a richer registry record in `gates.ts`). The runtime one
  is the Factory's contract because it travels inside `StageResult`.
- Anything not in the list above must be added here explicitly. Reach into
  `@wescome/nlah` directly only from this package.
