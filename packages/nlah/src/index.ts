// @factory/nlah — Factory-facing wrapper around @wescome/nlah.
//
// This module exposes ONLY the symbols the Factory consumes from the NLAH
// runtime. It deliberately uses explicit named re-exports (never `export *`)
// to keep the deferred DAG surface in `graph.ts` and other internal modules
// out of the Factory's API.
//
// NOTE: `GateResult` is defined in two places upstream:
//   - `runtime.ts`  → pure state-machine API used inside `StageResult`
//   - `gates.ts`    → richer evaluation record used by the gate registry
// The Factory's contract is the pure runtime API, so `GateResult` is taken
// from the upstream barrel and aliased to the runtime shape via the type
// re-export below. Consumers needing the gate-registry shape should import
// it directly from `@wescome/nlah/gates` (not re-exported here).

export type {
  // schema.ts
  HarnessSpec,
  StageSpec,
  ArtifactSpec,
  GateSpec,
  // artifacts.ts
  ArtifactManager,
  ArtifactStorageHandle,
  // compiler.ts
  CompiledHarness,
  HarnessSource,
  // runtime.ts
  HarnessState,
  HarnessAdvance,
  StageResult,
  GateResult,
  HarnessRunResult,
  // workers.ts
  WorkerAdapter,
  WorkerInput,
  WorkerOutput,
  // context.ts
  FileReader,
  // gates.ts
  GateFn,
  GateEvalRecord,
} from "@wescome/nlah";

export {
  // artifacts.ts
  FsArtifactManager,
  // compiler.ts
  loadHarness,
  compileHarness,
  // runtime.ts
  initHarness,
  advanceHarness,
  runHarness,
  // worker_registry.ts
  WorkerRegistry,
  // gates.ts
  registerGate,
  gateRegistry,
  normalizeGateContract,
  // context.ts
  buildStageContext,
} from "@wescome/nlah";
