# ADR-009: NLAH Runtime Replaces StateGraph as the Single Domain-Agnostic Execution Primitive

## Status

Pending Architect approval — 2026-05-16

## Date

2026-05-16

## Lineage

ADR-002 (Cloudflare Serverless Architecture — Workers/DOs/Workflows/Containers/R2/D1),
ADR-003 (gdk-agent as default executor),
ADR-004 (custom StateGraph over LangGraph),
ADR-005 (vertical slicing),
DECISIONS.md (2026-05-16: NLAH is the Trellis harness runtime substrate),
IS-HARNESS-DSL-v1 (revised concurrently)

---

## 1. Decision

Adopt `nlah` (the real TypeScript v0.1.0 implementation at `/Users/wes/nlah`) as the
**single, domain-agnostic execution primitive for all Trellis task flows**. NLAH's
harness state machine — accessed via `initHarness()` + `advanceHarness()` pure
functions (upstream contribution #1c) — replaces the in-DO `StateGraph` runner
(`graph-runner.ts`, ADR-004) completely. There is **one execution primitive**. Every
task flow — coding-swarm, synthesis, and any future task family — is a YAML harness
executed by the NLAH runtime.

The synthesis DO is migrated to a harness YAML (`synthesis.harness.yaml`) as part
of this ADR's scope. `graph-runner.ts` and `coordinator/graph.ts` are retired when
migration is complete and the gates in §8 are satisfied.

ADR-004's core principle is preserved: Cloudflare platform primitives over LangGraph.
NLAH itself does not use LangGraph — it is a self-contained TypeScript state machine —
so no platform constraint is violated.

**Event-driven execution.** A previous draft proposed calling `runHarness()` as a
blocking in-memory loop inside a CF Workflow `step.do()`. This model fails for any
harness with real agent stages: coding-swarm runs take 25–100 minutes wall-clock;
synthesis repair rounds are unbounded; any future domain (legal review, medical
imaging, contract analysis) may have stages measured in hours. CF Workflow `step.do()`
wall-clock limits make a blocking loop untenable beyond trivial test harnesses.

The correct architecture is event-driven:

```
Workflow                      Queue                   DO (RunCoordinator)
  │                             │                           │
  ├─ step.do('init-harness') ───────────────────────────► initHarness()
  │                             │◄── dispatch(stage0) ──────┤
  │                             │                           │
  ├─ step.waitForEvent(         │                           │
  │   'harness-complete',       │    Container finishes     │
  │   { timeout: '7 days' })    │    stageComplete() ──────►│ advanceHarness()
  │                             │◄── dispatch(stage1) ──────┤
  │                             │          ...              │
  │◄── harness-complete ──────────────────────────────────── notifyWorkflowComplete()
```

NLAH contributes `initHarness()` + `advanceHarness()` as pure functions
(contribution #1c). The DO holds `HarnessState` and calls `advanceHarness()` on each
stage completion. The Workflow issues `step.waitForEvent('harness-complete', { timeout:
'7 days' })` to suspend durably. A CF Queue delivers stage work to the Container
dispatcher. This architecture is domain-agnostic: a 5-minute synthesis run and a
24-hour domain-specific run use identical infrastructure.

---

## 2. Context: What NLAH Already Provides

Discovery during IS-HARNESS-DSL-v1 authoring revealed that NLAH is not a Python
specification or a future design artifact. It is a working TypeScript package:

| Component | File | Notes |
|-----------|------|-------|
| Zod schema | `src/schema.ts` | `HarnessSpec`, `StageSpec`, `ArtifactSpec`, `GateSpec`, `ArtifactContract` discriminated union |
| Compiler | `src/compiler.ts` | `loadHarness(filePath)` → `compileHarness(spec)` → `CompiledHarness`; 9 assertion checks |
| Runtime | `src/runtime.ts` | `runHarness()` blocking loop; artifact enforcement; gate evaluation |
| Gate registry | `src/gates.ts` | 8 gates: `exists`, `patch_applies_cleanly`, `repo_map_names_relevant_files`, etc. |
| Worker adapter | `src/loom_cli_worker.ts` | `LoomCliWorkerAdapter` — Pi CLI wrapper; writes prompts, captures `git diff` |
| Worker registry | `src/worker_registry.ts` | `WorkerRegistry` class — `register()`, `get()`, `getDefault()` |
| MVP harness YAML | `harnesses/coding_swarm.mvp.yaml` | 5 stages: CONTRACT→MAP→PATCH→VERIFY→RELEASE |
| Failure taxonomy | schema field | `failure_taxonomy?: Record<string, string>` per harness |

**Package:** `"nlah"` v0.1.0 (unscoped). Package name scoping to `@wescome/nlah` is
upstream contribution #0.

This covers everything IS-HARNESS-DSL-v1 was speccing to build from scratch.

> **Note (B-2):** `initHarness()` and `advanceHarness()` **do not exist in NLAH
> v0.1.0**. NLAH today exposes `runHarness()` (a blocking loop over the state
> machine in `src/runtime.ts`) but not the two pure decomposed functions this
> ADR's event-driven model requires. They are new pure-function architecture
> introduced by **upstream contribution #1c (WP004)**. §2 of this ADR describes
> the current v0.1.0 surface; the event-driven bridge in §4 Phase 3 depends on
> contribution #1c landing first. Any reading of this ADR that assumes
> `initHarness` / `advanceHarness` are already callable today is incorrect.

### 2.1 The Two Runtimes Problem

Before this ADR, Trellis had two graph runtime paths:

1. **ADR-004 StateGraph** (`graph-runner.ts`) — 9-node synthesis graph wired in
   `coordinator/graph.ts`; roles dispatch via `agentLoop`
2. **NLAH `runHarness()`** — a second state machine for coding-swarm and future flows

Two competing runtimes for overlapping problem domains is a substrate fork.
The Factory does not permit substrate forks. The correct answer is: one runtime,
domain-agnostic, for all task flows. The synthesis graph is not exempt — it migrates
to a harness YAML like every other task family.

---

## 3. Scope Boundaries

### NLAH owns

- Harness schema (`HarnessSpec`, `StageSpec`, all sub-types)
- Harness compilation (`compileHarness`) and validation
- Harness state machine (`initHarness`, `advanceHarness`, `runHarness`)
- Gate registry and gate implementations
- Worker adapter interface and concrete adapters (`LoomCliWorkerAdapter`)
- `WorkerRegistry` — Injectable registry; Factory registers CF-backed workers into it
- MVP and production harness YAML files

### Factory / Trellis contributes

- `packages/nlah` workspace package — wraps NLAH for monorepo consumption; seam for
  future internalization
- `harness-bridge.ts` in ff-pipeline — event-driven adapter: `startHarnessRun()`
  initializes the DO; the DO calls `advanceHarness()` on each stage completion
- `RunCoordinator` DO (or extension to existing coordinator DO) — holds `HarnessState`,
  calls `advanceHarness()`, dispatches to Queue, notifies Workflow on terminal state
- `CfArtifactManager` — CF-compatible implementation once NLAH extracts
  `ArtifactManager` to an interface (contribution #1a); backed by R2 (`WORKSPACE_BUCKET`)
- `packages/verification/src/harness-completeness-verification.ts` — produces `VR-*`
  artifacts; input is NLAH's `CompiledHarness`, not a re-parsed spec
- `source_refs` and lineage enforcement — added to harness YAML metadata, not to NLAH's
  schema; after contribution #4 lands, enforced by `runHarnessCompletenessVerification`

### ADR-004 StateGraph retirement

`graph-runner.ts` and `coordinator/graph.ts` are **retired** when the gates in §8 are
satisfied. No new logic is written against the StateGraph API after this ADR is
accepted. Deletion is the target; temporary coexistence is the migration path, not a
permanent carve-out.

---

## 4. Integration Path

### Phase 1 — Upstream NLAH contributions (prerequisite)

Before Trellis can fully integrate, NLAH requires the following contributions aligned
with its `HARNESS_ARCHITECTURE_IMPLEMENTATION_SPEC.md` roadmap:

| # | Contribution | NLAH roadmap ref | Blocks |
|---|---|---|---|
| 0 | Publish as scoped npm package `@wescome/nlah` | (new) | Monorepo `packages/nlah` dependency resolution |
| 1a | `ArtifactManager` extracted to TypeScript interface; concrete impl renamed `FsArtifactManager` | WP002 | CF integration (no Node FS) |
| 1b | `buildStageContext` injectable `fileReader` parameter or pre-hydrated `StageContext` overload | WP003 | CF integration (`context.ts` calls `node:fs/promises readFile`) |
| 1c | `initHarness(compiled, context)` + `advanceHarness(compiled, state, result)` pure functions | WP004 | Event-driven CF integration; domain-agnostic long-running stages |
| 1d | `loadHarness(source: string \| Path)` — accepts raw YAML string (for R2-loaded harness) | WP003 | CF integration (no filesystem path available) |
| 2 | v0.2 Phase 3: `FailureAction` discriminated union + `return_to_stage` + `max_stage_attempts` budget | WP005 | Synthesis harness migration |
| 3 | v0.2 Phase 6: `artifact_lineage` trace events with `producerStage`/`producerRole`/`worker`/`inputArtifacts`/`passedGateIds` | WP007 | `VR-*` generation from trace |
| 4 | `lineage` passthrough field on `HarnessSpec` | (new) | Factory `source_refs` enforcement |
| 5 | Export `gateRegistry` or `registerGate(name, fn)` from `gates.ts` | (new) | CF-specific gate registration (`cf_artifact_exists`, `container_run_passed`) |

**Dependency order:**
- Contributions #0, #1a, #1b, #1c, #1d gate **all CF integration work** — nothing in
  ff-pipeline can land without them
- Contribution #2 gates **synthesis migration** specifically
- Contributions #3, #4 gate **`VR-*` generation and lineage enforcement**
- Contribution #5 gates **CF-specific custom gate registration**

### Phase 2 — Workspace integration

```
packages/nlah/
  package.json    — name: @factory/nlah; depends on @wescome/nlah (contribution #0)
  src/index.ts    — re-exports: HarnessSpec, StageSpec, ArtifactSpec, GateSpec,
                    ArtifactManager (interface), CompiledHarness, HarnessState,
                    HarnessAdvance, StageResult, RuntimeResult, WorkerRegistry,
                    WorkerAdapter, WorkerInput, WorkerOutput,
                    loadHarness, compileHarness, initHarness, advanceHarness
```

`HarnessSpec` from NLAH is the authoritative schema. No parallel schema is authored in
`packages/schemas`.

### Phase 3 — Event-driven bridge adapter

Per ADR-002 (Cloudflare Serverless Architecture), harness execution is orchestrated by
a CF Workflow. The blocking `runHarness()` loop inside `step.do()` cannot handle real
agent stages. The correct model:

```typescript
// workers/ff-pipeline/src/harness-bridge.ts

// Called from Workflow step.do('init-harness') — initializes DO, does NOT block
export async function startHarnessRun(
  harnessKey: string,    // R2 key for harness YAML (from FunctionJob)
  env: Env,
  job: FunctionJob,
): Promise<{ runId: string }> {
  const yamlText = await env.WORKSPACE_BUCKET.get(harnessKey).then(r => r!.text())
  const spec = await loadHarness(yamlText)            // contribution #1d: string input
  const compiled = compileHarness(spec)
  await runHarnessCompletenessVerification(compiled)  // Factory governance gate; throws on fail
  const initialState = initHarness(compiled, {        // contribution #1c: pure fn
    taskText: job.objective,
    runId: job.functionRunId,
  })
  const doId = env.RUN_COORDINATOR.idFromName(job.functionRunId)
  const stub = env.RUN_COORDINATOR.get(doId)
  await stub.fetch('/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compiled, initialState }),
  })
  return { runId: job.functionRunId }
}

// workers/ff-pipeline/src/coordinator/run-coordinator.ts (DO endpoint)
// POST /stage-complete — called by Container worker on completion
async handleStageCompletion(
  stageName: string,
  workerOutput: WorkerOutput,
  gateResults: GateResult[],
): Promise<void> {
  const state: HarnessState = await this.ctx.storage.get('harnessState')
  const compiled: CompiledHarness = await this.ctx.storage.get('compiled')
  const stageResult: StageResult = { stageName, workerOutput, gateResults }
  const advance = advanceHarness(compiled, state, stageResult)  // contribution #1c: pure fn
  if (advance.newState) await this.ctx.storage.put('harnessState', advance.newState)
  if (advance.action === 'dispatch' || advance.action === 'retry' || advance.action === 'return') {
    await this.env.HARNESS_QUEUE.send({ runId: state.runId, stageName: advance.stage })
  } else {
    await this.notifyWorkflowComplete(advance.result)  // 'complete' | 'fail'
  }
}

// workers/ff-pipeline/src/pipeline.ts (Workflow)
await step.do('init-harness', async () => startHarnessRun(job.harnessKey, this.env, job))
const completion = await step.waitForEvent<RuntimeResult>('harness-complete', { timeout: '7 days' })
await step.do('record-result', async () => recordHarnessResult(completion.payload, this.env, job))
```

**Storage binding map (ADR-002 §5):**

| NLAH concept | CF binding | Notes |
|---|---|---|
| Harness YAML | R2 (`env.WORKSPACE_BUCKET`) | `harnessKey` is R2 object key |
| `ArtifactManager` paths | R2 (`env.WORKSPACE_BUCKET`) | `CfArtifactManager` — no Node FS |
| Task content (`taskPath`) | `FunctionJob.objective` | Injected at init; not a filesystem path |
| Role files (`rolePath`) | R2 or inline in harness YAML | No filesystem |
| `HarnessState` + `CompiledHarness` | DO storage (`this.ctx.storage`) | Per run; held by RunCoordinator |
| Stage work delivery | `env.HARNESS_QUEUE` | Queue message: `{ runId, stageName }` |
| Permanent artifacts | R2 + ArangoDB | Post-run lineage |
| Job ledger | D1 | `FunctionRun` record |

### Phase 4 — Harness-completeness verification

```typescript
// packages/verification/src/harness-completeness-verification.ts
import { CompiledHarness } from '@factory/nlah'

export async function runHarnessCompletenessVerification(
  compiled: CompiledHarness,
): Promise<HarnessCompletenessReport>
```

Checks: `failure_taxonomy` present and non-empty; all stages reachable from start state;
all gates registered in gate registry; all worker bindings declared; `lineage.source_refs`
non-empty.

Call sequence: `loadHarness → compileHarness → runHarnessCompletenessVerification →
initHarness`. Verification runs at run-initialization time (inside `startHarnessRun`),
not at compile time. A harness that fails verification blocks the Workflow from starting.

### Phase 5 — Synthesis DO migration

Author `synthesis.harness.yaml` against `nlahspec: 0.2` (linear graph; repair loop
via `return_to_stage` failure action, not DAG topology):

```yaml
nlahspec: "0.2"
runtime_policy:
  max_stage_attempts: 3
  max_total_attempts: 12
  recovery:
    default_action: abort_run
stages:
  PLAN:
    from: TaskReceived
    to: Planned
    role: Planner
  CRITIQUE:
    from: Planned
    to: Critiqued
    role: Critic
    on_failure:
      critique_failed: { action: return_to_stage, targetStage: PLAN }
  VERIFY:
    from: Critiqued
    to: Verified
    role: Verifier
  ARCH:
    from: Verified
    to: ArchReviewed
    role: Architect
  CODE:
    from: ArchReviewed
    to: Synthesized
    role: Coder
    worker: pi-swarm          # adapter handles internal parallelism (Option C)
failure_taxonomy:
  critique_failed:      return_to_stage
  verification_failed:  retry_stage
  budget_exceeded:      mark_incomplete
```

**Synthesis parallelism — Option C (decided):** The current synthesis DO dispatches 3
parallel Coder atoms. This parallelism is an internal concern of the CODE stage's worker
adapter (`PiSwarmAdapter.execute()`), not a property of the stage graph topology.
`PiSwarmAdapter` dispatches to N Containers internally and returns a merged `WorkerOutput`
to `advanceHarness()`. The stage graph stays linear (`nlahspec: 0.2`; no `graph_mode: dag`).
NLAH's runtime does not need to change for this. This decision is consistent with
`HARNESS_ARCHITECTURE_IMPLEMENTATION_SPEC.md` WP006 deferral — WP006 will add `dag`
execution when separately motivated, not to support synthesis parallelism.

**Blocked on:** NLAH v0.2 Phase 3 (failure semantics — `return_to_stage` action).

When `synthesis.harness.yaml` compiles and passes event-driven integration tests:
- `coordinator/graph.ts` is deleted
- `graph-runner.ts` is deleted (after all callers are migrated)
- `buildSynthesisGraph()` call in pipeline replaced by `startHarnessRun()`

---

## 5. Relationship to ADR-004

| Dimension | ADR-004 (retired) | ADR-009 (replacement) |
|-----------|-------------------|----------------------|
| Runtime | `graph-runner.ts` StateGraph | NLAH `initHarness` + `advanceHarness` |
| Execution model | Blocking in-memory loop | Event-driven: Queue + DO + Workflow `waitForEvent` |
| Step duration | Limited by CF step wall-clock | Unlimited: DO + Queue + 7-day `waitForEvent` |
| Use case | Synthesis graph only (programmatic) | All task flows (YAML-declared) |
| Domain coupling | Hard-coded synthesis topology | Domain-agnostic; topology in YAML |
| Long-running stages | Not supported | Supported — stage work delivered via Queue |
| Failure taxonomy | Not applicable | Required per harness spec |
| Artifact enforcement | Not applicable | Gate-enforced per stage |
| Lineage | Manual via `source_refs` | Declared in harness YAML metadata |
| Target state | Deleted after migration | Permanent substrate |

ADR-004's design principle ("use CF platform primitives, not LangGraph") is preserved.
NLAH has no LangGraph dependency. The YAML harness is the domain-agnostic abstraction
ADR-004's programmatic graph always lacked.

---

## 6. What Changes in IS-HARNESS-DSL-v1

IS-HARNESS-DSL-v1 was drafted as a build-from-scratch spec, then revised as a
integration spec with a blocking `runHarnessFromYaml()` bridge. This ADR supersedes
that framing. The revised IS specifies:

- `packages/nlah` workspace package (integration seam, not authoring)
- Event-driven `harness-bridge.ts` (`startHarnessRun` + DO `handleStageCompletion`)
- `RunCoordinator` DO extension for `HarnessState` + `advanceHarness` dispatch loop
- `CfArtifactManager` backed by R2 (contribution #1a prerequisite)
- `harness-completeness-verification.ts` (Factory governance pass)
- All 9 upstream NLAH contribution requests
- Type contracts: `HarnessState`, `HarnessAdvance`, `StageResult`, `Env` bindings
- `synthesis.harness.yaml` (blocked on contribution #2)
- Synthesis parallelism Option C documented

Items removed from IS scope: `HarnessSpec` authoring, `compileHarness()` authoring,
`HarnessBindings` / `LoomBinding` stubs, compiler error taxonomy (NLAH's 9 assertions
own this).

---

## 7. When to Reconsider

1. **NLAH repo becomes unmaintained** — if `nlah` stalls and the upstream contributions
   in Phase 1 cannot be merged, Trellis may need to fork or internalize the runtime.
   The `packages/nlah` workspace package provides the seam for a local patch without
   public API changes to the rest of Trellis.

2. **CF Containers change the substrate** — if Phase 5 (PAI swarm in Containers)
   moves execution off Cloudflare Workers entirely, the CF-compatibility requirements
   for `ArtifactManager` may relax. The `CfArtifactManager` seam handles this.

3. **Synthesis topology requires parallel stage graph** — the current synthesis
   parallelism (3 Coder atoms) is handled inside the CODE stage worker (Option C —
   decided). If the topology itself requires parallel stage execution beyond what a
   single worker adapter can encapsulate, WP006 (`graph_mode: dag`) would need to be
   unblocked. This is not currently a requirement. Revisit only if a new task family
   genuinely needs parallel stage graph nodes.

---

## 8. Consequences

### Benefits

- No parallel harness runtimes — one execution substrate for all task flows, including
  future domains with arbitrarily long-running stages
- Event-driven model removes the CF step wall-clock constraint entirely
- NLAH's existing gate registry (8 gates), failure taxonomy, `LoomCliWorkerAdapter`,
  and `WorkerRegistry` are immediately available without re-implementation
- `coding_swarm.mvp.yaml` (5 stages, complete gate spec) is deployable against pi CLI today
- IS-HARNESS-DSL-v1 scope reduces from "build runtime + schema + compiler" to
  "integrate + add governance layer"
- `coordinator/graph.ts` topology becomes a versionable YAML artifact; synthesis topology
  is auditable and diffable

### Tradeoffs

- Factory depends on an external repo (`nlah`) — managed via the workspace package
  abstraction; internalization path exists if needed
- Contributions #1c and #1d are architectural additions (not just interface extractions);
  require coordination with NLAH maintainer
- `graph-runner.ts` coexists during migration — temporary, not permanent; deletion is the
  explicit exit condition
- Event-driven architecture requires Workflow + Queue + DO working together — more
  primitives than a blocking loop, but necessary for domain-agnostic correctness

### Synthesis retirement gates

Synthesis DO migration is not an accomplished fact. The entry in DECISIONS.md is amended
to state gates rather than asserting retirement. Migration is gated on all of:

1. NLAH v0.2 Phase 3 (failure semantics — `return_to_stage`) landing in the upstream repo
2. `synthesis.harness.yaml` compiles via `compileHarness` without errors
3. `runHarnessCompletenessVerification` returns `{ overall: 'pass' }` on `synthesis.harness.yaml`
4. All existing synthesis DO integration tests pass with the event-driven path
5. Architect reviews the migrated synthesis harness before `graph-runner.ts` is deleted
6. No callers of `graph-runner.ts` remain after the migration step
7. **Rollback note signed off.** A rollback note exists at
   `.agent/memory/episodic/synthesis-migration-rollback.md` confirming all of:
   (a) `graph-runner.ts` can be restored from git history (cite the commit SHA at
   which deletion is proposed);
   (b) no irreversible DO storage schema migration has occurred — `HarnessState` and
   `RuntimeState` are stored under disjoint DO storage keys so a restored
   `graph-runner.ts` can read its prior state without collision;
   (c) the rollback procedure (revert deletion commit; redeploy ff-pipeline; verify
   synthesis runs resume) has been dry-run in the dev environment and the dry-run
   transcript is linked from the note. The note is signed off by the Architect
   before gate 7 is satisfied.

---

## 9. Reference

| Component | Location | Status |
|-----------|----------|--------|
| NLAH runtime | `/Users/wes/nlah` | `"nlah"` v0.1.0, live |
| NLAH v0.2 impl spec | `/Users/wes/nlah/HARNESS_ARCHITECTURE_IMPLEMENTATION_SPEC.md` | 7 Work Packets (WP001–WP007) |
| NLAH v0.2 arch design | `Dropbox/WeOps/FunctionFactory/nlah_v0_2_architecture_design.md` | §11 confirms: linear + failure semantics, no DAG |
| `WorkerRegistry` | `/Users/wes/nlah/src/worker_registry.ts` | Live — `register()`, `get()`, `getDefault()` |
| `WorkerAdapter` | `/Users/wes/nlah/src/workers.ts` | Interface — Trellis implements CF variants |
| `ArtifactManager` | `/Users/wes/nlah/src/artifacts.ts` | Concrete class (Node FS) — interface extraction = contribution #1a |
| `context.ts` | `/Users/wes/nlah/src/context.ts` | Node FS `readFile` — injectable reader = contribution #1b |
| `gates.ts` | `/Users/wes/nlah/src/gates.ts` | Gate registry — export = contribution #5 |
| `graph.ts` | `/Users/wes/nlah/src/graph.ts` | DAG infrastructure exists; WP006 adds execution; not required by this ADR |
| `graph-runner.ts` | `workers/ff-pipeline/src/coordinator/graph-runner.ts` | Deprecated — deleted after synthesis DO migration + §8 gates satisfied |
| `coordinator/graph.ts` | `workers/ff-pipeline/src/coordinator/graph.ts` | Deprecated — replaced by `synthesis.harness.yaml` |
| `synthesis.harness.yaml` | `workers/ff-pipeline/src/harnesses/synthesis.harness.yaml` | Not yet created — blocked on NLAH v0.2 Phase 3 + contribution #1c |
| IS-HARNESS-DSL-v1 | `specs/intent-specifications/IS-HARNESS-DSL-v1.md` | Revised concurrently with this ADR |
| `harness-bridge.ts` | `workers/ff-pipeline/src/harness-bridge.ts` | Not yet created — blocked on contributions #1c, #1d |
| `run-coordinator.ts` | `workers/ff-pipeline/src/coordinator/run-coordinator.ts` | Extension or new DO — blocked on contributions #1c |
| `packages/nlah` | `packages/nlah/` | Not yet created — blocked on contribution #0 |
| ADR-002 deployment arch | `Dropbox/WeOps/FunctionFactory/Factory–Cloudflare-Serverless.md` | Confirms: R2 artifacts, Containers=workers, Workflow orchestrates |
| DECISIONS.md entry | `.agent/memory/semantic/DECISIONS.md` | Added 2026-05-16; amended by §8 of this ADR |
