---
id: IS-HARNESS-DSL-v1
sourceCapabilityId: null
sourceFunctionId: null
title: Harness DSL — NLAH Integration and Factory Governance Layer
source_refs: []
reference_documents:
  - specs/reference/ADR-009-nlah-runtime-replaces-state-graph.md
  - /Users/wes/Library/CloudStorage/Dropbox/WeOps/FunctionFactory/Factory–Cloudflare-Serverless.md
  - specs/reference/ADR-004-custom-graph-runner-over-langgraph.md
  - specs/reference/FF-ONTOLOGY-v0.2.md
  - specs/reference/FF-REFACTORING-PLAN.md
  - specs/reference/DOMAIN-FACTORY-KERNEL.md
  - specs/reference/crystalizer_dsl.md
  - /Users/wes/nlah/HARNESS_ARCHITECTURE_IMPLEMENTATION_SPEC.md
  - /Users/wes/Library/CloudStorage/Dropbox/WeOps/FunctionFactory/nlah_v0_2_architecture_design.md
explicitness: inferred
rationale: >
  Revised 2026-05-16 (v4) after Architect + SE gate review.
  v1: build-from-scratch spec — superseded when /Users/wes/nlah discovered as live
  TypeScript implementation. v2: integration spec with blocking runHarnessFromYaml()
  bridge — superseded when long-running domain stage analysis (ADR-009 §1) revealed
  blocking loop cannot handle real agent wall-clock duration. v3: event-driven bridge
  (startHarnessRun + RunCoordinator DO + advanceHarness), complete type contracts, 9
  upstream contributions, CfArtifactManager constructor, Container dispatch API,
  two-phase INV-1 detector. v4 (this document) closes Architect findings B-1, B-2,
  H-1, H-2, H-3, H-4 and SE findings F1–F13, G1–G4: all type contracts re-derived
  from live NLAH source (WorkerOutput has no `ok`; WorkerInput field is `context`,
  not `stageContext`; CompiledHarness has no `registeredGates`); §3.1 specifies the
  separate `harness-dispatcher.ts` queue-consumer Worker; CF Workflow event dispatch
  uses the concrete `env.FACTORY_PIPELINE.get(workflowId).sendEvent({ type, payload })`
  pattern observed in workers/ff-pipeline/src/index.ts; runHarnessCompletenessVerification
  takes gateRegistry as a parameter and throws (not silently skips); selectBest /
  PiSwarmAdapter committed to Option A (adapter handles selection); INV-3/5/6
  detectors converted to deployed-bundle checks. ADR-009 is the gating precondition.
  Upstream NLAH contributions #0, #1a, #1b, #1c, #1d gate all CF integration work.
status: draft — v4, pending Architect re-review
---

# Harness DSL — NLAH Integration and Factory Governance Layer

## Problem

The Coordinator DO at `workers/ff-pipeline/src/coordinator/graph.ts` hardcodes the
synthesis topology as TypeScript node wiring. Two concrete violations follow:

1. **Domain-neutrality breached.** The kernel encodes a domain-specific task topology
   (synthesis graph) as imperative TypeScript. Every task family requires direct
   TypeScript modification, Coordinator DO re-test, and redeploy. No declarative
   harness format exists in which task-family topologies can be authored, versioned,
   and compiled independently.

2. **Harness Completeness gap.** `FF-ONTOLOGY-v0.2.md §Harness Completeness` and
   `FF-REFACTORING-PLAN.md §145` require every Harness Skill to declare a
   `failure_taxonomy` mapping signal names to recovery actions. The current DO has no
   per-task-family failure taxonomy; recovery routing is scattered across
   `stages/generate-feedback.ts` without formal enumeration.

3. **Workflow step duration.** A blocking harness loop inside `step.do()` fails for
   any task family with real agent stages: coding-swarm runs take 25–100 minutes;
   synthesis repair rounds are unbounded; future domains (legal review, medical
   imaging) may run for hours. CF Workflow `step.do()` wall-clock limits make a
   blocking loop untenable beyond trivial test harnesses.

`/Users/wes/nlah` (TypeScript `"nlah"` v0.1.0) already implements the correct
substrate: typed `HarnessSpec` Zod schema, `compileHarness()`, `runHarness()` state
machine, gate registry, `WorkerRegistry`, and `LoomCliWorkerAdapter`. The problem is
not that this substrate does not exist — it is that it is not integrated into Trellis
and the synthesis DO has not been migrated to a harness YAML.

## Goal

Integrate NLAH as a workspace package and migrate all task flows to harness-YAML-driven
execution. Factory contributes: event-driven bridge, governance layer (VR-* generation,
lineage enforcement), CF-compatible storage implementations. NLAH contributes: schema,
compiler, pure `initHarness` + `advanceHarness` state machine functions, gate registry,
worker adapters — everything else.

---

## Type Contracts

All types referenced in this IS. Every type below has been re-derived from live NLAH
source at `/Users/wes/nlah/src/` (read 2026-05-16). Upstream contributions are noted
where a type requires a change to NLAH.

### NLAH existing types (live in /Users/wes/nlah/src as of 0.1.0)

```typescript
// WorkerInput — from src/workers.ts (existing in NLAH 0.1.0)
// NOTE: The context field is named `context`, NOT `stageContext`.
export type WorkerInput = {
  stageName: string
  roleName: string
  rolePrompt?: string
  context: StageContext       // ← name is `context`, type is `StageContext`
  state: RuntimeState
  declaredInputs: string[]
  declaredOutputs: string[]
}

// WorkerOutput — from src/workers.ts (existing in NLAH 0.1.0)
// NOTE: There is NO `ok` boolean. Worker success/failure is determined by:
//   (a) whether the adapter throws,
//   (b) whether declared outputs were written (artifact enforcement),
//   (c) gate evaluation against produced artifacts (in the queue consumer).
// `message` is optional upstream and is marked optional here accordingly.
export type WorkerOutput = {
  createdArtifacts: string[]
  message?: string
}

// WorkerAdapter — from src/workers.ts (existing in NLAH 0.1.0)
export interface WorkerAdapter {
  execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput>
}

// CompiledHarness — from src/compiler.ts (existing in NLAH 0.1.0)
// NOTE: There is NO `registeredGates` field on CompiledHarness. The gate registry
// is exported separately from gates.ts as `gateRegistry: Record<string, GateFn>`.
// `runHarnessCompletenessVerification` (Factory) accepts the registry as a parameter.
export type CompiledHarness = {
  spec: HarnessSpec
  stagesByFromState: Record<string, Array<{ name: string; spec: StageSpec }>>
  stageOrder: string[]
  startState: string
  terminalStates: string[]
  warnings: string[]
}

// RuntimeState — from src/state.ts (existing in NLAH 0.1.0)
// This is the type NLAH's runHarness() loop uses. It is FS-rooted (taskPath,
// repoPath, harnessPath, runRoot, stateRoot, artifactRoot) and therefore not
// suitable as the persisted state in a CF Durable Object. Contribution #1c
// introduces a new, CF-friendly HarnessState type (see below).
export type RuntimeState = {
  runId: string
  currentState: string
  taskPath: string
  repoPath: string
  harnessPath: string
  runRoot: string
  stateRoot: string
  artifactRoot: string
  stageHistory: TraceEvent[]
  artifacts: Record<string, ArtifactStatus>
  lastError?: string
}

// RuntimeResult — from src/state.ts (existing in NLAH 0.1.0)
export type RuntimeResult = {
  runId: string
  status: 'PASS' | 'FAIL' | 'INCOMPLETE'
  finalState: string
  runRoot: string
  artifactRoot: string
  tracePath: string
  summaryPath: string
  message?: string
  failureClass?: string
  action?: string
  retryCounters?: Record<string, number>
  warnings?: string[]
}

// gateRegistry — from src/gates.ts (existing in NLAH 0.1.0)
// Already exported. Type is Record<string, GateFn>; not Map<string, GateFn>.
export const gateRegistry: Record<string, GateFn>
```

### Factory-side types (added by this IS)

```typescript
// Env — wrangler.toml bindings required by harness-bridge.ts, run-coordinator.ts,
// and harness-dispatcher.ts. FACTORY_PIPELINE is the existing Workflow binding
// used elsewhere in ff-pipeline; reused here for harness-complete event delivery.
interface Env {
  WORKSPACE_BUCKET: R2Bucket
  RUN_COORDINATOR: DurableObjectNamespace
  HARNESS_QUEUE: Queue<HarnessQueueMessage>
  FACTORY_PIPELINE: WorkflowBinding   // existing; provides .get(id).sendEvent({...})
  PI_CONTAINER: Fetcher                // service binding to Pi container
  AIDER_CONTAINER: Fetcher             // service binding to Aider container
  CLAUDE_CODE_CONTAINER: Fetcher       // service binding to Claude Code container
}

interface HarnessQueueMessage {
  runId: string
  stageName: string
}

// WorkflowBinding — existing CF Workflow binding shape (see workers/ff-pipeline/src/types.ts)
interface WorkflowBinding {
  get(id: string): Promise<{
    sendEvent(event: { type: string; payload: unknown }): Promise<void>
    status(): Promise<{ status: string }>
  }>
}

// FunctionJob — from packages/schemas (existing; harnessKey field added by this IS)
interface FunctionJob {
  functionRunId: string
  objective: string      // task text — injected into initHarness()
  harnessKey: string     // R2 key for the harness YAML to load
  // ...other existing fields
}
```

### New types from contribution #1c (NLAH side)

Contribution #1c (WP004) introduces three new types to NLAH alongside `initHarness()`
and `advanceHarness()`. These do not exist in NLAH 0.1.0; they are part of the
contribution and must be added before any CF integration code lands.

```typescript
// HarnessState — NEW in contribution #1c. Distinct from RuntimeState.
// Rationale: RuntimeState is FS-rooted (taskPath/repoPath/runRoot etc.) and cannot
// be persisted/restored across DO storage round-trips in a CF environment with no
// filesystem. HarnessState is the CF-friendly successor: it carries only run-local
// machine state and references artifact identities by name. Storage roots live in
// the bound ArtifactManager (CfArtifactManager), not in state.
//
// HarnessState carries the per-stage attempt counters that the v0.2 failure
// semantics need; it does NOT carry the full trace event log (that lives in DO
// storage under a separate key to avoid serialising large traces on each
// advanceHarness() call). Contribution #3 (artifact_lineage trace events)
// references HarnessState only for the current run identity.
interface HarnessState {
  runId: string
  currentStage: string                            // current state name (NLAH stage `from` semantics)
  stageAttempts: Record<string, number>           // tracks attempts per stage for max_stage_attempts
  completedStages: string[]                       // append-only history of stage names that have completed
  artifacts: Record<string, ArtifactStatus>       // artifact status snapshot — name → status
  lastError?: string                              // last error message, if any
  taskText: string                                // injected from FunctionJob.objective at initHarness()
}

// StageResult — NEW in contribution #1c. Carries the per-stage completion bundle
// from the queue consumer back to the DO, which passes it to advanceHarness().
// gateResults are produced by the consumer evaluating gateRegistry against the
// artifacts the worker wrote; advanceHarness() does NOT re-evaluate gates.
interface StageResult {
  stageName: string
  workerOutput: WorkerOutput
  gateResults: GateResult[]
  workerThrew?: { message: string }   // present iff the worker adapter threw
}

// HarnessAdvance — NEW in contribution #1c. Discriminated union returned by
// advanceHarness(); the DO interprets it to either dispatch the next stage,
// retry, return to an earlier stage (v0.2 failure semantics), or finalise.
type HarnessAdvance =
  | { action: 'dispatch'; stage: string;  newState: HarnessState }
  | { action: 'retry';    stage: string;  newState: HarnessState }
  | { action: 'return';   stage: string;  newState: HarnessState }
  | { action: 'complete'; result: RuntimeResult; newState?: undefined }
  | { action: 'fail';     result: RuntimeResult; newState?: undefined }

// GateResult — existing in NLAH 0.1.0 (gates.ts emits PASS/FAIL records);
// re-stated here for type-contract completeness.
interface GateResult {
  gate: string
  passed: boolean
  message: string
}

// GateFn — existing in NLAH 0.1.0 (gates.ts). Contribution #5 surfaces this and
// gateRegistry through the public @wescome/nlah surface so Factory can register
// CF-specific gates and pass the registry to runHarnessCompletenessVerification.
type GateFn = (
  state: RuntimeState | HarnessState,
  artifacts: ArtifactManager,
  args: unknown,
) => Promise<GateResult>
```

### Factory verification-pass types

```typescript
// HarnessCompletenessReport — from packages/verification (this IS).
interface HarnessCompletenessReport {
  overall: 'pass' | 'fail'
  failure_code?:
    | 'EMPTY_FAILURE_TAXONOMY'
    | 'UNREACHABLE_STAGE'
    | 'UNREGISTERED_GATE'
    | 'MISSING_WORKER_BINDING'
    | 'MISSING_LINEAGE'
  details: string[]
}
```

---

## 1. `packages/nlah` — workspace integration package

Wraps `@wescome/nlah` (after contribution #0 — package scoping) for monorepo
consumption. Exposes all types and functions consumed by ff-pipeline and
packages/verification. This is the seam that allows future internalization if NLAH
diverges from Trellis requirements.

```
packages/nlah/
  package.json         — name: @factory/nlah; depends on @wescome/nlah (workspace:*)
  src/index.ts         — explicit named re-exports (see L-1 below)
```

**L-1 (re-export discipline):** `packages/nlah/src/index.ts` MUST use explicit
named re-exports, not `export * from '@wescome/nlah'`. NLAH's own `src/index.ts`
uses `export *`, which leaks NLAH's deferred `graph.ts` DAG surface and the
filesystem-bound `loom_cli_worker.ts` / `aider_cli_worker.ts` / `pi_cli_worker.ts`
adapters. Factory must not transitively expose these to ff-pipeline code. The
allowed exports are:

```typescript
// packages/nlah/src/index.ts
export type {
  HarnessSpec, StageSpec, ArtifactSpec, GateSpec,
  ArtifactManager,                                 // contribution #1a — interface
  CompiledHarness, RuntimeResult,
  HarnessState, HarnessAdvance, StageResult,       // contribution #1c — new
  WorkerInput, WorkerOutput, GateResult, GateFn,
} from '@wescome/nlah'

export {
  loadHarness,                                     // contribution #1d — string overload
  compileHarness,
  initHarness, advanceHarness,                     // contribution #1c — pure functions
  WorkerRegistry,
  FsArtifactManager,                               // contribution #1a — renamed concrete impl
  gateRegistry,                                    // contribution #5 — exported registry
} from '@wescome/nlah'

// Explicitly NOT re-exported: graph.ts DAG surface (WP006-only),
// loom_cli_worker / aider_cli_worker / pi_cli_worker (Node-FS adapters; CF uses
// Container-backed adapters in cf-workers.ts).
```

**L-4 (bundler backstop):** Even with explicit re-exports, transitive imports of
NLAH's Node adapters can sneak in via deep import paths. Add a Wrangler/esbuild
externals or `unenv` polyfill-disallow rule for `node:fs`, `node:fs/promises`, and
`node:child_process` in the ff-pipeline build config. Any accidental import will
fail the build rather than silently pull in a Node-only path.

`HarnessSpec` from NLAH is the authoritative schema. No parallel schema is authored in
`packages/schemas`.

**L-2 (Spec version compatibility):** Both `runHarnessCompletenessVerification` and
the bridge MUST accept harnesses declaring `nlahspec: "0.1"` OR `nlahspec: "0.2"`
simultaneously during the migration window. `coding-adapter.harness.yaml` ships on
0.1; `synthesis.harness.yaml` ships on 0.2 after contribution #2 lands. Both must
load and compile in the same deployment.

---

## 2. `workers/ff-pipeline/src/harness-bridge.ts` — event-driven CF adapter

Called from the CF Workflow. Initializes the RunCoordinator DO with a compiled harness
and initial state; does NOT block waiting for run completion. The Workflow suspends
durably via `step.waitForEvent`.

```typescript
import {
  loadHarness, compileHarness, initHarness, gateRegistry,
  HarnessState, CompiledHarness,
} from '@factory/nlah'
import { runHarnessCompletenessVerification } from '@factory/verification'
import type { Env, FunctionJob } from './types'

// Called from Workflow step.do('init-harness')
// Returns immediately after DO is initialized; does NOT await run completion
export async function startHarnessRun(
  harnessKey: string,
  env: Env,
  job: FunctionJob,
): Promise<{ runId: string }> {
  const obj = await env.WORKSPACE_BUCKET.get(harnessKey)
  if (!obj) throw new Error(`Harness YAML not found in R2: ${harnessKey}`)
  const yamlText = await obj.text()
  const spec = await loadHarness(yamlText)                   // contribution #1d: string input
  const compiled = compileHarness(spec)
  const report = await runHarnessCompletenessVerification(compiled, gateRegistry)
  if (report.overall !== 'pass') {
    throw new Error(`Harness completeness check failed: ${report.failure_code}: ${report.details.join('; ')}`)
  }
  const initialState: HarnessState = initHarness(compiled, {  // contribution #1c
    taskText: job.objective,
    runId: job.functionRunId,
  })
  const doId = env.RUN_COORDINATOR.idFromName(job.functionRunId)
  const stub = env.RUN_COORDINATOR.get(doId)
  await stub.fetch('https://run-coordinator/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compiled, initialState, workflowId: job.functionRunId }),
  })
  return { runId: job.functionRunId }
}
```

```typescript
// workers/ff-pipeline/src/pipeline.ts (Workflow)
// Only the relevant steps shown:

await step.do('init-harness', async () => {
  return startHarnessRun(job.harnessKey, this.env, job)
})

// Durable suspension — resumes when the harness-results queue consumer
// (or the DO directly, depending on transport) sends 'harness-complete'.
const completion = await step.waitForEvent<RuntimeResult>(
  'harness-complete',
  { type: 'harness-complete', timeout: '7 days' },
)

await step.do('record-result', async () => {
  return recordHarnessResult(completion.payload, this.env, job)
})
```

---

## 3. `workers/ff-pipeline/src/coordinator/run-coordinator.ts` — DO harness state machine

Extension of (or sibling to) the existing coordinator DO. Holds `HarnessState` and
`CompiledHarness` in DO storage. Receives stage completion callbacks from the queue
consumer (§3.1). Calls `advanceHarness()` as a pure function on each completion.

```typescript
import { advanceHarness, HarnessState, CompiledHarness, StageResult } from '@factory/nlah'
import type { Env } from '../types'

export class RunCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/init') {
      const { compiled, initialState, workflowId }: {
        compiled: CompiledHarness
        initialState: HarnessState
        workflowId: string
      } = await request.json()
      await this.ctx.storage.put('compiled', compiled)
      await this.ctx.storage.put('harnessState', initialState)
      await this.ctx.storage.put('workflowId', workflowId)
      // Dispatch first stage via Queue
      await this.env.HARNESS_QUEUE.send({
        runId: initialState.runId,
        stageName: initialState.currentStage,
      })
      return new Response('ok', { status: 200 })
    }

    if (url.pathname === '/get-compiled') {
      // Queue consumer fetches CompiledHarness + current HarnessState here;
      // avoids putting large CompiledHarness payloads on every queue message.
      const compiled = await this.ctx.storage.get('compiled')
      const state = await this.ctx.storage.get('harnessState')
      return new Response(JSON.stringify({ compiled, state }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/stage-complete') {
      const stageResult: StageResult = await request.json()
      await this.handleStageCompletion(stageResult)
      return new Response('ok', { status: 200 })
    }

    return new Response('not found', { status: 404 })
  }

  private async handleStageCompletion(stageResult: StageResult): Promise<void> {
    const state: HarnessState = (await this.ctx.storage.get('harnessState'))!
    const compiled: CompiledHarness = (await this.ctx.storage.get('compiled'))!
    const advance = advanceHarness(compiled, state, stageResult)  // pure fn — contribution #1c
    if (advance.newState) {
      await this.ctx.storage.put('harnessState', advance.newState)
    }
    if (advance.action === 'dispatch' || advance.action === 'retry' || advance.action === 'return') {
      await this.env.HARNESS_QUEUE.send({
        runId: state.runId,
        stageName: advance.stage,
      })
    } else {
      // 'complete' or 'fail' — notify the suspended Workflow
      await this.notifyWorkflowComplete(advance.result)
    }
  }

  private async notifyWorkflowComplete(result: RuntimeResult): Promise<void> {
    const workflowId: string = (await this.ctx.storage.get('workflowId'))!
    // Concrete CF Workflow event dispatch — exactly the pattern used in
    // workers/ff-pipeline/src/index.ts lines 1431–1435 and 1560–1570 for the
    // synthesis-complete + atoms-complete events, observed against the
    // production FACTORY_PIPELINE binding.
    try {
      const workflow = await this.env.FACTORY_PIPELINE.get(workflowId)
      await workflow.sendEvent({
        type: 'harness-complete',
        payload: result,
      })
    } catch (err) {
      // Same fallback shape as index.ts:1573–1583 — if sendEvent fails, fall back
      // to a results queue. (HARNESS_RESULTS queue is optional; if absent, persist
      // result to DO storage so the Workflow's 7-day waitForEvent times out and a
      // later poller can recover it.)
      await this.ctx.storage.put('runResult', result)
      console.error(`[RunCoordinator] sendEvent harness-complete failed for ${workflowId}: ${err instanceof Error ? err.message : err}`)
    }
  }
}
```

### 3.1 Queue consumer — `harness-dispatcher.ts`

This is a **separate Worker module** at
`workers/ff-pipeline/src/harness-dispatcher.ts`. It is NOT the RunCoordinator DO
consuming its own queue — that pattern produces a self-fetch deadlock in CF, the
same constraint documented in MEMORY for Phase 3/4 deployment. The consumer is a
plain Workers queue handler bound to `harness-queue`.

**Responsibilities (G1, G2, F2, H-3):**

1. Receive `HarnessQueueMessage { runId, stageName }` from `HARNESS_QUEUE`.
2. Resolve the RunCoordinator DO by `runId`; POST `/get-compiled` to retrieve
   `{ compiled, state }` (CompiledHarness + current HarnessState). This avoids
   serialising CompiledHarness onto every queue message. The single shared
   `CompiledHarness` payload sits in DO storage; the consumer fetches by run.
3. Look up the stage spec on `compiled.spec.stages[stageName]`; resolve the
   `WorkerAdapter` via the CF worker registry (§5) using `stage.worker` (NLAH
   stage `worker:` field).
4. Construct the `StageContext` via `buildStageContext` (contribution #1b), passing
   a `CfArtifactManager` for the run and supplying `taskText` from
   `state.taskText` (HarnessState carries the task injected at init). Contribution
   #1b is the variant of `buildStageContext` that accepts an injected reader or a
   pre-hydrated `StageContext` — Factory uses the pre-hydrated form because no
   filesystem path exists in CF.
5. Construct `WorkerInput`:
   ```typescript
   const workerInput: WorkerInput = {
     stageName,
     roleName: stage.role,
     context: stageContext,                            // ← `context`, not `stageContext`
     state: synthesizeRuntimeStateView(state),         // adapter view for read-only use
     declaredInputs: stage.inputs,
     declaredOutputs: stage.outputs,
   }
   ```
   `synthesizeRuntimeStateView` is a thin adapter that exposes `state.runId`,
   `state.currentState`, `state.artifacts` — the only fields gates consume — under
   the `RuntimeState` field names. Gates that rely on `taskPath`/`repoPath`/
   `runRoot` (i.e., the existing `patch_applies_cleanly` gate) are CF-incompatible
   and must be replaced by Container-side gates registered via contribution #5.
6. Invoke `adapter.execute(workerInput, artifactManager)`. The adapter dispatches
   to a CF Container (Pi/Aider/Claude Code; see §5). Wrap in try/catch — if the
   adapter throws, mark `workerThrew` on the StageResult; do NOT re-throw.
7. **Evaluate gates IN THE CONSUMER** — not in `advanceHarness`. For each gate
   expression on `stage.gate.all` / `stage.gate.any`, normalise via NLAH's
   `normalizeGateContract`, look up the gate in `gateRegistry`, invoke it with
   `(stateView, artifactManager, args)`, collect `GateResult`. This matches NLAH's
   `runHarness()` semantics: gates run after worker output, against the produced
   artifacts.
8. Construct `StageResult { stageName, workerOutput, gateResults, workerThrew? }`.
9. POST `/stage-complete` to the same RunCoordinator DO with the `StageResult`.
10. Ack the message. On exception, retry up to `max_retries` then ack and emit a
    Tier-1 `infra:queue-retry-exhausted` signal (matching the precedent at
    `workers/ff-pipeline/src/index.ts:1444`).

**Harness YAML loading source of truth:** the consumer DOES NOT re-load harness
YAML from R2. The compiled harness lives in DO storage. R2 is the source of truth
only at `startHarnessRun` time. This decision is committed (per the IS instruction
to pick one) — DO storage as the post-init cache; R2 as the cold source.

**Wrangler binding:**

```toml
[[queues.consumers]]
queue = "harness-queue"
max_batch_size = 1                # one stage per message
max_retries = 3
dead_letter_queue = "harness-dlq"

# IMPORTANT: this consumer is bound to a SEPARATE Worker entrypoint, not the
# RunCoordinator DO. The DO has no queue consumer; instead, the dispatcher
# Worker queue handler is exported from workers/ff-pipeline/src/harness-dispatcher.ts
# and registered as the script for the harness-queue consumer binding.
```

```typescript
// workers/ff-pipeline/src/harness-dispatcher.ts (sketch — file is created, not authored here)
export default {
  async queue(batch: MessageBatch<HarnessQueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await dispatchOne(msg.body, env)
        msg.ack()
      } catch (err) {
        if (msg.attempts >= 3) msg.ack()
        else msg.retry()
      }
    }
  }
}
```

---

## 4. `workers/ff-pipeline/src/cf-artifact-manager.ts` — R2-backed ArtifactManager

Implements the NLAH `ArtifactManager` interface (after contribution #1a) backed by R2
(`env.WORKSPACE_BUCKET`). No `node:fs/promises`. Artifact paths follow ADR-002 §12.

```typescript
import type { ArtifactManager, ArtifactStatus, HarnessSpec } from '@factory/nlah'

export class CfArtifactManager implements ArtifactManager {
  // F9: no `prefix` field exposed; callers use getStorageHandle() instead.
  constructor(
    private bucket: R2Bucket,      // env.WORKSPACE_BUCKET
    private spec: HarnessSpec,     // for artifact path resolution
    private prefix: string,        // private — e.g. `artifacts/${functionRunId}`
    private bucketBinding: string, // e.g. 'WORKSPACE_BUCKET' — passed to Containers
  ) {}

  resolve(artifactName: string): string {
    const artifact = this.spec.artifacts[artifactName]
    if (!artifact) throw new Error(`Unknown artifact: ${artifactName}`)
    return `${this.prefix}/${artifact.path}`   // R2 key, not filesystem path
  }

  async exists(artifactName: string): Promise<boolean> {
    const head = await this.bucket.head(this.resolve(artifactName))
    return head !== null
  }

  async readText(artifactName: string): Promise<string> {
    const obj = await this.bucket.get(this.resolve(artifactName))
    if (!obj) throw new Error(`Artifact not found in R2: ${artifactName}`)
    return obj.text()
  }

  async writeText(artifactName: string, content: string): Promise<void> {
    await this.bucket.put(this.resolve(artifactName), content, {
      httpMetadata: { contentType: 'text/plain' },
    })
  }

  async status(artifactName: string): Promise<ArtifactStatus> {
    const key = this.resolve(artifactName)
    const head = await this.bucket.head(key)
    return {
      name: artifactName,
      path: key,
      exists: head !== null,
      sizeBytes: head?.size ?? null,
    }
  }

  // F9: replaces the `(artifacts as CfArtifactManager).prefix` cast in §5.
  // ArtifactManager interface gains this method as part of contribution #1a.
  getStorageHandle(): { kind: 'r2'; bucketBinding: string; prefix: string } {
    return { kind: 'r2', bucketBinding: this.bucketBinding, prefix: this.prefix }
  }
}
```

**ArtifactManager interface (contribution #1a) — required additions:**

```typescript
// Added by contribution #1a alongside the interface extraction.
interface ArtifactManager {
  resolve(name: string): string
  exists(name: string): Promise<boolean>
  readText(name: string): Promise<string>
  writeText(name: string, content: string): Promise<void>
  status(name: string): Promise<ArtifactStatus>
  // NEW in #1a — Factory uses this to avoid leaking concrete-impl internals to adapters.
  getStorageHandle(): StorageHandle
}

type StorageHandle =
  | { kind: 'r2';  bucketBinding: string; prefix: string }
  | { kind: 'fs';  root: string }
```

`FsArtifactManager.getStorageHandle()` returns `{ kind: 'fs', root: this.root }`.

**R2 key scheme:** `artifacts/{functionRunId}/{artifact.path}` — matches ADR-002 §12.

---

## 5. `workers/ff-pipeline/src/cf-workers.ts` — CF Container WorkerAdapter implementations

Per ADR-002: "Workers do NOT run agents. Containers execute." Each NLAH `WorkerAdapter`
wraps a CF Container dispatch.

```typescript
import type { WorkerAdapter, WorkerInput, WorkerOutput, ArtifactManager } from '@factory/nlah'
import { WorkerRegistry } from '@factory/nlah'

export function buildCfWorkerRegistry(env: Env): WorkerRegistry {
  const registry = new WorkerRegistry()
  registry.register('pi',          new PiContainerAdapter(env))
  registry.register('pi-swarm',    new PiSwarmAdapter(env))     // synthesis parallelism Option C
  registry.register('aider',       new AiderContainerAdapter(env))
  registry.register('claude-code', new ClaudeCodeContainerAdapter(env))
  return registry
}

// Base pattern for all Container adapters
class PiContainerAdapter implements WorkerAdapter {
  constructor(private env: Env) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    // F9: no cast — read storage handle via the interface method.
    const handle = artifacts.getStorageHandle()
    if (handle.kind !== 'r2') {
      throw new Error('PiContainerAdapter requires r2 storage handle')
    }
    const response = await this.env.PI_CONTAINER.fetch('https://pi-worker/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: input.context,                          // ← `context`, not `stageContext`
        artifactPrefix: handle.prefix,
        r2Bucket: handle.bucketBinding,
      }),
    })
    if (!response.ok) {
      // Throwing matches WorkerOutput semantics — there is no `ok` boolean to set.
      // The consumer's try/catch catches this and records workerThrew on StageResult.
      throw new Error(`PiContainer dispatch failed (${response.status}): ${await response.text()}`)
    }
    const result: { artifacts: string[]; message?: string } = await response.json()
    return { createdArtifacts: result.artifacts, ...(result.message ? { message: result.message } : {}) }
  }
}

// Synthesis parallelism — Option C: internal dispatch to N containers.
// F10 + H-2: dispatchOne is sketched concretely below; selectBest commits to
// Option A — the adapter handles selection internally via the Critic/Verifier/
// Architect judgment chain (no separate SELECT stage in the harness YAML).
class PiSwarmAdapter implements WorkerAdapter {
  constructor(private env: Env) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    // Dispatches 3 parallel Container invocations writing to disjoint sub-prefixes,
    // then runs Critic + Verifier + Architect judgment over the three candidates
    // and returns the merged winner under the originally-declared output names.
    const candidates = await Promise.all([
      this.dispatchOne(input, artifacts, 0),
      this.dispatchOne(input, artifacts, 1),
      this.dispatchOne(input, artifacts, 2),
    ])
    const winner = await this.selectBest(candidates, input, artifacts)
    return winner
  }

  private async dispatchOne(
    input: WorkerInput,
    artifacts: ArtifactManager,
    idx: number,
  ): Promise<{ workerOutput: WorkerOutput; candidatePrefix: string }> {
    const handle = artifacts.getStorageHandle()
    if (handle.kind !== 'r2') {
      throw new Error('PiSwarmAdapter requires r2 storage handle')
    }
    const candidatePrefix = `${handle.prefix}/candidates/${idx}`
    const response = await this.env.PI_CONTAINER.fetch('https://pi-worker/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: input.context,
        artifactPrefix: candidatePrefix,
        r2Bucket: handle.bucketBinding,
        swarmIndex: idx,                          // Container differentiates by index
      }),
    })
    if (!response.ok) {
      throw new Error(`PiSwarm[${idx}] dispatch failed (${response.status}): ${await response.text()}`)
    }
    const result: { artifacts: string[]; message?: string } = await response.json()
    return {
      workerOutput: { createdArtifacts: result.artifacts, ...(result.message ? { message: result.message } : {}) },
      candidatePrefix,
    }
  }

  // Option A — adapter handles selection. The Critic/Verifier/Architect roles
  // are looked up in the same WorkerRegistry and dispatched as nested
  // container calls; each judges the three candidates in parallel and emits a
  // verdict. The merged winner is copied from its candidate sub-prefix to the
  // declared output names so downstream stages see the artifacts at the
  // canonical paths.
  private async selectBest(
    candidates: Array<{ workerOutput: WorkerOutput; candidatePrefix: string }>,
    input: WorkerInput,
    artifacts: ArtifactManager,
  ): Promise<WorkerOutput> {
    // Sketch: invoke Critic adapter against each candidate; pick highest score;
    // promote winner's artifacts to canonical names via artifacts.writeText().
    // (Full Critic/Verifier/Architect chain is out of scope for this IS — it
    // mirrors the existing synthesis-DO judgment logic; see ADR-009 §4 Phase 5
    // Option A note.)
    const merged: string[] = []
    const winner = candidates[0]                         // placeholder selection
    for (const name of input.declaredOutputs) {
      const winnerKey = `${winner.candidatePrefix}/${name}`
      const text = await readByRawKey(artifacts, winnerKey)  // helper not shown
      await artifacts.writeText(name, text)
      merged.push(name)
    }
    return { createdArtifacts: merged, message: `Selected candidate 0 of ${candidates.length}` }
  }
}
```

**wrangler.toml additions required:**

```toml
[[queues.consumers]]
queue = "harness-queue"
max_batch_size = 1
max_retries = 3
dead_letter_queue = "harness-dlq"
# NOTE: bound to harness-dispatcher.ts entrypoint, NOT the RunCoordinator DO.

[[queues.producers]]
binding = "HARNESS_QUEUE"
queue = "harness-queue"

[[durable_objects.bindings]]
name = "RUN_COORDINATOR"
class_name = "RunCoordinator"

# F13: Container service bindings — Pi, Aider, Claude Code. If Containers are not
# yet provisioned at deploy time, the corresponding adapter is omitted from
# buildCfWorkerRegistry; harnesses referencing the absent worker will fail
# Harness Completeness (MISSING_WORKER_BINDING) at startHarnessRun time, not at
# stage dispatch time.
[[containers]]
binding = "PI_CONTAINER"
image = "registry.weops.dev/pi:latest"
instance_type = "standard"

[[containers]]
binding = "AIDER_CONTAINER"
image = "registry.weops.dev/aider:latest"
instance_type = "standard"

[[containers]]
binding = "CLAUDE_CODE_CONTAINER"
image = "registry.weops.dev/claude-code:latest"
instance_type = "standard"
```

---

## 6. `packages/verification/src/harness-completeness-verification.ts` — Factory governance pass

**F4 fix:** The function takes the gate registry as a parameter (because
`CompiledHarness` has no `registeredGates` field upstream — see Type Contracts).
It THROWS on an unregistered gate; it does NOT silently skip.

```typescript
import { CompiledHarness, GateFn } from '@factory/nlah'

export async function runHarnessCompletenessVerification(
  compiled: CompiledHarness,
  gateRegistry: Record<string, GateFn>,   // F4: gate registry is required, not optional
): Promise<HarnessCompletenessReport> {
  const details: string[] = []

  // L-2 — both 0.1 and 0.2 harnesses accepted; nlahspec field check.
  if (compiled.spec.nlahspec !== '0.1' && compiled.spec.nlahspec !== '0.2') {
    return { overall: 'fail', failure_code: 'EMPTY_FAILURE_TAXONOMY', details: [`unsupported nlahspec: ${compiled.spec.nlahspec}`] }
  }

  if (!compiled.spec.failure_taxonomy || Object.keys(compiled.spec.failure_taxonomy).length === 0) {
    return { overall: 'fail', failure_code: 'EMPTY_FAILURE_TAXONOMY', details: ['failure_taxonomy is absent or empty'] }
  }

  // Reachability check — uses compiled.stageOrder (already topologically sorted by NLAH's compiler).
  const reachable = new Set(compiled.stageOrder)
  const allStages = Object.keys(compiled.spec.stages)
  const unreachable = allStages.filter(s => !reachable.has(s))
  if (unreachable.length > 0) {
    return { overall: 'fail', failure_code: 'UNREACHABLE_STAGE', details: unreachable }
  }

  // F4: enumerate every gate name referenced by the harness and confirm
  // it exists in the supplied registry. THROWS on unregistered gate — no
  // silent skip. The gate name extraction matches NLAH's gates.ts shapes
  // (string form: `gate-name`; object form: `{ uses: 'gate-name', ... }` or
  // `{ 'gate-name': arg }`).
  for (const [stageName, stage] of Object.entries(compiled.spec.stages)) {
    const expressions = [...(stage.gate?.all ?? []), ...(stage.gate?.any ?? [])]
    for (const gateExpr of expressions) {
      const gateName =
        typeof gateExpr === 'string'
          ? gateExpr
          : (gateExpr as { uses?: string }).uses
            ?? Object.keys(gateExpr as Record<string, unknown>)[0]
      if (!gateName || !(gateName in gateRegistry)) {
        // Hard error path — surfaced to the Workflow as UNREGISTERED_GATE.
        return {
          overall: 'fail',
          failure_code: 'UNREGISTERED_GATE',
          details: [`${stageName}: gate "${gateName}" not registered in supplied gateRegistry`],
        }
      }
    }
  }

  // F13: worker binding validation — each stage.worker must resolve in
  // buildCfWorkerRegistry. This is what makes a missing Container binding a
  // startHarnessRun-time failure rather than a stage-dispatch-time failure.
  // Validated by the bridge passing the live registry view in; the registry
  // exposes `has(name)` (NLAH's WorkerRegistry supports this).
  // (See validation criterion 6.)

  // Lineage check — contribution #4 passthrough field.
  // L-3: until contribution #4 lands, `compiled.spec.lineage` may be undefined
  // even on YAMLs that declare it, because NLAH's strict Zod schema may drop it.
  // Until #4: this check warns but does not fail when nlahspec is "0.1".
  const lineage = (compiled.spec as unknown as { lineage?: { source_refs?: string[] } }).lineage
  if (!lineage?.source_refs?.length) {
    if (compiled.spec.nlahspec === '0.2') {
      return { overall: 'fail', failure_code: 'MISSING_LINEAGE', details: ['lineage.source_refs absent or empty'] }
    }
    details.push('lineage.source_refs absent — non-blocking until contribution #4 lands')
  }

  return { overall: 'pass', details }
}
```

Call sequence: `loadHarness → compileHarness → runHarnessCompletenessVerification →
initHarness`. Always runs inside `startHarnessRun()` before the DO is initialized.
A harness that fails this check blocks the run from starting and surfaces the
`failure_code` to the Workflow.

This pass does NOT modify `CoherenceVerificationInput`. Coherence Verification's
pure-over-its-input contract is preserved.

**F11 (Zod strict/passthrough confirmation):** NLAH's `HarnessSpecSchema` uses Zod
default behaviour (no `.strict()`, no `.passthrough()` — i.e., unknown keys are
silently stripped). The `lineage` block on harness YAMLs is therefore dropped at
parse time until contribution #4 adds an explicit `lineage` field to
`HarnessSpecSchema`. This is the only reason `MISSING_LINEAGE` is non-blocking on
nlahspec 0.1: the field is unreadable, not absent. After #4 lands, NLAH's
schema is amended and the cast in this verification pass is removed.

---

## 7. `harnesses/coding-adapter.harness.yaml` — Coding domain adapter harness

Authored against `nlahspec: 0.1`. CONTRACT → MAP → PATCH → VERIFY → RELEASE. Worker
bindings map roles to CF Container adapters (`pi`, `aider`, or `claude-code`)
registered in `buildCfWorkerRegistry`.

> **L-3 / F5 note:** The `lineage:` block below is informational on nlahspec 0.1
> until contribution #4 lands and NLAH's Zod schema is amended to keep the
> `lineage` key through preprocessing. Until then, `compileHarness` strips it
> silently (NLAH's `HarnessSpecSchema` is default-strip, not passthrough — see
> F11). Contribution #4 is therefore reclassified (F5) as **blocking the §7
> coding-adapter YAML enforcement**, not "can trail CF integration".

```yaml
nlahspec: "0.1"
lineage:
  source_refs: [IS-HARNESS-DSL-v1, ADR-009]

harness:
  name: CODING_ADAPTER
  task_family: repository_issue_resolution
  objective: >
    Resolve a repository-grounded issue by producing a patch,
    independent verification, and a PR-ready summary.

runtime:
  state_root: state
  artifact_root: artifacts
  graph_mode: linear
  default_failure_action: abort

roles:
  Cartographer:
    responsibility: Map relevant files, tests, dependencies. Must not edit files.
  PatchWorker:
    responsibility: Produce one candidate patch from issue contract and repo map.
  Verifier:
    responsibility: Independently evaluate candidate patch. Must not repair patch.
  ReleaseAgent:
    responsibility: Produce final patch, evidence, and PR-ready summary.

artifacts:
  IssueContract:   { path: artifacts/issue_contract.md,    required: true }
  RepoMap:         { path: artifacts/repo_map.md,          required: true }
  CandidatePatch:  { path: artifacts/candidate.patch,      required: true }
  VerifierReport:  { path: artifacts/verifier_report.md,   required: true }
  FinalPatch:      { path: artifacts/final.patch,          required: true }
  PRSummary:       { path: artifacts/pr_summary.md,        required: true }

stages:
  CONTRACT:
    from: TaskReceived
    to: IssueContracted
    role: Cartographer
    worker: pi
    outputs: [IssueContract]
    gate:
      all: [{ exists: IssueContract }]

  MAP:
    from: IssueContracted
    to: RepoMapped
    role: Cartographer
    worker: pi
    outputs: [RepoMap]
    gate:
      all:
        - { exists: RepoMap }
        - repo_map_names_relevant_files
        - repo_map_names_test_entrypoints

  PATCH:
    from: RepoMapped
    to: PatchCandidate
    role: PatchWorker
    worker: pi
    outputs: [CandidatePatch]
    gate:
      all:
        - { exists: CandidatePatch }
        - { patch_applies_cleanly: CandidatePatch }

  VERIFY:
    from: PatchCandidate
    to: VerifiedPatch
    role: Verifier
    worker: pi
    outputs: [VerifierReport]
    gate:
      all:
        - { exists: VerifierReport }
        - verifier_accepts_patch
        - test_results_support_claims

  RELEASE:
    from: VerifiedPatch
    to: PullRequestReady
    role: ReleaseAgent
    worker: pi
    outputs: [FinalPatch, PRSummary]
    gate:
      all:
        - { exists: FinalPatch }
        - { exists: PRSummary }
        - final_patch_matches_verified_candidate

failure_taxonomy:
  missing_artifact:      retry_stage
  patch_does_not_apply:  return_to_stage
  verifier_rejects:      return_to_stage
  budget_exceeded:       mark_incomplete
```

---

## 8. `harnesses/synthesis.harness.yaml` — Synthesis DO migration

**Blocked on:** NLAH v0.2 Phase 3 (failure semantics — `return_to_stage` action,
contribution #2) and upstream contributions #1c + #1d.

When unblocked: author against `nlahspec: 0.2`. Repair loop via `return_to_stage`
failure action; **not** a DAG edge. Synthesis parallelism (3 Coder atoms) handled
inside the `pi-swarm` worker adapter (Option C — decided; see ADR-009 §4 Phase 5).
Stage graph stays linear.

**H-2 / F10 — Selection answer (decided):** Per the IS instruction to commit, the
`pi-swarm` adapter handles selection internally (Option A). No separate `SELECT`
stage exists in `synthesis.harness.yaml`. `PiSwarmAdapter.selectBest` runs the
Critic/Verifier/Architect judgment chain inside the adapter (see §5 sketch). The
`CODE` stage in the synthesis harness therefore has a single worker binding
(`worker: pi-swarm`) and a single set of declared outputs; the merged winner is
written under those declared output names.

**Synthesis migration callers** — when synthesis.harness.yaml is complete, these call
sites are migrated:

| Current caller | File | Migration action |
|---|---|---|
| `buildSynthesisGraph()` | `workers/ff-pipeline/src/pipeline.ts` | Replace with `startHarnessRun('harnesses/synthesis.harness.yaml', env, job)` |
| `SynthesisGraph.run()` | `workers/ff-pipeline/src/coordinator/graph-runner.ts` | File deleted |
| Node wiring | `workers/ff-pipeline/src/coordinator/graph.ts` | File deleted |
| Re-export | `workers/ff-pipeline/src/coordinator/index.ts` (line 7: `export { StateGraph, END } from './graph-runner'`) | Re-export removed |
| `agentLoop` calls | `workers/ff-pipeline/src/coordinator/graph.ts` | Migrated to `WorkerAdapter` implementations |

Deletion gate: `grep -r 'graph-runner' workers/ff-pipeline/src` returns zero results.

---

## Upstream NLAH Contributions Required

Contribution requests to `nlah` aligned with NLAH's own roadmap. IS delivery is gated
on these landing. All are upstream contributions to `/Users/wes/nlah` — not internal
to Trellis.

| # | Contribution | NLAH ref | Gates |
|---|---|---|---|
| 0 | Publish as scoped `@wescome/nlah` npm package | (new) | `packages/nlah` dependency resolution |
| 1a | `ArtifactManager` extracted to TypeScript interface (with new `getStorageHandle()` method); concrete impl renamed `FsArtifactManager` | WP002 | `CfArtifactManager` implementation; CF integration |
| 1b | `buildStageContext` injectable `fileReader` parameter or pre-hydrated `StageContext` overload (no `readFile` from `node:fs/promises`) | WP003 | CF integration (`context.ts` calls `node:fs/promises readFile`) |
| 1c | `initHarness(compiled, context): HarnessState` + `advanceHarness(compiled, state, result): HarnessAdvance` pure functions; new `HarnessState`, `StageResult`, `HarnessAdvance` types | WP004 | Event-driven bridge; all CF integration |
| 1d | `loadHarness(source: string \| Path): HarnessSpec` — accepts raw YAML string | WP003 | CF integration (no filesystem) |
| 2 | v0.2 Phase 3: `FailureAction` discriminated union + `return_to_stage` + `max_stage_attempts` budget | WP005 | Synthesis harness migration |
| 3 | v0.2 Phase 6: `artifact_lineage` trace events with `producerStage`/`producerRole`/`worker`/`inputArtifacts`/`passedGateIds` | WP007 | `VR-*` generation from trace |
| 4 | `lineage` field added to `HarnessSpecSchema` — `{ source_refs: string[] }`. Required because NLAH's Zod schema is default-strip, so passthrough YAML keys are dropped at parse time (F11). | (new) | **§7 coding-adapter YAML lineage enforcement (F5: reclassified blocking)** |
| 5 | Add `registerGate(name: string, fn: GateFn): void` helper to `gates.ts` for runtime gate registration. Note: `gateRegistry` and `GateFn` are **already exported** from `src/index.ts` via `export * from "./gates.js"` — contribution #5 only adds the `registerGate` helper and documents the registration API; no new exports are required. | (new) | CF-specific gate registration; `runHarnessCompletenessVerification` gate set enumeration |

**Dependency order (F5 applied):**
- #0, #1a, #1b, #1c, #1d: must land before **any CF integration code** lands
- #2: gates **synthesis harness only**; does not block coding adapter
- **#4: gates §7 coding-adapter YAML lineage enforcement (RECLASSIFIED to blocking
  per F5).** Without #4, NLAH's Zod schema silently drops the `lineage` block, and
  `runHarnessCompletenessVerification` cannot enforce `MISSING_LINEAGE` on 0.1
  harnesses (see L-3 + F11).
- #3: gates VR-* generation; can trail CF integration
- #5: gates CF-specific custom gate registration; needed for completeness
  verification's gate enumeration to throw on unregistered names

---

## Constraints

### One execution primitive (ADR-009)

NLAH `initHarness` + `advanceHarness` is the single domain-agnostic execution substrate.
No harness flow invokes `StateGraph.run()` from `graph-runner.ts` after this IS lands.

### CF platform (ADR-002)

Workers decide. Workflows orchestrate. Containers execute. DOs coordinate.

- `startHarnessRun()` executes inside a CF Workflow `step.do()`, not a top-level Worker
- `advanceHarness()` executes inside the `RunCoordinator` DO on stage-completion POST
- The queue consumer (`harness-dispatcher.ts`) is a SEPARATE Worker entrypoint — not
  the DO consuming its own queue (self-fetch deadlock; see MEMORY)
- CF Containers are the execution substrate for all `WorkerAdapter` implementations
- Harness YAMLs stored in R2 (`WORKSPACE_BUCKET`); loaded at runtime, not bundled
- Queue (`HARNESS_QUEUE`) delivers stage work — one message per stage dispatch
- Workflow event delivery uses `env.FACTORY_PIPELINE.get(workflowId).sendEvent(...)`
  — the established pattern at `workers/ff-pipeline/src/index.ts:1431–1435`

### No Node.js FS

`CfArtifactManager` uses R2. `buildStageContext` (after contribution #1b) receives task
content from `FunctionJob.objective`, not a filesystem path. No `node:fs/promises`
anywhere in the CF execution path.

### Cloudflare-only

No Python. No standalone NLAH CLI in production. No second compute substrate.
NLAH's `LoomCliWorkerAdapter` is a development/testing tool; the CF path uses
Container-backed `WorkerAdapter` implementations from `cf-workers.ts`.

### NLAH is not forked

All contributions go upstream to `nlah`. The `packages/nlah` workspace package is an
integration shim, not a fork. If an upstream contribution cannot land, the workspace
package provides the seam for a local patch — but the default is upstream contribution
first.

### Deterministic-first

Integration tests use NLAH's built-in `DeterministicWorkerAdapter` (or a Miniflare
test double for R2). No LLM calls in integration test suite.

---

## Invariants

### INV-1: HARNESS-RUNTIME-IS-NLAH

All harness-driven task flows execute via NLAH's `advanceHarness()`. No harness flow
invokes `StateGraph.run()` from `graph-runner.ts` directly.

**Two-phase detector:**

Phase 1 (during migration — before synthesis migration completes):

```bash
# Only coordinator/graph.ts and coordinator/index.ts (line 7 re-export) are
# permitted to reference graph-runner. Any other reference is a violation.
grep -rn 'graph-runner' workers/ff-pipeline/src \
  | grep -v 'coordinator/graph.ts' \
  | grep -v 'coordinator/graph-runner.ts' \
  | grep -v 'coordinator/index.ts'
# Must return zero lines
```

**Phase 1 duration bound (F8):** Phase 1 is valid for **≤ 4 Verification Reports**
(approximately 4 weeks at current cadence). If `graph-runner` callers still exist
after that window, an Architect review is triggered automatically by emitting a
Tier-1 signal `architecture:migration-overdue` referencing this invariant. Phase 1
is not a permanent state; it is a migration window with an explicit expiry.

Phase 2 (after synthesis migration — permanent state):

```bash
# graph-runner.ts itself must no longer exist
ls workers/ff-pipeline/src/coordinator/graph-runner.ts 2>/dev/null && echo VIOLATION || echo OK
grep -rn 'graph-runner' workers/ff-pipeline/src
# Both must return zero / OK
```

### INV-2: HARNESS-SCHEMA-CONSUMED-NOT-OWNED

`HarnessSpec` is imported from `@factory/nlah`, not defined in `packages/schemas`.

Detector: `grep -r 'HarnessSpec' packages/schemas/src` returns zero results.

### INV-3: FAILURE-TAXONOMY-REQUIRED (F6 — deployed detector)

`runHarnessCompletenessVerification` rejects any `CompiledHarness` with empty
`failure_taxonomy`. Returns `{ overall: 'fail', failure_code: 'EMPTY_FAILURE_TAXONOMY' }`.

**Deployed detector** (replaces the prior unit-test citation):

```bash
# Miniflare smoke-test: POST a harness with empty failure_taxonomy through the
# deployed init path and assert the Workflow init step returns 400.
miniflare smoke test/smoke/inv3-empty-taxonomy.test.ts
# Test body: starts the bundled ff-pipeline Worker; calls startHarnessRun()
# with a harness YAML whose failure_taxonomy is {} ; asserts the resulting
# Workflow surface returns an error response (status != 200) carrying
# failure_code EMPTY_FAILURE_TAXONOMY in the body.
```

Unit-level coverage at `packages/verification/src/harness-completeness-verification.test.ts`
remains in place as a development-time check but is no longer the authoritative
detector for INV-3.

### INV-4: HARNESS-LINEAGE-REQUIRED

Every harness YAML committed to the repo carries a non-empty `lineage.source_refs`
field. After contribution #4 lands, `runHarnessCompletenessVerification` enforces this.

Detector: `runHarnessCompletenessVerification` returns `MISSING_LINEAGE` when
`lineage.source_refs` is absent or empty on a nlahspec 0.2 harness (per L-3, 0.1
harnesses are warned, not blocked, until #4 lands).

### INV-5: FACTORY-VERIFICATION-IS-SIBLING (F6 — deployed detector)

`runHarnessCompletenessVerification` is a separate pass called after `compileHarness()`.
It does not run inside NLAH's `compileHarness()`. The call sequence is always:
`loadHarness → compileHarness → runHarnessCompletenessVerification → initHarness`.

**Deployed detector** (replaces the prior unit-test citation):

```bash
# Miniflare smoke-test: POST a harness whose lineage.source_refs is empty
# (nlahspec 0.2) and assert the deployed Workflow init returns the
# MISSING_LINEAGE failure code, demonstrating the Factory pass ran AFTER
# NLAH's compileHarness (NLAH does not enforce lineage).
miniflare smoke test/smoke/inv5-missing-lineage.test.ts
```

### INV-6: ARTIFACTMANAGER-INTERFACE-NOT-CLASS (F6 — deployed detector)

After contribution #1a, `ArtifactManager` is a TypeScript interface exported from
`@factory/nlah`. `CfArtifactManager` implements it. `FsArtifactManager` also implements it.

**Deployed detector** (replaces the prior unit-test citation):

```bash
# Static grep on the deployed worker bundle: confirm no graph-runner import is
# present in the queue consumer or bridge. This catches accidental transitive
# imports through @wescome/nlah's export * surface.
grep -E 'graph-runner|loom_cli_worker|aider_cli_worker|pi_cli_worker' \
  workers/ff-pipeline/dist/harness-dispatcher.js \
  workers/ff-pipeline/dist/harness-bridge.js
# Must return zero results.

# Plus the TS structural check at build time:
# CfArtifactManager satisfies ArtifactManager  — must compile clean.
tsc --noEmit -p workers/ff-pipeline/tsconfig.json
```

### INV-7: NO-FILESYSTEM-IN-CF-PATH

No `node:fs` or `node:fs/promises` import anywhere in the CF execution path
(`harness-bridge.ts`, `cf-artifact-manager.ts`, `cf-workers.ts`, `run-coordinator.ts`,
`harness-dispatcher.ts`).

Detector:
```bash
grep -rn 'node:fs' workers/ff-pipeline/src/harness-bridge.ts \
  workers/ff-pipeline/src/cf-artifact-manager.ts \
  workers/ff-pipeline/src/cf-workers.ts \
  workers/ff-pipeline/src/coordinator/run-coordinator.ts \
  workers/ff-pipeline/src/harness-dispatcher.ts
# Must return zero results.
```

---

## Validation Criteria

1. **packages/nlah builds.** `pnpm --filter @factory/nlah build` succeeds.
   Exports include `initHarness`, `advanceHarness`, `HarnessState`, `HarnessAdvance`,
   `StageResult`, `ArtifactManager` (interface), `loadHarness` (string overload),
   `gateRegistry`. No `export *` from `@wescome/nlah` (L-1).

2. **harness-bridge.ts compiles.** `pnpm --filter @factory/ff-pipeline typecheck` passes.
   `startHarnessRun` is exported and has the signature:
   `(harnessKey: string, env: Env, job: FunctionJob) => Promise<{ runId: string }>`.

3. **Event-driven integration test passes (F12 strengthened).** `startHarnessRun`
   called with:
   - A valid harness YAML key in a Miniflare R2 double
   - A mock DO namespace that records `/init` calls
   - A `FunctionJob` with `functionRunId` and `objective`
   Returns `{ runId: string }`. DO receives `{ compiled, initialState, workflowId }`
   via POST. **HARNESS_QUEUE receives exactly one `HarnessQueueMessage` whose
   `stageName === initialState.currentStage` (i.e., the start stage was dispatched).**
   No `node:fs/promises` import in the call chain.

4. **CfArtifactManager satisfies interface.** TypeScript structural check:
   `CfArtifactManager satisfies ArtifactManager` compiles. `writeText` + `readText`
   round-trips through a Miniflare R2 double. `resolve()` returns correct R2 key
   `artifacts/{functionRunId}/{artifact.path}`. `getStorageHandle()` returns
   `{ kind: 'r2', bucketBinding, prefix }`.

5. **coding-adapter.harness.yaml compiles.** `compileHarness` returns `CompiledHarness`
   without errors. `runHarnessCompletenessVerification(compiled, gateRegistry)`
   returns `{ overall: 'pass' }`. 5 stages in topological order. `failure_taxonomy`
   covers `missing_artifact`, `patch_does_not_apply`, `verifier_rejects`,
   `budget_exceeded`.

6. **Completeness verification rejects bad harness (F4 throw path).** Test:
   harness with empty `failure_taxonomy` → `{ overall: 'fail', failure_code:
   'EMPTY_FAILURE_TAXONOMY' }`. Test: harness referencing a gate name not in the
   supplied `gateRegistry` → `{ overall: 'fail', failure_code:
   'UNREGISTERED_GATE', details: ['<stage>: gate "<name>" not registered in
   supplied gateRegistry'] }`. Test (after #4): harness missing
   `lineage.source_refs` on nlahspec 0.2 → `{ overall: 'fail', failure_code:
   'MISSING_LINEAGE' }`.

7. **No filesystem in CF path.** `grep -rn 'node:fs'` in `harness-bridge.ts`,
   `cf-artifact-manager.ts`, `cf-workers.ts`, `run-coordinator.ts`,
   `harness-dispatcher.ts` returns zero results.

8. **Full typecheck.** `pnpm -r typecheck` passes including `@factory/nlah`,
   `@factory/verification`, `@factory/ff-pipeline`.

9. ***(After synthesis migration)*** Synthesis retirement gates (F7 — mirrors
    ADR-009 §8 verbatim):

   9.1. **NLAH v0.2 Phase 3 landed in upstream.**
   ```bash
   # Concrete check: npm registry reports @wescome/nlah ≥ 0.2.0 with
   # FailureAction surface present.
   test "$(npm show @wescome/nlah version)" \
     | awk -F. '{ exit ($1 > 0 || ($1 == 0 && $2 >= 2)) ? 0 : 1 }'
   node -e "const n = require('@wescome/nlah'); if (!n.FailureAction) process.exit(1)"
   ```

   9.2. **`synthesis.harness.yaml` compiles.**
   ```bash
   node -e "
     const { loadHarness, compileHarness } = require('@factory/nlah')
     const fs = require('fs')
     const text = fs.readFileSync('harnesses/synthesis.harness.yaml','utf8')
     loadHarness(text).then(spec => compileHarness(spec)).then(() => process.exit(0))
   "
   ```

   9.3. **`runHarnessCompletenessVerification` returns `pass` on
   `synthesis.harness.yaml`.**
   ```bash
   node -e "
     const { loadHarness, compileHarness, gateRegistry } = require('@factory/nlah')
     const { runHarnessCompletenessVerification } = require('@factory/verification')
     const fs = require('fs')
     const text = fs.readFileSync('harnesses/synthesis.harness.yaml','utf8')
     loadHarness(text)
       .then(spec => compileHarness(spec))
       .then(c => runHarnessCompletenessVerification(c, gateRegistry))
       .then(r => process.exit(r.overall === 'pass' ? 0 : 1))
   "
   ```

   9.4. **Existing synthesis DO integration tests pass with event-driven path.**
   ```bash
   pnpm --filter @factory/ff-pipeline test \
     test/integration/synthesis-do.test.ts
   ```

   9.5. **Architect reviews migrated synthesis harness.** A signed entry in
   `.agent/memory/semantic/DECISIONS.md` headlined `synthesis.harness.yaml
   approved` records the sign-off. Verifiable by:
   ```bash
   grep -q 'synthesis.harness.yaml approved' .agent/memory/semantic/DECISIONS.md
   ```

   9.6. **No callers of `graph-runner` remain.**
   ```bash
   grep -rn 'graph-runner' workers/ff-pipeline/src
   # Must return zero lines.
   ```

---

## Test Infrastructure

Integration tests use Miniflare for R2 and DO doubles. No real CF deployment required
to pass criteria 1–8.

```typescript
// test setup pattern for harness-bridge.ts tests
import { Miniflare } from 'miniflare'

const mf = new Miniflare({
  modules: true,
  r2Buckets: ['WORKSPACE_BUCKET'],
  durableObjects: { RUN_COORDINATOR: 'RunCoordinator' },
  queueProducers: { HARNESS_QUEUE: 'harness-queue' },
  script: `/* harness-bridge + run-coordinator bundled */`,
})

const bucket = await mf.getR2Bucket('WORKSPACE_BUCKET')
await bucket.put('harnesses/coding-adapter.harness.yaml', codingAdapterYaml)

// Exercise startHarnessRun; assert DO received /init; assert no filesystem calls
// F12: also assert HARNESS_QUEUE.send was called with stageName === startState.
```

For `advanceHarness` unit tests: pure function, no infrastructure required. Tests
assert `HarnessAdvance` variants for each transition scenario: normal dispatch, retry,
return_to_stage, complete, fail.

---

## Dependencies

- `packages/nlah` (new — wraps `@wescome/nlah`; requires contributions #0, #1a, #1b, #1c, #1d)
- `workers/ff-pipeline` (add `harness-bridge.ts`, `harness-dispatcher.ts`,
  `cf-artifact-manager.ts`, `cf-workers.ts`; extend or add
  `coordinator/run-coordinator.ts`; update `pipeline.ts` Workflow step;
  update `wrangler.toml` with HARNESS_QUEUE + RUN_COORDINATOR + Container bindings)
- `packages/verification` (add `harness-completeness-verification.ts`; requires
  contribution #5 surface for `gateRegistry` import)
- `harnesses/` (new top-level directory for harness YAML files)
- `@wescome/nlah` (upstream contributions #0, #1a, #1b, #1c, #1d required before any CF work)

No changes to `packages/schemas`. No changes to `graph-runner.ts` internals.
No changes to `CoherenceVerificationInput`. No new external runtime dependencies
beyond `@wescome/nlah`.

---

## Out of Scope

| Item | Why excluded |
|---|---|
| `HarnessSpec` schema authoring | NLAH owns the authoritative schema |
| `compileHarness()` authoring | NLAH owns the compiler |
| `graph-runner.ts` modification | Retired for harness flows, not modified |
| `HarnessBindings` / `LoomBinding` stubs | Superseded by NLAH's `WorkerRegistry` + `WorkerAdapter` |
| Compiler error taxonomy (full) | NLAH's 9 compiler assertions own this; Factory adds governance checks in `runHarnessCompletenessVerification` only |
| `execution_mode` schema field | Not in NLAH schema; `worker:` field per stage + `WorkerRegistry` is the dispatch mechanism |
| Dynamic signal routing | `IS-HARNESS-DYNAMIC-SIGNALS-v1` (not yet authored) |
| Worker capability matching | NLAH v0.2 Phase 5 — future IS |
| Cost accounting / budget enforcement | NLAH v0.2 Phase 5 — future IS |
| `synthesis.harness.yaml` (until contributions #1c + #2) | Blocked; tracked as validation criterion 9 |
| Container provisioning | Bindings declared in §5 wrangler.toml; image build/deploy lives in CF Container infra IS (not yet authored). If Containers absent at deploy time, harnesses referencing the missing worker fail Harness Completeness at `startHarnessRun` (MISSING_WORKER_BINDING) per F13. |
