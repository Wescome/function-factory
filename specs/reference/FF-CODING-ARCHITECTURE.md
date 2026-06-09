# FF-CODING-ARCHITECTURE — Function Factory Coding Pipeline

**Status:** Canonical reference (living document)
**Authored by:** Architect Agent, 2026-05-18
**Lineage:**
- `harnesses/coding-adapter.harness.yaml`
- `specs/reference/CODING-ADAPTER-MULTIAGENT-PROPOSALS.md`
- `specs/reference/MULTIAGENT-RESEARCH-SYNTHESIS.md`
- `specs/reference/observability-pipeline-spec.md`
- `specs/reference/observability-se-diagnosis.md`
- `specs/reference/ADR-009-nlah-runtime-replaces-state-graph.md`
- `specs/reference/FF-RUN-ARTIFACT-SPEC.md`
- `.agent/memory/working/PI_PRODUCTION_DEFECTS.md`
- `workers/ff-pipeline/src/harness-dispatcher.ts`
- `workers/ff-pipeline/src/coordinator/run-coordinator.ts`
- `workers/ff-pipeline/src/coordinator/pi-container.ts`
- `workers/ff-pipeline/pi-container/server.mjs`

**Scope.** This document is the canonical reference for the Function Factory
coding pipeline. It supersedes any prior partial design notes for the coding
adapter and is the single source of truth for: pipeline topology, write-scope
enforcement, multi-agent shape, gate vocabulary, PR creation, repo
materialization, circuit breakers, dispatch/observability bugs, and
implementation priority. A new agent or engineer onboarding to this surface
should be able to do so from this file alone, then drop into the cited source
files for line-level detail.

**Authoring discipline.** Decisions are stated as decisions. Proposals are
labeled `PROPOSAL`. Unknowns are labeled `OPEN GATE` with the name of the
person whose decision unblocks them. Findings reversed by research are called
out explicitly so future agents do not re-import the obsolete position.

---

## Table of Contents

1. System Overview
2. Current Production State
3. Write Scope Architecture (three layers)
4. Multi-Agent Design (revised from research)
5. Four-Gate Taxonomy (hermes verbatim adoption)
6. PR Creation Architecture
7. Repo Materialization
8. ToolGuardrail Specification
9. Dispatch and Observability Architecture
10. Implementation Priority Order
11. Open Architecture Gates
12. Invariants Register
13. Appendix A — Glossary
14. Appendix B — File Index

---

## 1. System Overview

### 1.1 The six-stage pipeline

The coding adapter resolves a repository-grounded issue by walking a fixed,
linear sequence of six stages. Each stage reads declared input artifacts from
R2, runs a single worker process, and writes declared output artifacts back to
R2. The harness YAML is the topology.

```
TaskReceived
     │
     ▼
┌─────────┐   inputs: (none)
│  SEED   │   worker:  preseed
│         │   outputs: SeedWorkspace
└────┬────┘   gate:    exists(SeedWorkspace)
     │
     ▼
┌─────────┐   inputs:  SeedWorkspace
│ CONTRACT│   worker:  pi-author (role: Cartographer)
│         │   outputs: IssueContract
└────┬────┘   gate:    exists(IssueContract)
     │
     ▼
┌─────────┐   inputs:  SeedWorkspace, IssueContract
│   MAP   │   worker:  pi-author (role: Cartographer)
│         │   outputs: RepoMap
└────┬────┘   gate:    exists + repo_map_names_relevant_files
     │                + repo_map_names_test_entrypoints
     ▼
┌─────────┐   inputs:  SeedWorkspace, RepoMap
│  PATCH  │   worker:  pi-author (role: PatchWorker)
│         │   outputs: CandidatePatch
└────┬────┘   gate:    exists + patch_applies_cleanly
     │
     ▼
┌─────────┐   inputs:  SeedWorkspace, CandidatePatch
│ VERIFY  │   worker:  pi-author (role: Verifier)
│         │   outputs: VerifierReport
└────┬────┘   gate:    exists + verifier_accepts_patch
     │                + test_results_support_claims
     ▼
┌─────────┐   inputs:  SeedWorkspace, CandidatePatch, VerifierReport
│ RELEASE │   worker:  pi-author (role: ReleaseAgent)
│         │   outputs: FinalPatch, PRSummary
└────┬────┘   gate:    exists + final_patch_matches_verified_candidate
     │
     ▼
PullRequestReady
```

Stages are sequential. The harness `graph_mode: linear`. There is no parallel
PATCH branch in production. Each `pi-author` stage spawns a fresh Pi
subprocess (see §4) so there is no in-process state bleed between stages.

`harnesses/coding-adapter.harness.yaml` is the authoritative topology file.
This document describes that file's semantics; if the two disagree, the YAML
wins and this document must be updated.

### 1.2 Component map

Five infrastructure components participate in every coding run. Each owns a
clear responsibility boundary.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Cloudflare Worker (ff-pipeline)                                      │
│                                                                      │
│  ┌────────────────┐    ┌────────────────────┐    ┌───────────────┐  │
│  │ Workflow       │    │ harness-bridge.ts  │    │ harness-      │  │
│  │ (pipeline.ts)  │───▶│ startHarnessRun()  │───▶│ dispatcher.ts │  │
│  │ step.do(init)  │    │ + R2 seed writes   │    │ dispatchOne() │  │
│  │ step.waitFor   │    └────────┬───────────┘    └───────┬───────┘  │
│  │   ('harness-   │             │ POST /init             │          │
│  │    complete')  │             ▼                        ▼          │
│  └───────▲────────┘    ┌────────────────────┐    ┌───────────────┐  │
│          │             │ RunCoordinator DO  │◀───│ harness-queue │  │
│          │             │ holds HarnessState │    │ consumer      │  │
│          │             │ advanceHarness()   │    │ (per stage)   │  │
│          │             │ /stage-complete    │    └───────────────┘  │
│          └─────────────│ /force-complete    │                       │
│           sendEvent    │ /init              │    ┌───────────────┐  │
│           harness-     └────────┬───────────┘    │ harness-dlq   │  │
│           complete              │ idFromName     │ (NO CONSUMER  │  │
│                                 ▼                │  TODAY — see  │  │
│                        ┌────────────────────┐    │  §9 Bug 3)    │  │
│                        │ PiContainer DO     │◀───┴───────────────┘  │
│                        │ container.ctx      │                       │
│                        │ + monitor()        │                       │
│                        └────────┬───────────┘                       │
└─────────────────────────────────│───────────────────────────────────┘
                                  │ HTTP /execute (TCP 8080)
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Cloudflare Container (pi-container)                                  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ server.mjs                                                   │    │
│  │  - handleExecute() ── spawns ── Pi subprocess (per stage)    │    │
│  │  - tool-capability probe                                     │    │
│  │  - JSONL RPC over stdin/stdout                               │    │
│  │  - repair-turn injection                                     │    │
│  │  - stderr ring buffer (MAX_STDERR_TAIL_BYTES)                │    │
│  │  - GET /logs/tail                                            │    │
│  └─────────────────────┬────────────────────────────────────────┘    │
│                        │ spawn                                       │
│                        ▼                                             │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Pi subprocess (earendil-works/pi v0.74.1)                    │    │
│  │  - reads SeedWorkspace from local tmp dir                    │    │
│  │  - executes role prompt under selected model                 │    │
│  │  - writes artifacts under ./workspace and ./artifacts        │    │
│  │  - routed via ofox.ai (cost decision, memory entry           │    │
│  │    `feedback_ofox_stays_for_cost`)                           │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘

                  ▲
                  │ artifacts read/write
                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ R2 Bucket (WORKSPACE_BUCKET)                                         │
│                                                                      │
│   runs/{runId}/state/                  ← HarnessState snapshots       │
│   runs/{runId}/artifacts/              ← declared per-stage outputs   │
│   runs/{runId}/artifacts/__observ../   ← prompt + stderr captures     │
│   runs/{runId}/events/                 ← append-only RunEvent log     │
│   runs/{runId}/events/_summary.json    ← rolling RunSummary           │
│   runs/{runId}/logs/{stage}/attempt-N  ← attempt-headered stage logs  │
│   runs/_active-index.json              ← watchdog scan list           │
└──────────────────────────────────────────────────────────────────────┘
```

**Ownership rules:**

- The **Workflow** is suspended for the lifetime of the run via
  `step.waitForEvent('harness-complete', { timeout: '7 days' })`. It does no
  work; it just waits for the terminal event.
- The **harness-bridge** does R2 seed writes, calls `loadHarness` +
  `compileHarness`, runs the completeness-verification pass, and POSTs to the
  RunCoordinator DO's `/init`. It then returns. It never blocks on stage
  execution.
- The **RunCoordinator DO** holds `HarnessState` and `CompiledHarness` per
  run. Every stage completion POSTs `/stage-complete`; the DO calls
  `advanceHarness(compiled, state, stageResult)` (pure function, NLAH upstream
  contribution #1c) and enqueues the next stage on `harness-queue`. On
  terminal state it calls `notifyWorkflowComplete()`.
- The **harness-dispatcher** is a Queue consumer. For each message it loads
  `CompiledHarness` + `HarnessState` from DO storage, builds the StageContext,
  invokes `adapter.execute()`, evaluates gates, and POSTs the result back to
  RunCoordinator `/stage-complete`.
- The **PiContainer DO** is the per-run container handle. It forwards
  `/execute` requests to `server.mjs` over TCP 8080 inside the container,
  monitors the container, and drains stderr logs to R2.
- The **Pi subprocess** is the agent. It is spawned per `handleExecute` call
  (one per stage) and torn down after returning the WorkerOutput. There is no
  Pi pool; freshness is by construction.
- **R2** is the durable artifact store. It is the only place that survives a
  Worker recycle. Anything not written to R2 is ephemeral.

### 1.3 Key architectural invariants

The full invariant register is §12. The five load-bearing invariants for the
coding pipeline (from `CODING-ADAPTER-MULTIAGENT-PROPOSALS.md` lines 332-356,
restated here for reading ergonomics) are:

- **INV-CODING-01** — A CandidatePatch that fails `patch_applies_cleanly`
  MUST NOT reach VERIFY.
- **INV-CODING-02** — VERIFY runs in a Pi subprocess that has NOT seen the
  CandidatePatch within the same session. (Today: fresh spawn per
  `handleExecute`.)
- **INV-CODING-03** — `VerifierReport` MUST contain `## Tests run` with
  captured command output before `test_results_support_claims` passes.
- **INV-CODING-04** — When a Verifier-specific model list is configured, the
  Verifier MUST NOT be the same model that authored the CandidatePatch.
- **INV-CODING-05** — `max_repair_rounds` is a combined budget covering
  contract-repair turns AND gate-failure-repair turns within a stage.

New invariants from this document's findings appear in §12.

---

## 2. Current Production State

### 2.1 What is proven

Run `pi-operational-mpbze86c` is the autonomous proof point.
(`PI_PRODUCTION_DEFECTS.md` lines 8-15.)

- Worker / container version: `4f244b28-9643-4ab4-b136-5626446abb24`
- Stages passed end-to-end: SEED, CONTRACT, MAP, PATCH, VERIFY, RELEASE.
- R2 prompt artifact persisted at
  `runs/pi-operational-mpbze86c/artifacts/__observability/CONTRACT.prompt.initial.txt`.
- CONTRACT observation prompt diagnostic hash matched the persisted prompt
  artifact (byte-for-byte fidelity confirmed).
- CONTRACT tool telemetry: `toolCallEventCount=138`,
  `toolExecutionEventCount=10`, `assistantToolCallCount=5`.

**What this proves.** Under the seeded-workspace harness (no real-repo
materialization), Pi can autonomously walk the entire six-stage pipeline,
produce a structurally valid CandidatePatch, write a VerifierReport, and
emit FinalPatch + PRSummary, with the harness YAML's gates accepting every
artifact. The architecture is functionally correct on the seeded path.

### 2.2 Open production defects

From `.agent/memory/working/PI_PRODUCTION_DEFECTS.md`:

#### DEFECT-1 — CandidatePatch malformed on real source

Run: `ff-dogfood-prompt-persist-mpbyd6wl`.

Pi authored a conceptually correct prompt-persistence patch against real
ff-pipeline source. `patch_applies_cleanly` failed with a hunk context
mismatch in `server.mjs`. The run terminated; no repair path returned the
gate failure message back to PATCH.

**Root cause.** Pi's unified-diff context-line emission is model-quality
sensitive. The model produced a syntactically recognizable diff (the contract
evaluator accepted it) but the hunk header line numbers and context windows
slipped relative to the actual file content.

**Required fix** (this document, §4 and §10): repair-loop carries gate
failure back to PATCH with the exact `git apply` error message in the repair
prompt. Blocks on NLAH upstream contribution #2 (failure semantics —
`return_to_stage`). Status: open.

#### DEFECT-2 — Container rollout transient marks run failed

Run: `ff-dogfood-prompt-verify-mpbytfgq`. CONTRACT failed during container
version rollout. The Worker retried `container is not running` three times,
but the container needed longer to stabilize after deploy. The run was
marked failed even though the new container later started.

**Status.** Partially mitigated by commit `cb667ca` (clears active execution
and resets the queue on restart). Rollout-kills-active-run behavior is still
open. Required fix: distinguish rollout replacement from permanent container
failure; do not emit terminal `container_crashed` for expected rollout exits.

#### DEFECT-4 — Status projection lags stage dispatch order

During operational smokes, `/run-monitor` sometimes reported `currentStage`
as an earlier completed stage while later stage entries were already running.
This does not block execution; it makes operator monitoring confusing.

**Required fix.** Update RunEvent projection so `currentStage` is derived
from the latest active (started, not completed) stage. Status: open.

(DEFECT-3 — prompt metadata trimmed from event ring — was fixed in commit
`9f9ce15` and verified by `pi-operational-mpbze86c`. It is closed.)

### 2.3 Three critical infrastructure bugs (SE diagnosis)

From `observability-se-diagnosis.md`. These are the bugs that cause runs to
get stuck instead of completing. They are independent of model quality.

#### Bug 1 (CRITICAL) — `buildStageContextForRun` called before try block

- **File:** `workers/ff-pipeline/src/harness-dispatcher.ts:324` (call site;
  the implementation is at `:253-280`).
- **Symptom.** When CONTRACT cannot find `SeedWorkspace` in R2 (e.g. SEED
  was skipped or failed silently), `buildStageContextForRun` throws a
  reference error before entering the try block. The exception escapes
  `dispatchOne` entirely. It is not captured as `workerThrew`. Queue retries
  3×, dead-letters; `harness-complete` is never fired; workflow waits 7 days.
- **Fix.** Move `buildStageContextForRun` call inside the try block at
  approximately line 344. (5 minutes of work.)
- **Affects.** Every stage with declared input artifacts: CONTRACT, MAP,
  PATCH, VERIFY, RELEASE.

#### Bug 2 (CRITICAL) — `notifyWorkflowComplete` swallows sendEvent failures

- **File:** `workers/ff-pipeline/src/coordinator/run-coordinator.ts:275-302`.
- **Symptom.** When `sendEvent('harness-complete', ...)` throws (e.g.
  transient platform error), the handler logs
  `[INFRA SIGNAL] infra:harness-complete-sendevent-failed` and returns. No
  retry. Workflow waits its full 7-day timeout even though the run terminated
  hours ago.
- **Fix.** On sendEvent failure, schedule a DO alarm or enqueue a retry
  message (e.g. to `feedback-signals`) so the event is durably delivered.
  RunCoordinator already persists `KEY_RESULT`; the retry just re-calls
  `sendEvent` with the stored result. (30 minutes.)

#### Bug 3 (CRITICAL) — `harness-dlq` queue has no consumer

- **File:** `workers/ff-pipeline/wrangler.jsonc:68`.
- **Symptom.** The DLQ binding is declared
  (`"dead_letter_queue": "harness-dlq"`) but no consumer is bound. Messages
  exhausting 3 retries on `harness-queue` are routed to `harness-dlq` and
  disappear silently. Every run that hits Bug 1 or a dispatcher crash is
  permanently stuck.
- **Fix.** Add `{ "queue": "harness-dlq", "max_batch_size": 10,
  "max_retries": 1 }` to `queues.consumers`; implement
  `src/harness-dlq-consumer.ts` (per `observability-pipeline-spec.md` §4);
  add `/force-complete` to RunCoordinator. (2 hours.)

These three bugs are the first three items in the implementation priority
order (§10). They MUST land before any further quality work because they are
the difference between "run completes with a clear failure" and "run hangs
forever invisibly."

---

## 3. Write Scope Architecture (THREE LAYERS)

### 3.1 Why three layers

The research synthesis (`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 60-67,
116-125, 170-173) examined how SWE-bench top performers and production agent
frameworks constrain where an agent may write. The finding: no single layer
is sufficient. The robust pattern is defense in depth.

- **Aider** — preventive: the in-chat writable set (`abs_fnames`) is
  enforced in the tool wrapper before any write reaches the filesystem.
  Cleanest preventive pattern in the corpus.
- **Sweep AI** — forensic: a post-stage validation pass
  (`validate_and_sanitize_multi_file_changes`) strips any file the agent
  wrote that is not in the declared FCR set or already in the repo. Adds a
  warning to the run record; does not abort.
- **Codex CLI** — substrate-level: OS-level sandboxing (Landlock on Linux,
  Seatbelt on macOS) ensures the agent cannot write outside designated paths
  even if both preventive and forensic checks have a bug.
- **OpenHands** — substrate-only: relies solely on container isolation. No
  path-level enforcement. This is the weakest model in the corpus.

The Factory's coding pipeline adopts all three layers because we run agents
that can be model-quality-sensitive (Pi) inside a substrate (Cloudflare
Containers) where the substrate alone is insufficient — the container is
shared across many R2 paths via `WORKSPACE_BUCKET`, and a Pi process inside
the container can in principle reach `WORKSPACE_BUCKET` writes through the
RunCoordinator surface if the tool wrapper is buggy.

### 3.2 Layer 1 — Preventive (Aider model in TypeScript)

**Location.** New file: `workers/ff-pipeline/src/path-guard.mjs` (or absorbed
into the existing `workspace-seed.mjs`).

**Contract.**

```typescript
// path-guard.ts
import picomatch from 'picomatch'  // ^4.0.0 — confirmed TypeScript-native

export interface PathGuard {
  /** Returns true iff path is permitted under the current write scope. */
  isAllowed(path: string): boolean
  /** Returns the canonical (normalized, root-relative) form, or throws. */
  canonicalize(path: string): string
}

export function buildPathGuard(seed: SeedWorkspace, allowedPatterns: string[]): PathGuard {
  // Files declared in the SeedWorkspace are implicitly writable.
  const seedFiles = new Set(seed.files.map(f => path.normalize(f.path)))
  // Additional glob patterns explicit on the harness or per-stage.
  const matchers = allowedPatterns.map(p => picomatch(p))
  return {
    isAllowed(p: string): boolean {
      const c = path.normalize(p)
      if (seedFiles.has(c)) return true
      return matchers.some(m => m(c))
    },
    canonicalize(p: string): string {
      // Resolve, then require workspace-root containment.
      const c = path.normalize(p)
      if (c.startsWith('..') || path.isAbsolute(c)) {
        throw new Error(`path escapes workspace root: ${p}`)
      }
      return c
    },
  }
}
```

**Wiring.** The Pi tool wrapper in `pi-container/server.mjs` intercepts every
`write_file` / `apply_patch` / `move_file` tool call. Before forwarding the
call to Pi's filesystem implementation, the wrapper calls `guard.isAllowed`
on every target path. Disallowed calls return a structured error to Pi —
they do NOT silently drop, because Pi must see the rejection in order to
self-correct.

**Glob library — `picomatch ^4.0.0`.** Confirmed TypeScript-native by the
research pass (`MULTIAGENT-RESEARCH-SYNTHESIS.md` line 184). Has full
gitignore-style pattern support, brace expansion, extglobs, and is the engine
inside `globby`, `chokidar`, and `fast-glob`. The alternative `minimatch` is
serviceable but missing brace expansion semantics that several SeedWorkspace
manifests depend on. No node-glob dependency (node-glob is process-global
chdir-based per OpenHands' note that `glob.glob()` is not parallel-safe).

**Rename handling — both-paths-match.** When Pi emits a rename
(`*** Move to: path/new`), the guard checks BOTH the source and the
destination against the allowed set. Rejecting on either side prevents a Pi
process from "escaping" by renaming a file inside scope into a file outside
scope. This is the same rule Codex CLI enforces in
`is_write_patch_constrained_to_writable_paths()`
(`MULTIAGENT-RESEARCH-SYNTHESIS.md` line 75).

### 3.3 Layer 2 — Forensic (Sweep model in the Worker)

**Location.** New file: `workers/ff-pipeline/src/patch-sanitizer.ts`.

**Contract.**

```typescript
// patch-sanitizer.ts
export interface SanitizationReport {
  acceptedFiles: string[]
  droppedFiles: Array<{ path: string; reason: string }>
  warnings: string[]
}

export function sanitizePatch(
  patch: ParsedUnifiedDiff,
  seed: SeedWorkspace,
  declaredFcrSet: ReadonlySet<string>,
): { sanitized: ParsedUnifiedDiff; report: SanitizationReport }
```

**Behavior** (adapted from Sweep's
`validate_and_sanitize_multi_file_changes`, lines 116-125 of the research
synthesis):

```typescript
const allFcrFileNames = new Set([...declaredFcrSet].map(path.normalize))
const seedPathSet = new Set(seed.files.map(f => path.normalize(f.path)))

for (const file of patch.files) {
  const norm = path.normalize(file.path)
  if (allFcrFileNames.has(norm) || seedPathSet.has(norm)) {
    sanitized.files.push(file)
  } else {
    report.droppedFiles.push({ path: file.path, reason: 'not_in_fcr_or_seed' })
    report.warnings.push(`[FORENSIC] dropped ${file.path} — not in FCR or seed`)
  }
}
```

**When this runs.** After the PATCH stage's `worker_executed` event but
BEFORE the `patch_applies_cleanly` gate. The sanitizer is the last write
boundary before R2 persistence; any path Pi wrote but was not authorized to
write is removed from the CandidatePatch and recorded in the run summary.

**Strip-and-warn, not abort.** The forensic layer is a safety net for a Layer
1 bug. Aborting the run on a forensic drop would make the system fragile to
SeedWorkspace mis-specification. Instead, the dropped paths become a Signal
(`counterfactual_recorded` event with `class: stage_branch_not_taken`) and
the run continues with the sanitized patch.

### 3.4 Layer 3 — Container isolation (backstop)

The Cloudflare Container is the substrate. It cannot directly mount the R2
bucket; all R2 writes flow through `pi-container.ts` (the DO) which validates
the calling context. The Pi subprocess inside the container has no R2
credentials of its own; it can only write under `/workspace` and
`/artifacts` inside the container's local FS. The DO then mirrors those
specific paths to R2 under `runs/{runId}/artifacts/`.

**This is the load-bearing substrate property.** Even if Layers 1 and 2 are
bypassed, the Pi process has no path to write anywhere in R2 other than the
declared per-stage output prefixes. This is enforced by the DO's
`writeStageArtifact()` method, which only accepts paths matching the stage's
declared `outputs` from the harness YAML.

### 3.5 Three-layer interaction summary

| Layer | Where | Trigger | Action on violation |
|-------|-------|---------|---------------------|
| 1 — Preventive | `pi-container/server.mjs` tool wrapper | Every write call from Pi | Return structured error to Pi (lets it self-correct) |
| 2 — Forensic | `workers/ff-pipeline/src/patch-sanitizer.ts` | After PATCH, before `patch_applies_cleanly` | Strip the file from CandidatePatch, log `[FORENSIC]`, emit counterfactual |
| 3 — Substrate | `workers/ff-pipeline/src/coordinator/pi-container.ts` `writeStageArtifact()` | Every R2 write | Reject with HTTP 403 (terminal — should never fire in practice) |

If Layer 3 ever fires, that is a system-level bug — Layers 1 and 2 should
catch everything. A Layer 3 firing is a high-severity Signal worthy of
immediate Architect review.

---

## 4. Multi-Agent Design (revised from research)

### 4.1 Critical reversal — N-parallel-PATCH is NOT what winners do

The Architect's prior `CODING-ADAPTER-MULTIAGENT-PROPOSALS.md` (Problem F
implicitly, Problems A-E explicitly) entertained Agentless-style N=4-8
parallel PATCH branches followed by SelectBestPatch. The research pass
(`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 12-27, 105-114) overturned this.

The headline finding is direct:

> Verdent AI 76.1% Verified explicitly disclaims "generating multiple
> candidates and then selecting one." Top performers use sequential repair
> with a reviewer subagent — not parallel sample-and-vote.

| System | SWE-bench score | Reconciliation strategy |
|---|---|---|
| Verdent AI | 76.1% Verified | Sequential repair + review subagent. **ZERO parallel-sample-and-rank.** |
| Codex CLI + GPT-5.2 | 63% Terminal-Bench | Sequential agent loop. No public vote/judge/reranker. |
| Meta Context Engineering | 89.1% | Evolutionary context optimization — different problem class. Not a SWE-bench agent. |

**Implication.** Parallel sample-and-rank is mostly absent from production
SWE-bench leaders. Sequential repair-with-tests is dominant. Building an
N-parallel-PATCH path would optimize against a pattern the SOTA has rejected,
and would also multiply ofox.ai inference costs by N for no measured benefit.

This document **vacates** the implicit parallel-PATCH direction and replaces
it with the sequential-repair-with-critic pipeline below. Future agents
considering parallelism MUST cite new evidence overriding this finding;
otherwise the default is sequential.

### 4.2 Revised pipeline

```
LOCALIZE  (existing MAP stage)
   │
   ▼
PATCH (single Pi)
   │
   ▼
┌─── repair loop ──────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────────────────┐                                 │
│  │ Spec Compliance Critic  │  fresh Pi, read-only toolset    │
│  │ (hermes pattern)        │  reads: plan, patch, files       │
│  │ APPROVED | REQUEST_CHANGES                                 │
│  └────────────┬────────────┘                                 │
│               │ APPROVED                                      │
│               ▼                                              │
│  ┌─────────────────────────┐                                 │
│  │ Code Quality Critic     │  fresh Pi, read-only toolset    │
│  │ (hermes pattern)        │  checks style, complexity, dead │
│  │ APPROVED | REQUEST_CHANGES  code, error handling, …       │
│  └────────────┬────────────┘                                 │
│               │ APPROVED                                      │
│               ▼                                              │
│      proceed to VERIFY                                       │
│                                                              │
│  REQUEST_CHANGES from either critic                          │
│       │                                                       │
│       ▼                                                       │
│  return_to_stage(PATCH) with gateFailureContext              │
│  (counts against max_repair_rounds)                           │
└───────────────────────────────────────────────────────────────┘
   │
   ▼
VERIFY
   │
   ▼
RELEASE
```

**Pattern lineage.** Hermes-agent
(`subagent-driven-development/SKILL.md`, per
`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 158-162) operationalizes this as:

> Per task: Implementer → Spec Compliance Reviewer → Code Quality Reviewer
> Each critic is a fresh `delegate_task` with `toolsets=['file']` (read-only).
> Gets original plan + files. Outputs APPROVED / REQUEST_CHANGES.

This maps cleanly to the Factory's existing primitives:

- "Implementer" = PATCH stage running the PatchWorker role.
- "Spec Compliance Reviewer" + "Code Quality Reviewer" = two new stages, or
  one stage with two internal sub-spawns. The recommended shape is two
  internal sub-spawns inside an extended PATCH stage (rather than two new
  harness stages) because they share the same fresh-Pi-per-invocation
  property and they only matter as PATCH-quality gates, not as independent
  pipeline phases.
- "REQUEST_CHANGES" = `gateFailureContext` (see §4.5) flows back to PATCH
  via the existing `return_to_stage` failure action.
- "fresh Pi" = each critic spawn is a new `handleExecute` call into the
  PiContainer DO, which spawns a new `startPi()` subprocess (`server.mjs:592`).
  This satisfies INV-CODING-02 with no additional infrastructure.

### 4.3 hermes ToolGuardrail circuit breaker

Even with sequential repair, a Pi instance can enter an infinite loop:
calling the same tool with the same arguments repeatedly, or calling
distinct tools that all fail with no progress between calls. The hermes
agent ships a contract for this in `tool_guardrails.py`
(`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 141-150):

- Each tool call is signed via
  `ToolCallSignature(tool_name, sha256(canonical_args))`.
- Per-turn counters track: `exact_failure_count` (same signature, same
  failure), `same_tool_count` (same tool, any args), `idempotent_no_progress`
  (same response signature returned).
- Thresholds: warn at 2 exact failures, halt at 5. Warn at 3 same-tool calls,
  halt at 8.
- Decision surface: `allow | warn | block | halt`.

**Port target.** A new module
`workers/ff-pipeline/src/coordinator/tool-guardrail.ts` that mirrors the
hermes contract but stores counters in DO storage rather than process
memory. (The Cloudflare runtime has no shared process; we cannot use a
per-turn in-memory counter because the next tool call may land on a
different isolate.)

**DO storage key pattern:**
```
toolguard:{runId}:{stageId}:exact_failures      → number
toolguard:{runId}:{stageId}:same_tool_counts    → Record<toolName, number>
toolguard:{runId}:{stageId}:last_signatures     → Record<toolName, string>
```

The container's `server.mjs` emits a `tool_call_event` after every Pi tool
invocation (via the existing JSONL RPC). The PiContainer DO subscribes to
those events and increments the guardrail counters. When `halt` is returned,
the DO terminates the current `/execute` call and returns a structured
`tool_guardrail_halted` outcome that the dispatcher treats as
`failure_taxonomy: budget_exceeded`.

This is the **A-NEW-2** proposal from the research synthesis. It does not
require NLAH upstream changes. It is unblocked today.

### 4.4 Bounded sub-agent registry (Codex AgentRegistry pattern)

Codex CLI's `AgentRegistry`
(`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 82-86) provides two
hard caps:

- `reserve_spawn_slot(max_threads)` — `Err(AgentLimitReached)` if the live
  agent count exceeds `max_threads`.
- `next_thread_spawn_depth()` + `exceeds_thread_spawn_depth_limit()` — depth
  cap so a recursive `spawn → spawn → spawn` chain cannot blow the stack.

The Factory does not have multi-agent recursion today (the harness is
linear, one Pi per stage). But the two-critic pattern in §4.2 introduces
sub-spawns inside a stage, and the next step beyond that (Verifier sub-tasks
that spawn read-only inspectors) compounds. The registry pattern is the
correct place to enforce the budget.

**Port target.** A new module
`workers/ff-pipeline/src/coordinator/agent-registry.ts`:

```typescript
export class AgentRegistry {
  private active = new Map<string, AgentHandle>()
  private totalCount = 0

  reserveSpawnSlot(maxThreads: number): Result<SpawnReservation> {
    if (this.totalCount >= maxThreads) {
      return { ok: false, error: 'AgentLimitReached' }
    }
    this.totalCount++
    return { ok: true, reservation: new SpawnReservation(this) }
  }

  exceedsDepthLimit(parentDepth: number, max: number): boolean {
    return parentDepth + 1 > max
  }
}
```

**Configuration.** Per harness YAML in `runtime`:

```yaml
runtime:
  max_concurrent_agents: 4   # default
  max_spawn_depth: 2         # default — Patcher → Critic → grandchild blocked
```

The two-critic pattern uses depth 1 (PATCH spawns one critic, returns).
Grandchild spawning is rejected by default; raising the cap is an architecture
decision (see §11, A-NEW-2 derived gate).

### 4.5 LangGraph rule — agents return patches, arbiter merges

LangGraph's hard rule
(`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 89-98) for parallel agents touching
the same resource:

> Do not let parallel agents overwrite the same shared resource directly.
> Return patches, merge in one reducer/arbiter step.

The Factory's pipeline is sequential today, so this rule looks dormant. It is
not. It governs the two-critic step: when both critics run, they MUST NOT
write to R2. They return their findings as in-memory `CriticReport` objects,
and the dispatcher (the arbiter) decides whether to merge them into a single
`gateFailureContext` or to fan out two separate repair turns.

**Why this matters.** If a critic wrote directly to R2 (e.g. a "fix
suggestions" artifact), a second critic running on the same Pi process could
read the first critic's artifact and have its judgment biased. By forcing
all critic output through the dispatcher, we preserve INV-CODING-02
(independent verification) and also preserve auditability — the dispatcher
log is the single source of truth for what each critic said.

**Implementation.** `CriticReport` is a typed return value from the
`/execute` endpoint when invoked with `role: SpecComplianceCritic` or
`role: CodeQualityCritic`. The dispatcher merges them via
`mergeCriticReports([specReport, qualityReport])`, which produces a single
`gateFailureContext` payload if either report is `REQUEST_CHANGES`.

### 4.6 `gateFailureContext` payload contract

From `CODING-ADAPTER-MULTIAGENT-PROPOSALS.md` Proposal C (lines 161-184),
augmented for the two-critic pattern:

```typescript
export interface GateFailureContext {
  gateName: string                       // e.g. 'spec_compliance_critic'
  gateMessage: string                    // full critic verdict text
  artifactName?: string                  // 'CandidatePatch' when applicable
  failedBy: 'gate' | 'critic'
  critic?: 'spec_compliance' | 'code_quality'
  evidence?: {
    failingHunks?: Array<{ file: string; reason: string }>
    failingTests?: Array<{ name: string; output: string }>
  }
}
```

The RunCoordinator stores this alongside the stage result. On the next
PATCH dispatch (the repair turn), the dispatcher reads it and adds it to
the `WorkerInput.context.repairContext` field. The Pi container server's
`handleExecute` prepends it as a repair turn (using the existing
`pi.stdin.write` mechanism at `server.mjs:792`).

**INV-CODING-05** (combined `max_repair_rounds`) governs how many of these
repair turns may fire per stage. Both contract-repair turns (from the
output-reliability layer) and gate-failure-repair turns count against the
same budget.

### 4.7 Recommended provider routing for the two critics

The current PATCH model candidate list is governed by
`PI_FILESYSTEM_MODEL_CANDIDATES` (env var read by `harness-dispatcher.ts`).
For the two critics, the same environment-variable-overlay pattern from
Proposal E's fast path (`CODING-ADAPTER-MULTIAGENT-PROPOSALS.md` lines
248-256) applies:

- `PI_SPEC_CRITIC_MODEL_CANDIDATES` — defaults to PATCH list if unset.
- `PI_QUALITY_CRITIC_MODEL_CANDIDATES` — defaults to PATCH list if unset.

To honor INV-CODING-04 (the Verifier must not be the same model that
authored the patch when a Verifier-specific model list is configured), the
critic model lists SHOULD also exclude the model that authored the patch.
This is a small dispatcher-side filter that reads the PATCH stage's
`selectedModel` from the previous StageResult and removes it from the
critic candidate list.

---

## 5. Four-Gate Taxonomy (hermes verbatim adoption)

### 5.1 The four kinds of gate

Hermes-agent's `gates-taxonomy.md` (`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines
152-156) defines four mutually exclusive gate kinds. The Factory adopts
this vocabulary verbatim because it is the cleanest classification we have
seen and it surfaces the operator-relevant distinction (does this gate
require human intervention?) at the type level.

| Kind | Semantics | When to use |
|------|-----------|-------------|
| **Pre-flight** | Block before work starts. Cheap structural / schema / existence checks. | Verifying that inputs are present, well-typed, and within bounds BEFORE the worker is invoked. Failing pre-flight is a `retry_stage` or `mark_incomplete`, never a repair. |
| **Revision** | Loop back to the previous authoring stage. Max 3 iterations. Escalates early if the issue count does not decrease across iterations. | Quality gates on worker output (patch applies, contract complies, critic approves). Failures carry `gateFailureContext` back as a repair turn. |
| **Escalation** | Pause for human. Never a default. | Architecture gates (Wes signs off), policy violations (forensic layer fires unexpectedly), or repeated revision failure (3 strikes per memory entry `feedback_3_strikes_architect_takes_over`). |
| **Abort** | Preserve state, terminate the run. | Unrecoverable structural failure: SeedWorkspace corrupt, container crashed past retry budget, ToolGuardrail halt. |

### 5.2 Mapping current harness gates to the taxonomy

The coding adapter harness today (`coding-adapter.harness.yaml` lines
114-184) declares the following gates per stage. Each is classified below
under the four-gate taxonomy.

| Stage | Gate | Today's spec | Classified as |
|-------|------|--------------|---------------|
| SEED | `exists: SeedWorkspace` | Output exists check | **Pre-flight** for downstream stages |
| CONTRACT | `exists: IssueContract` | Output exists check | **Pre-flight** |
| MAP | `exists: RepoMap` | Output exists check | **Pre-flight** |
| MAP | `repo_map_names_relevant_files` | Content pattern check | **Revision** (could repair via prompt feedback) |
| MAP | `repo_map_names_test_entrypoints` | Content pattern check | **Revision** |
| PATCH | `exists: CandidatePatch` | Output exists check | **Pre-flight** |
| PATCH | `patch_applies_cleanly: CandidatePatch` | Apply check via NLAH | **Revision** (the canonical DEFECT-1 fix) |
| VERIFY | `exists: VerifierReport` | Output exists check | **Pre-flight** |
| VERIFY | `verifier_accepts_patch` | Verifier verdict check | **Abort** if FAIL (independent verification said no — terminal) |
| VERIFY | `test_results_support_claims` | "Tests run" section check | **Revision** today; **Abort** if persistently missing |
| RELEASE | `exists: FinalPatch` / `exists: PRSummary` | Output exists checks | **Pre-flight** |
| RELEASE | `final_patch_matches_verified_candidate` | Diff identity check | **Abort** if mismatched |

**Two new gates** that the revised pipeline (§4.2) adds:

| Stage | Gate | Kind |
|-------|------|------|
| PATCH | `spec_compliance_critic_approved` | **Revision** |
| PATCH | `code_quality_critic_approved` | **Revision** |

**Two new gates** for the forensic layer (§3.3) and circuit breaker (§4.3):

| Stage | Gate | Kind |
|-------|------|------|
| PATCH | `forensic_sanitizer_clean` (no files dropped, OR explicit accept-with-warnings) | **Pre-flight** for VERIFY; **Revision** for PATCH |
| (any) | `tool_guardrail_within_budget` | **Abort** when halted |

### 5.3 Schema implication for the harness YAML

The harness DSL currently models gates as opaque entries in the stage `gate.all`
list. The four-gate taxonomy proposes annotating each gate with its kind:

```yaml
PATCH:
  gate:
    pre_flight:
      - { exists: CandidatePatch }
    revision:
      - { patch_applies_cleanly: CandidatePatch }
      - { spec_compliance_critic_approved: CandidatePatch }
      - { code_quality_critic_approved: CandidatePatch }
    escalation: []
    abort:
      - { forensic_sanitizer_terminal: CandidatePatch }   # rare
```

**Status:** This is **A-NEW-3** in the research synthesis. It is a NLAH
schema-extension request (parallel to upstream contribution #2 — failure
semantics). It does not block the four-gate vocabulary's adoption inside
the dispatcher; the dispatcher can classify gates by name today via a
lookup table while the schema extension proceeds upstream.

### 5.4 Operator-visible benefit

Once the four-gate vocabulary is wired through the RunSummary, the
`/run-status/:runId` endpoint can surface a clear status line:

```
status: revision_loop
  stage: PATCH
  attempt: 2 of 3
  failed_gate: spec_compliance_critic_approved (revision)
  next: re-dispatch PATCH with gateFailureContext
```

versus today's

```
status: failed
  finalStage: PATCH
  reason: gate failed
```

The taxonomy is the difference between actionable operator monitoring and
black-box failure.

---

## 6. PR Creation Architecture

### 6.1 Sweep pattern — Git Data API from the Worker

The current coding adapter terminates at RELEASE, which writes `FinalPatch`
and `PRSummary` artifacts to R2. There is no production code today that opens
a real GitHub pull request. The research pass identified the right
implementation pattern (`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 128-138):
GitHub Git Data API, called from the Worker, NOT from the container.

```python
# Sweep, sweepai/utils/github_utils.py — pattern
blob = repo.create_git_blob(file_contents, "utf-8")
blobs.append(InputGitTreeElement(path=..., mode="100644",
                                  type="blob", sha=blob.sha))
new_tree = repo.create_git_tree(blobs, base_tree=base_tree)
commit = repo.create_git_commit(commit_message, new_tree, [parent])
repo.get_git_ref(f"heads/{branch}").edit(sha=commit.sha)
```

Pure REST, no local clone, no credential propagation to the agent.

**Why Worker, not container.**

- The Worker holds the GitHub App installation token. The token is a
  per-tenant secret. Propagating it into the container would broaden the
  blast radius (the Pi process would have direct write access to the user's
  repo) and would defeat the three-layer write scope (a Pi process with a
  GitHub token bypasses every R2-side check).
- The Worker has direct fetch access to the GitHub REST API. The container
  does too in principle, but routing through the Worker keeps the auth
  surface centralized.
- The container emits only a diff. It never touches a git remote. This
  preserves the property that the container is a stateless agent runtime,
  not a deployment surface.

### 6.2 Token model — single-tenant today

For the immediate term (bootstrap), the Factory operates in a single-tenant
mode: one GitHub App installation, one target repo per harness run. The
token model is:

- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` —
  Worker secrets (set via `wrangler secret put`).
- At PR creation time, the Worker fetches an installation token via the
  GitHub App auth flow (`POST /app/installations/{id}/access_tokens`).
- The installation token lives for one hour. The Worker generates a fresh
  one per PR creation; there is no token caching in DO storage (avoids
  rotation complexity).

**Multi-tenant future.** When the Factory serves multiple users, each user's
GitHub App installation becomes a row in D1, and the Worker reads the
appropriate installation ID per run from `FunctionJob.installationId`. The
single-tenant pattern above is forward-compatible — only the lookup site
changes.

### 6.3 Harness schema addition — `IssueContract.targetRepo`

The harness DSL already passes an `IssueContract` artifact from CONTRACT
through to RELEASE. The current IssueContract content (per the gate
`required_patterns: ["Issue:", "Acceptance:"]`) is human-readable issue
text. PR creation requires an additional structured field:

```markdown
# IssueContract

Issue: <free text>

Acceptance:
- ...

TargetRepo: <owner>/<repo>
BaseBranch: main
BaseCommit: <SHA-1>
HeadBranchPrefix: factory/fn-
```

The Worker reads `TargetRepo`, `BaseBranch`, and `BaseCommit` from the
IssueContract at RELEASE-stage completion. The Pi cartographer is
instructed (in the CONTRACT role prompt) to emit these fields verbatim if
they are present in the inbound task description, or to leave them absent
if the task is operating against a seeded workspace with no real-repo
backing.

### 6.4 Branch naming — `factory/fn-<id>-<hash>`

Per `CODING-ADAPTER-MULTIAGENT-PROPOSALS.md` Pattern 3 derivation, the
Factory branch name is:

```
factory/fn-<functionRunId>-<shortHash>
```

where `shortHash` is the first 7 hex chars of `sha256(CandidatePatch)`.

**Retry-on-collision.** If the branch already exists (unlikely but possible
under repeat-run scenarios), the Worker appends `-1`, `-2`, … until a
non-existing branch name is found. Maximum 10 retries before giving up and
emitting an `infrastructure_error` event.

**Why include the patch hash.** It makes the branch name self-identifying
and content-addressed. An operator looking at the branch name can correlate
it to the CandidatePatch in R2 without needing to look up the runId
metadata.

### 6.5 PR creation flow

```
RELEASE stage completes
   │
   ▼
RunCoordinator handleStageCompletion(RELEASE, output, gates)
   │
   ▼ advanceHarness returns { action: 'complete', result: { overall: 'pass', … } }
   │
   ▼
notifyWorkflowComplete(result)
   │
   ▼ harness-bridge step.do('record-result', …)
   │
   ▼
recordHarnessResult(result, env, job)
   │
   ├── reads IssueContract from R2
   ├── if IssueContract.targetRepo present:
   │     ├── fetch GitHub App installation token
   │     ├── for each file in FinalPatch:
   │     │     create_git_blob(file_contents, "utf-8")
   │     │     append to InputGitTreeElement list
   │     ├── create_git_tree(blobs, base_tree=BaseCommit's tree)
   │     ├── create_git_commit(PRSummary.title, new_tree, [BaseCommit])
   │     ├── create_git_ref(f"heads/{branchName}", commitSha)
   │     │     (retry-on-collision)
   │     ├── create_pull(title=PRSummary.title, body=PRSummary.body,
   │     │              head=branchName, base=BaseBranch)
   │     └── emit `pr_created` event with PR URL
   │
   └── if IssueContract.targetRepo absent (seeded-workspace mode):
         └── emit `release_artifacts_only` event with R2 paths
```

The PR creation code lives in
`workers/ff-pipeline/src/release/github-pr-create.ts` (new file). It
depends on the `@octokit/rest` library for the REST surface; the Worker
runtime supports `fetch` so no shim is needed.

### 6.6 What the container is responsible for

Only this:

- Read SeedWorkspace into a local tmpdir.
- Run the Pi role prompt to produce CandidatePatch (or FinalPatch + PRSummary
  at RELEASE).
- Return the artifacts to the Worker via the `/execute` response.

The container has **no** git remote, **no** GitHub token, **no** ability to
push, and **no** authority to create branches. The PR creation surface is
out of scope for the agent runtime.

---

## 7. Repo Materialization

### 7.1 Current: SeedWorkspace JSON snapshot (deliberate)

The current architecture (`PI_PRODUCTION_DEFECTS.md` proof point, harness
YAML lines 51-58) materializes the working tree from a JSON snapshot stored
in R2. The SeedWorkspace contract is:

```typescript
interface SeedWorkspace {
  schemaVersion: '1.0'
  files: Array<{ path: string; content: string }>
  testCommand: string
  repoUrl?: string         // optional — already in schema space
  baseCommit?: string      // optional — required if repoUrl set
}
```

The SEED stage's `preseed` worker reads the SeedWorkspace from the job
payload or from R2, normalizes paths, and writes it to
`runs/{runId}/artifacts/seed_workspace.json`. Downstream stages read this
artifact from R2 and unpack `files[]` into a local tmpdir for Pi.

**Why this design.** Pi runs in an ephemeral container with no outbound git
access (a deliberate substrate constraint per the three-layer write scope
in §3). The patch is a unified diff against the SeedWorkspace snapshot,
not a real `git apply` against a live remote. PR creation is a separate
RELEASE-stage path (§6) that happens from the Worker. This separation
keeps the Pi process stateless and the Worker authoritative for any
external state mutation.

### 7.2 Future: real-repo path via shallow fetch (SWE-agent pattern)

When a task carries `IssueContract.targetRepo`, the SEED stage's `preseed`
worker materializes the SeedWorkspace from a real repository instead of an
inline JSON snapshot.

The SWE-agent pattern (`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 33-39) is
the right reference because it's the cheapest possible real-repo
materialization:

```bash
git init
git remote add origin https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git
git fetch --depth 1 origin <base_commit>
git checkout FETCH_HEAD
```

The shallow fetch retrieves only the snapshot at `BaseCommit` — no history,
no other branches, no objects. For a typical 100MB repo, this is ~3MB of
network traffic.

**Where this runs.** Inside the `preseed` worker, NOT inside the agent
container. The `preseed` worker is a one-shot Cloudflare Worker invocation
that runs before the SEED stage; it has its own short-lived installation
token, executes `git init`/`fetch`/`checkout`, reads every tracked file
into memory, serializes them into a SeedWorkspace JSON, and writes the
result to R2. The token is destroyed at the end of the preseed run.

This preserves the property that the agent container never sees a GitHub
token or a git remote. The agent always works against a JSON snapshot,
regardless of whether the snapshot was hand-authored or harvested from a
real repo.

### 7.3 Reset pattern between attempts

When PATCH fails its gates and the run loops back via `return_to_stage`,
the second PATCH attempt must operate on a clean copy of the SeedWorkspace
— not the (possibly partially patched) working tree from the first attempt.

The reset pattern (SWE-agent, line 40 of the synthesis):

```bash
git restore .
git reset --hard
git checkout <base>
git clean -fdq
```

In the Pi container, this is simpler because the working tree is a tmpdir
unpacked from SeedWorkspace JSON, not a git working tree. The reset is:

```
1. rm -rf /workspace/*
2. unpack SeedWorkspace.files into /workspace/
3. invoke Pi
```

The `handleExecute` flow in `server.mjs` performs this reset at the start
of every `/execute` call. There is no incremental state between stages
within a single Pi invocation, and no incremental state between
invocations of the same stage. Every stage attempt operates on a fresh
unpack from SeedWorkspace. This is by design and load-bearing for
INV-CODING-02 (independent verification).

### 7.4 `SeedWorkspace.repoUrl` field — already in schema space

The schema (§7.1) reserves `repoUrl?: string` and `baseCommit?: string`.
These fields are present in the schema definition but not currently
populated by any production caller. The preseed worker's real-repo path
(§7.2) will be the first populator.

**Migration impact.** Zero. Existing seeded-workspace runs continue to
work unchanged (the fields are optional). New real-repo runs simply
populate the fields and the preseed worker takes a different branch.

---

## 8. ToolGuardrail Specification

### 8.1 Source contract (hermes)

Hermes-agent's `tool_guardrails.py` (referenced at
`MULTIAGENT-RESEARCH-SYNTHESIS.md` lines 141-150) implements a per-turn
circuit breaker against an agent's tool-call loops. The contract:

```python
class ToolCallSignature:
    tool_name: str
    args_sha256: str       # sha256 of canonicalized JSON args

class ToolGuardrailState:
    exact_failure_counts: Dict[ToolCallSignature, int]
    same_tool_counts: Dict[str, int]
    idempotent_no_progress_counts: Dict[ToolCallSignature, int]

class ToolGuardrailDecision:
    action: Literal['allow', 'warn', 'block', 'halt']
    reason: str
```

Thresholds (hermes defaults):
- `exact_failure_count >= 2` → warn
- `exact_failure_count >= 5` → halt
- `same_tool_count >= 3` (without progress) → warn
- `same_tool_count >= 8` (without progress) → halt

The hermes implementation lives in a single Python process; the state lives
in process memory. The Factory cannot use this directly because Cloudflare
Workers are stateless — the next tool call from the same Pi process may
land on a different Worker isolate, and DO storage is the only durable
state.

### 8.2 CF port — DO storage rows

**Module.** `workers/ff-pipeline/src/coordinator/tool-guardrail.ts` (new).

**Storage layout.**

```
DO storage (PiContainer DO, keyed per (runId, stageId)):
  toolguard:{runId}:{stageId}:exact_failures
     → Record<signatureHash, number>
  toolguard:{runId}:{stageId}:same_tool_counts
     → Record<toolName, number>
  toolguard:{runId}:{stageId}:last_signatures
     → Record<toolName, signatureHash>
  toolguard:{runId}:{stageId}:halted
     → boolean
```

The `(runId, stageId)` key prefix is the scoping rule: the guardrail
resets at every stage boundary (because each stage gets a fresh Pi
subprocess, the cumulative tool history is irrelevant) but persists across
all tool calls within a stage attempt and across repair turns within the
attempt budget.

### 8.3 Signature computation

```typescript
function signTool(toolName: string, args: unknown): string {
  const canonical = canonicalJSON(args)  // sort keys, normalize whitespace
  const hash = sha256(toolName + '\x00' + canonical)
  return hash.slice(0, 16)  // 16 hex chars sufficient for collision avoidance
}
```

**Why canonical JSON.** Two calls to the same tool with arguments in
different key orders should hash to the same signature. Without
canonicalization, an agent that randomizes argument order would evade the
guardrail.

### 8.4 Decision flow

```typescript
async function checkGuardrail(
  ctx: PiContainerCtx,
  runId: string,
  stageId: string,
  toolName: string,
  args: unknown,
  toolResult: ToolResult,
): Promise<ToolGuardrailDecision> {
  const sig = signTool(toolName, args)
  const exact = await ctx.storage.get(`toolguard:${runId}:${stageId}:exact_failures`) ?? {}
  const sameTool = await ctx.storage.get(`toolguard:${runId}:${stageId}:same_tool_counts`) ?? {}

  if (toolResult.failed) {
    exact[sig] = (exact[sig] ?? 0) + 1
    if (exact[sig] >= 5) return { action: 'halt', reason: `exact_failure_count(${sig})=${exact[sig]}` }
    if (exact[sig] >= 2) return { action: 'warn', reason: `exact_failure_count(${sig})=${exact[sig]}` }
  }

  sameTool[toolName] = (sameTool[toolName] ?? 0) + 1
  const lastSig = (await ctx.storage.get(`toolguard:${runId}:${stageId}:last_signatures`) ?? {})[toolName]
  if (lastSig === sig && sameTool[toolName] >= 8) {
    return { action: 'halt', reason: `same_tool_no_progress(${toolName})=${sameTool[toolName]}` }
  }
  if (lastSig === sig && sameTool[toolName] >= 3) {
    return { action: 'warn', reason: `same_tool_no_progress(${toolName})=${sameTool[toolName]}` }
  }

  // Persist updated counters
  await ctx.storage.put(`toolguard:${runId}:${stageId}:exact_failures`, exact)
  await ctx.storage.put(`toolguard:${runId}:${stageId}:same_tool_counts`, sameTool)

  return { action: 'allow', reason: '' }
}
```

### 8.5 Container interaction

`server.mjs` emits a JSONL `tool_call_event` after every Pi tool invocation.
The PiContainer DO subscribes to those events (via the existing stderr
drain → R2 pipeline, plus a new in-band channel for guardrail events) and
invokes `checkGuardrail`. On a `halt` return:

- The DO calls `pi.stdin.write({ type: 'cancel' })` to terminate the Pi
  subprocess.
- The DO returns from `/execute` with a structured
  `tool_guardrail_halted` outcome.
- The dispatcher treats this as `failure_taxonomy: budget_exceeded` (which
  maps to `mark_incomplete` — the run records the halt and terminates the
  stage cleanly).

### 8.6 Test coverage requirement

The ToolGuardrail port MUST ship with the following test cases (new
`workers/ff-pipeline/src/coordinator/tool-guardrail.test.ts`):

- Same tool, same args, 5 failures → `halt`.
- Same tool, same args, 2 failures → `warn`.
- Same tool, varying args, 8 calls with no progress → `halt`.
- Same tool, varying args, mixed success/failure → `allow` throughout.
- Reset on new stage (`stageId` change) → counters cleared.
- Concurrent tool calls within a stage (race the storage put) → no lost
  increments (use DO storage's `transaction` API).

The transaction safety case is the most important. Without it, a Pi
process that fires two tool calls in rapid succession could see a stale
counter and bypass the halt threshold.

---

## 9. Dispatch and Observability Architecture

### 9.1 Three critical bugs (repeated for proximity)

The full diagnosis lives in §2.3. They are restated here for the
observability section because all three are root causes of stuck runs:

| Bug | File:Line | Fix | Effort |
|-----|-----------|-----|--------|
| 1 | `harness-dispatcher.ts:324` | Move `buildStageContextForRun` inside try block | 5 min |
| 2 | `run-coordinator.ts:275` | Add DO alarm retry on sendEvent failure | 30 min |
| 3 | `wrangler.jsonc:68` | DLQ consumer + `/force-complete` endpoint | 2 h |

These three are item 1, 2, 3 in the implementation priority order (§10).

### 9.2 RunEvent schema (canonical)

Source: `observability-pipeline-spec.md` §1, lines 25-81.

```typescript
// workers/ff-pipeline/src/observability/run-events.ts
export type RunStage = 'intent' | 'plan' | 'execution' | 'eval' | 'report'

export type RunEventType =
  // intent + plan phases
  | 'run_started'
  | 'seed_written'
  | 'seed_failed'
  | 'harness_loaded'
  | 'run_coordinator_initialized'
  // execution phase
  | 'stage_dispatched'
  | 'stage_started'
  | 'worker_executed'
  // eval phase — ontological gate names per FF-ONTOLOGY-ADDENDUM
  | 'coherence_verified'
  | 'fidelity_verified'
  | 'persistence_verified'
  | 'gate_evaluated'
  | 'stage_completed'
  | 'stage_failed'
  // report phase
  | 'counterfactual_recorded'
  | 'harness_complete'
  | 'workflow_notified'
  | 'workflow_notify_failed'
  // recovery
  | 'dlq_recovered'
  | 'stuck_detected'
  // container-side
  | 'container_started'
  | 'container_stderr_flush'
  | 'container_crashed'

export interface RunEvent {
  schemaVersion: '1.0'
  eventId: string            // ULID — sortable
  runId: string
  workflowId?: string
  stageName?: string
  attemptNumber?: number     // 1-based
  type: RunEventType
  timestamp: string          // ISO-8601
  data: Record<string, unknown>
  error?: {
    code?: string
    message: string
    stack?: string           // truncated to 2KB
  }
  emitter:
    | 'harness-bridge'
    | 'run-coordinator'
    | 'harness-dispatcher'
    | 'pi-container'
    | 'dlq-consumer'
    | 'watchdog'
}
```

**Event count.** Twenty-six distinct event types today, with three more
expected once the two-critic pattern (§4.2) and ToolGuardrail (§8) land:
`critic_evaluated`, `tool_guardrail_warned`, `tool_guardrail_halted`.

**Append-only.** Each event is one R2 object under
`runs/{runId}/events/{timestamp}-{eventId}.json`. The `_summary.json` is a
rolling projection updated by the `RunEventLog` class on every emit.

### 9.3 Storage layout (canonical R2 paths)

```
runs/{runId}/
  events/
    2026-05-18T14-00-01.123Z-01HKABCDEF.json      # one per event
    _summary.json                                  # rolling RunSummary
  state/                                           # HarnessState snapshots
  artifacts/                                       # declared stage outputs
  artifacts/__observability/
    CONTRACT.prompt.initial.txt                    # captured prompts
    PATCH.pi-stderr.jsonl                          # stderr ring buffer
  logs/
    CONTRACT/
      attempt-1.log                                # attempt-headered
    PATCH/
      attempt-1.log
      attempt-2.log

runs/_active-index.json                            # watchdog scan list
```

`runs/_active-index.json` uses R2 etag-based conditional puts (`If-Match`)
to prevent lost-update races. Two writers: `run_started` adds; terminal
events remove. No DO migration needed at this scale.

### 9.4 `===STAGE_RESULT===` terminal contract (AutoGo pattern)

From `observability-pipeline-spec.md` §1a. Every stage dispatch that
produces output MUST include a `===STAGE_RESULT===` delimiter line followed
by a JSON result block, written as the final line of
`runs/{runId}/logs/{stageName}/attempt-{n}.log`.

**Format:**

```
===STAGE_RESULT===
{"stage":"CONTRACT","status":"pass"|"fail","failureClass":"step_error"|"gate_abort"|"infrastructure_error","reason":"...","artifacts":["path1","path2"]}
```

**Rules:**
- If the dispatcher cannot emit `===STAGE_RESULT===` (crash, DLQ, timeout),
  the watchdog treats the run as `infrastructure_error`.
- `failureClass` maps directly to `RunErrorClass`. The DLQ consumer reads
  this field from `KEY_RESULT` in RunCoordinator storage when issuing
  `/force-complete`.
- The delimiter is a human grep aid for log files, not machine input. It
  is NOT embedded in the `/stage-complete` POST body (the POST already
  carries a typed `result` object).

**Why this matters.** Pipeline triage today requires loading the full
event stream to determine whether a stage completed. With
`===STAGE_RESULT===`, a single `wrangler r2 object get
runs/{runId}/logs/PATCH/attempt-1.log | tail -2` answers "did this attempt
finish, and how?"

### 9.5 `harness-dlq` consumer pattern

New file: `workers/ff-pipeline/src/harness-dlq-consumer.ts`. Per
`observability-pipeline-spec.md` §4B:

```typescript
export async function consumeHarnessDlq(
  batch: MessageBatch<HarnessQueueMessage>,
  env: HarnessBridgeEnv,
): Promise<void> {
  for (const msg of batch.messages) {
    const { runId, stageName } = msg.body
    try {
      const doId = env.RUN_COORDINATOR.idFromName(runId)
      const stub = env.RUN_COORDINATOR.get(doId)
      await stub.fetch('https://run-coordinator/force-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: {
            overall: 'fail',
            finalStage: stageName,
            reason: `Stage ${stageName} dead-lettered after queue retries exhausted.`,
            failureClass: 'dlq_exhausted',
          },
          reason: 'dlq',
        }),
      })
      // Emit dlq_recovered event via RunEventLog
      msg.ack()
    } catch (err) {
      if (msg.attempts >= 1) msg.ack()
      else msg.retry()
    }
  }
}
```

**Wiring** (`workers/ff-pipeline/src/index.ts`):

```typescript
if (batch.queue === 'harness-dlq') {
  const { consumeHarnessDlq } = await import('./harness-dlq-consumer.js')
  await consumeHarnessDlq(batch, env as HarnessBridgeEnv)
  continue
}
```

**Wrangler binding** (`wrangler.jsonc`):

```jsonc
"consumers": [
  { "queue": "harness-queue", "max_batch_size": 1, "max_retries": 3,
    "dead_letter_queue": "harness-dlq" },
  { "queue": "harness-dlq", "max_batch_size": 10, "max_retries": 1 }
]
```

**Idempotency.** RunCoordinator's `/force-complete` checks `KEY_RESULT`
first. If a natural completion already won the race, force-complete is a
no-op. CF Workflows `step.waitForEvent` is consume-once; extra
`harness-complete` sends are silently dropped. The combination is safe.

### 9.6 Watchdog cron

New file: `workers/ff-pipeline/src/observability/watchdog.ts`. Wired into
the existing `*/5 * * * *` cron via
`ctx.waitUntil(scanForStuckRuns(env))`.

**Threshold model.** Global fallback 30 minutes + per-stage YAML overrides:

```typescript
const DEFAULT_STUCK_THRESHOLD_MS = 30 * 60 * 1000
const STAGE_THRESHOLDS_MS: Record<string, number> = {
  SEED:     5  * 60 * 1000,
  CONTRACT: 15 * 60 * 1000,
  MAP:      20 * 60 * 1000,
  PATCH:    30 * 60 * 1000,
  VERIFY:   60 * 60 * 1000,
}
```

**Scan flow:**
1. Load `runs/_active-index.json` from R2 (etag-conditional read).
2. For each active runId, read `_summary.json`.
3. Look up per-stage threshold or fall back to global.
4. If `now - lastEventAt > threshold` and `status === 'running'`, call
   `/force-complete` with `reason: watchdog_stuck`.
5. Emit `stuck_detected` event.
6. Remove from active index via conditional put (`If-Match`).

Harness YAML may override stage thresholds via
`runtime.stage_watchdog_minutes`.

### 9.7 `/run-status/:runId` operator endpoint

`GET /run-status/:runId` reads `runs/{runId}/events/_summary.json` from R2
(single object, fast) and returns the `RunSummary` as JSON. Optional
parameters:

- `?events=true` — returns newest 20 events
- `?logs=STAGENAME` — streams the latest attempt log for the named stage

No wrangler access required. This is the operator's primary triage
surface.

### 9.8 Container stderr drain

Three layers per `observability-pipeline-spec.md` §5:

1. `GET /logs/tail` in `pi-container/server.mjs` — exposes the in-memory
   stderr ring buffer (already exists as `MAX_STDERR_TAIL_BYTES`).
2. DO-side periodic drain — after every stage response,
   `ctx.waitUntil(drainLogs(runId, stageName))` writes the buffer to
   `runs/{runId}/artifacts/__observability/{stageName}.pi-stderr.jsonl`.
3. Crash detection — replace the swallowing
   `monitor().catch(() => {})` with explicit emit:
   ```typescript
   this.ctx.container.monitor().then(
     () => this.emitContainerCrash(runId, stageName, 'exited normally'),
     (err) => this.emitContainerCrash(runId, stageName, err.message),
   )
   ```

Threading `runId`: extract from inbound request body before forwarding to
container. The container itself does not know `runId` — that is by design,
to keep the container stateless.

---

## 10. Implementation Priority Order

The eight-item priority order from `CODING-ADAPTER-MULTIAGENT-PROPOSALS.md`,
updated with research-synthesis findings and infrastructure bugs:

| # | Item | Type | Blocker | Effort |
|---|------|------|---------|--------|
| 1 | Bug 1: Move `buildStageContextForRun` inside try block | Code fix at `harness-dispatcher.ts:324` | Hard infra | 5 min |
| 2 | Bug 2: `notifyWorkflowComplete` retry on sendEvent failure | Code fix at `run-coordinator.ts:275` | Hard infra | 30 min |
| 3 | Bug 3: DLQ consumer + `/force-complete` | New files + `wrangler.jsonc` | Hard infra | 2 h |
| 4 | Fix `test_results_support_claims` gate failure | Prompt change in VERIFY role | Production blocker on autonomous Pi | 30 min |
| 5 | Add explicit hunk context instruction to PATCH prompt (Proposal A2) | Prompt change in PATCH role | DEFECT-1 partial mitigation | 30 min |
| 6 | `PI_VERIFIER_MODEL_CANDIDATES` env var (Proposal E fast path) | `harness-dispatcher.ts` change | Quality improvement | 1 h |
| 7 | Two-stage critic loop (A-NEW-1, replaces N-parallel) | New `SpecComplianceCritic` + `CodeQualityCritic` roles, dispatcher wiring | Requires NLAH contribution #2 for full repair semantics | 1-2 days |
| 8 | Gate failure feedback → `gateFailureContext` (Proposal C) | RunCoordinator + dispatcher changes | Requires NLAH contribution #2 | 0.5 day |
| 9 | ToolGuardrail DO-storage circuit breaker (A-NEW-2) | New `tool-guardrail.ts` module | Unblocked | 1 day |
| 10 | Four-gate taxonomy vocabulary adoption (A-NEW-3) | Dispatcher classification + RunSummary projection | Schema extension blocked on NLAH; vocabulary unblocked | 0.5 day |
| 11 | Forensic layer + `PI_WRITE_SAFE_ROOT` (A-NEW-4) | New `patch-sanitizer.ts` + tool wrapper update | Unblocked | 1 day |
| 12 | Return-to-PATCH repair loop with gate error payload (Proposal A1, full DEFECT-1 fix) | NLAH #2 + dispatcher repair wiring | Requires NLAH #2 + item 8 | 0.5 day after #8 |

### 10.1 What is blocked on NLAH upstream contribution #2

NLAH v0.2 Phase 3 (failure semantics — `FailureAction` discriminated union
+ `return_to_stage` + `max_stage_attempts` budget) is the load-bearing
upstream dependency for:

- Item 7 (two-stage critic loop) — needs `return_to_stage` to send the
  critic's `gateFailureContext` back to PATCH.
- Item 8 (`gateFailureContext` payload) — needs the upstream `StageResult`
  type to carry the payload field.
- Item 12 (full DEFECT-1 fix) — chains on items 7 and 8.

Upstream contribution timeline is owned by the NLAH maintainer (Wes). Until
it lands, the Factory can ship items 1-6, 9, 10, 11 — which is enough to
fix every infrastructure bug and ship the ToolGuardrail, forensic layer,
and gate taxonomy. The quality-critical multi-agent items are gated on
NLAH.

### 10.2 What is unblocked today

Items 1, 2, 3, 4, 5, 6, 9, 10, 11. The recommended order is:

1. Bug 1 first — it is a 5-minute change with the highest hang-prevention
   value.
2. Bug 2 + Bug 3 next — they close the infrastructure loop. Until both land,
   any run that hits Bug 1 still hangs.
3. Items 4, 5 — prompt-only changes, low risk, immediate value on
   autonomous Pi runs.
4. Item 6 — env-var change, makes VERIFY independent of PATCH model.
5. Items 9, 10, 11 — substantial new code. Should land with Critic-agent
   review before deploy per memory entry `feedback_critic_before_deploy`.

After items 1-6, 9, 10, 11 ship, the architecture is ready for the
NLAH-gated quality work in items 7, 8, 12.

---

## 11. Open Architecture Gates

Each gate names the question, the people whose decision unblocks it, and
the current best-evidence position.

### Q3 — picomatch + rename detection

**Question.** Confirm `picomatch ^4.0.0` as the canonical TypeScript glob
library for the preventive write-scope layer, and confirm the both-paths-
match rule for renames.

**Evidence.** Research synthesis identified picomatch as TypeScript-native
with full gitignore-style semantics and brace expansion. Both-paths-match
is Codex CLI's enforcement rule.

**Decision required from:** Wes (library choice signoff). The both-paths-
match rule is mechanical; no decision needed beyond the library.

**Default if unblocked:** Adopt picomatch ^4.0.0. Both-paths-match is the
rule.

### Q7 — GitHub App tokens (PR creation)

**Question.** Confirm single-tenant token model for PR creation (one
GITHUB_APP_INSTALLATION_ID per Worker deployment) versus multi-tenant
(installation IDs in D1 per FunctionJob).

**Evidence.** Research synthesis adopted Sweep's pattern: Worker-side Git
Data API, token never leaves the Worker, container has no git access. The
single-tenant model is the simplest implementation and forward-compatible
with multi-tenant.

**Decision required from:** Wes (tenancy roadmap).

**Default if unblocked:** Single-tenant for bootstrap. Migrate to
multi-tenant when the Factory serves >1 user.

### Q10 — synthesis fixture removal

**Question.** When does the synthesis pipeline stop using a Pi-output
fixture and start using live Pi runs end-to-end?

**Evidence.** Synthesis runs via the `synthesis.harness.yaml` (per
ADR-009 §4 Phase 5). That harness is blocked on NLAH v0.2 Phase 3
(failure semantics — `return_to_stage`). The current fixture path is a
bootstrap shim.

**Decision required from:** Wes (when to declare NLAH v0.2 Phase 3 ready
to integrate).

**Default if unblocked:** Replace fixture with live Pi run within one
release cycle of NLAH v0.2 Phase 3 landing.

### Q12 — forensic layer (Sweep-style strip-and-warn)

**Question.** Is strip-and-warn (drop unauthorized paths, continue with
warning) the right policy, or should the forensic layer abort the run?

**Evidence.** Sweep's production policy is strip-and-warn. Aborting on a
forensic drop makes the system fragile to SeedWorkspace mis-specification
and creates a perverse incentive to over-broaden write scope. The
strip-and-warn pattern records the drop as a Signal and lets the run
continue with the sanitized output.

**Decision required from:** Wes (policy signoff).

**Default if unblocked:** Strip-and-warn for the forensic layer. Layer 3
(substrate) is the only terminal write enforcement.

### A-NEW-1 — Single PATCH + two-stage critic loop

**Question.** Adopt the hermes two-stage critic (Spec Compliance Reviewer
→ Code Quality Reviewer) as the canonical multi-agent shape, replacing
the implicit N-parallel-PATCH direction in the prior proposal set?

**Evidence.** SWE-bench top performers (Verdent 76.1%) explicitly disclaim
parallel-sample-and-rank. Sequential repair with reviewer is dominant.
The hermes pattern is a clean operational expression of the same idea.

**Decision required from:** Wes (architectural direction).

**Default if approved:** Build §4.2 pipeline. Two new roles, two
internal sub-spawns per PATCH stage, repair via `gateFailureContext`.

### A-NEW-2 — ToolGuardrail DO-native circuit breaker

**Question.** Port hermes `tool_guardrails.py` to DO storage as the
infinite-loop safety net?

**Evidence.** No prior Factory primitive prevents Pi tool-call loops
short of the queue retry budget (3 retries). Without a per-call guardrail,
a Pi instance that loops on a failing tool can burn the entire
`max_repair_rounds` budget without producing any useful signal.

**Decision required from:** Wes (do we want this circuit breaker?).

**Default if approved:** Build §8 module. Unblocked today.

### A-NEW-3 — Four-gate taxonomy adoption

**Question.** Adopt hermes four-gate vocabulary (Pre-flight / Revision /
Escalation / Abort) in the harness DSL?

**Evidence.** The vocabulary is mutually exclusive, operator-visible, and
correctly classifies every existing harness gate. It cleanly distinguishes
"loop back and try again" from "stop the world."

**Decision required from:** Wes (DSL change) AND NLAH maintainer (schema
extension).

**Default if approved:** Wire vocabulary in dispatcher via name lookup
today (unblocked). Land schema extension upstream when NLAH is ready
(blocked on NLAH).

### A-NEW-4 — `PI_WRITE_SAFE_ROOT` + `validate_within_dir()`

**Question.** Add a Container-side env var (`PI_WRITE_SAFE_ROOT`) and a
symlink-resolving traversal check (`validate_within_dir`) as the
substrate-layer write-scope enforcement?

**Evidence.** Hermes ships exactly this contract:
`HERMES_WRITE_SAFE_ROOT` env var, `path_security.py::validate_within_dir`.
The Factory's container today relies implicitly on the tmpdir structure;
making it explicit closes the substrate layer (Layer 3 in §3.4).

**Decision required from:** Wes (substrate hardening signoff).

**Default if approved:** Build into `pi-container/server.mjs` tool
wrapper. Unblocked today.

---

## 12. Invariants Register

### 12.1 Core invariants (CODING-ADAPTER-MULTIAGENT-PROPOSALS §Invariants)

**INV-CODING-01** — A CandidatePatch that fails `patch_applies_cleanly`
MUST NOT reach VERIFY. Either a repair round brings it back into
compliance or the run is marked `patch_does_not_apply` and halted.

**INV-CODING-02** — VERIFY must run in a Pi subprocess that has NOT
previously seen the CandidatePatch content within the same session. Each
stage spawns a fresh Pi — currently satisfied by `startPi` creating a
new subprocess per `/execute` call (`server.mjs:592`).

**INV-CODING-03** — `VerifierReport` must contain `## Tests run` with
captured test command output before the `test_results_support_claims`
gate passes. The gate is the enforcement point; the prompt is the
authoring guide.

**INV-CODING-04** — The Verifier role (VERIFY stage) must not be the same
model instance that authored the CandidatePatch when a Verifier-specific
model list is configured. Correlated model failure between PATCH and
VERIFY reduces independent verification to a formality.

**INV-CODING-05** — Repair loop budget (`max_repair_rounds`) applies
across both contract-repair turns and gate-failure-repair turns combined.
Total Pi inference budget per stage is bounded.

### 12.2 New invariants from this document

**INV-CODING-06** (from §3.4, substrate layer) — A Pi subprocess MUST NOT
have any path to write R2 outside the declared per-stage output prefixes.
Enforced by `pi-container.ts::writeStageArtifact()`. A Layer 3 firing is
a high-severity Signal.

**INV-CODING-07** (from §3.3, forensic layer) — Every file in a
CandidatePatch MUST be either declared in the SeedWorkspace `files[]`
manifest or in the IssueContract's declared FCR set. Files outside both
sets are stripped by `patch-sanitizer.ts` and recorded as a
counterfactual.

**INV-CODING-08** (from §4.5, LangGraph rule) — Critic stages MUST NOT
write to R2. Critic output flows through the dispatcher as in-memory
`CriticReport` values, merged by the dispatcher into a single
`gateFailureContext` if either critic returns `REQUEST_CHANGES`.

**INV-CODING-09** (from §4.3, ToolGuardrail) — Per `(runId, stageId)`,
no Pi tool call signature may fire more than 5 times with failure
results, and no tool name may fire more than 8 times with no-progress
signatures. Beyond either threshold, the stage is halted with
`failure_taxonomy: budget_exceeded`.

**INV-CODING-10** (from §6.6, PR creation) — The Pi container MUST NOT
hold a GitHub installation token, MUST NOT have outbound git access, and
MUST NOT create branches or push commits. All git remote interaction is
performed by the Worker, never by the agent runtime.

**INV-CODING-11** (from §7.3, reset pattern) — Every PATCH attempt MUST
operate on a clean unpack of the SeedWorkspace. There is no incremental
state between stages or between attempts of the same stage. The
container's `handleExecute` is responsible for the reset.

**INV-CODING-12** (from §9.4, terminal contract) — Every stage that
returns from the dispatcher MUST write a `===STAGE_RESULT===` JSON block
as the final line of its attempt log. Absence of the marker is detected
by the watchdog and classified as `infrastructure_error`.

---

## 13. Appendix A — Glossary

| Term | Meaning |
|------|---------|
| **Pi** | The agent runtime — `earendil-works/pi` v0.74.1. Spawned as a subprocess inside the Container per stage invocation. |
| **ofox.ai** | The model routing layer between Pi and the LLM providers. Cost-driven decision; see memory entry `feedback_ofox_stays_for_cost`. |
| **CandidatePatch** | The unified diff Pi produces in the PATCH stage. Subject to `patch_applies_cleanly` gate. |
| **FinalPatch** | The verified diff Pi produces in the RELEASE stage (typically a copy of CandidatePatch). Used by the Worker for PR creation. |
| **PRSummary** | Markdown summary Pi produces in the RELEASE stage. Title + body for the GitHub PR. |
| **SeedWorkspace** | JSON snapshot of the working tree. Every stage operates on a fresh unpack of this snapshot. |
| **IssueContract** | Markdown artifact produced by CONTRACT stage. Contains the issue text, acceptance criteria, and (for real-repo runs) `TargetRepo` / `BaseBranch` / `BaseCommit`. |
| **VerifierReport** | Markdown artifact produced by VERIFY stage. Must contain `## Tests run` heading with command output. |
| **gateFailureContext** | Typed payload carried from a failed gate back to the authoring stage on a repair turn. Defined in §4.6. |
| **ToolGuardrail** | DO-storage-backed circuit breaker against Pi tool-call loops. Defined in §8. |
| **AgentRegistry** | DO-side primitive that caps concurrent sub-agents and spawn depth. Defined in §4.4. |
| **NLAH** | The harness runtime substrate. Lives at `/Users/wes/nlah`. See ADR-009. |
| **Four-gate taxonomy** | Hermes-derived classification: Pre-flight / Revision / Escalation / Abort. See §5. |
| **Three-layer write scope** | Preventive (Aider) / Forensic (Sweep) / Substrate (Container). See §3. |
| **R2** | Cloudflare's object store. The Factory's authoritative durable artifact layer. |
| **DO storage** | Cloudflare Durable Object storage. Per-DO key-value store with strong consistency. Used for transient stage state and ToolGuardrail counters. |
| **harness-queue / harness-dlq** | The Queue and Dead-Letter Queue between RunCoordinator (producer) and harness-dispatcher (consumer). |

---

## 14. Appendix B — File Index

### Source files (existing)

| Path | Role |
|------|------|
| `harnesses/coding-adapter.harness.yaml` | The pipeline topology — canonical source of truth for stage graph and gates |
| `workers/ff-pipeline/src/harness-bridge.ts` | `startHarnessRun()` — seeds R2 artifacts, calls RunCoordinator `/init`, emits intent-phase events |
| `workers/ff-pipeline/src/harness-dispatcher.ts` | Queue consumer for `harness-queue`. `dispatchOne()` at `:309`. Contains Bug 1 at `:324`. |
| `workers/ff-pipeline/src/coordinator/run-coordinator.ts` | DO holding `HarnessState`. `notifyWorkflowComplete` at `:275`. Contains Bug 2. |
| `workers/ff-pipeline/src/coordinator/pi-container.ts` | DO managing the Pi container lifecycle. Container monitor + stderr drain |
| `workers/ff-pipeline/pi-container/server.mjs` | The container HTTP server. `handleExecute` at `:500`. `startPi` at `:592`. Repair injection at `:792`. |
| `workers/ff-pipeline/wrangler.jsonc` | Worker config. DLQ binding at `:68` (Bug 3 — no consumer) |
| `workers/ff-pipeline/src/index.ts` | Worker fetch + queue dispatch |

### Source files (new — required by this document)

| Path | Role | Section |
|------|------|---------|
| `workers/ff-pipeline/src/harness-dlq-consumer.ts` | DLQ consumer | §9.5 |
| `workers/ff-pipeline/src/observability/run-events.ts` | RunEvent + RunSummary + Counterfactual types | §9.2 |
| `workers/ff-pipeline/src/observability/run-event-log.ts` | `RunEventLog` class — best-effort emit | §9.3 |
| `workers/ff-pipeline/src/observability/watchdog.ts` | `scanForStuckRuns` | §9.6 |
| `workers/ff-pipeline/src/path-guard.mjs` | Preventive write-scope guard (picomatch) | §3.2 |
| `workers/ff-pipeline/src/patch-sanitizer.ts` | Forensic write-scope sanitizer | §3.3 |
| `workers/ff-pipeline/src/coordinator/tool-guardrail.ts` | ToolGuardrail DO-storage circuit breaker | §8 |
| `workers/ff-pipeline/src/coordinator/agent-registry.ts` | Bounded sub-agent registry | §4.4 |
| `workers/ff-pipeline/src/release/github-pr-create.ts` | PR creation via Git Data API | §6 |

### Reference documents

| Path | Role |
|------|------|
| `specs/reference/CODING-ADAPTER-MULTIAGENT-PROPOSALS.md` | Architect's prior proposals (A1, A2, B-F, E fast-path), 5 invariants, 8-item priority order |
| `specs/reference/MULTIAGENT-RESEARCH-SYNTHESIS.md` | 8-system research findings; critical reversal on N-parallel-PATCH; 6 confirmed patterns; 4 new proposals (A-NEW-1..4) |
| `specs/reference/observability-pipeline-spec.md` | RunEvent schema, RunSummary, DLQ consumer, watchdog, container drain, `/run-status/:runId` |
| `specs/reference/observability-se-diagnosis.md` | Three critical infrastructure bugs with file:line references |
| `specs/reference/ADR-009-nlah-runtime-replaces-state-graph.md` | NLAH as the harness runtime substrate; upstream contribution roadmap |
| `specs/reference/FF-RUN-ARTIFACT-SPEC.md` | Local-FS package layout for runs (00_intent / 01_plan / …) |
| `.agent/memory/working/PI_PRODUCTION_DEFECTS.md` | DEFECT-1, DEFECT-2, DEFECT-3 (closed), DEFECT-4; pi-operational-mpbze86c proof point |

### Memory entries (Wes's standing orders relevant to this surface)

| Memory key | Why it matters here |
|------------|---------------------|
| `feedback_propose_bless_review_gate` | GUV proposes; Architect blesses; Engineer executes. GUV does not write code. |
| `feedback_critic_before_deploy` | Critic reviews code BEFORE deploy. No skipping. |
| `feedback_deployment_gate_protocol` | 9-step deployment gate is law. |
| `feedback_event_driven_default` | Event-driven patterns investigated first. RPC is fallback. |
| `feedback_verify_apis_from_authority_sources` | Every API claim cites a source URL. |
| `feedback_review_every_factory_artifact` | Every spec/design gets Architect review. |
| `feedback_3_strikes_architect_takes_over` | After 3 failed iterations, stop and spawn Architect for root cause. |
| `feedback_quality_over_speed` | Speed is not a systems requirement during bootstrap. |
| `feedback_ofox_stays_for_cost` | ofox.ai retained for pi container model routing. |
| `feedback_codex_owns_coding` | Codex does all coding and debugging. GUV orchestrates and reports. |
| `feedback_read_code_before_speccing` | Grep/read actual source before any spec references existing names. |

---

## End of canonical reference

This document is the single source of truth for the Function Factory
coding pipeline as of 2026-05-18. It supersedes any prior partial design
notes. Updates to this document SHOULD be PRs against this file with
`META:` commit prefix and Architect review.

Any future agent reading this document and finding a divergence from the
running code SHOULD treat the running code as suspect (not this document)
until the Architect reviews. If the divergence is intentional (new
decision), the document must be amended; if unintentional (drift), the
code must be brought back into alignment.

The Factory builds the Factory. This document is part of how it knows
what it is building.
