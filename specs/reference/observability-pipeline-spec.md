# Harness Pipeline Observability Spec

**Status:** Pending approval — awaiting Wes sign-off  
**Authored by:** Architect agent 2026-05-18  
**Reviewed by:** SE agent 2026-05-18 · AutoGo Architect review incorporated 2026-05-18  
**Lineage:** FN-SYNTH-MIGRATE / IS-HARNESS-DSL-v1  
**Aligned with:** FF-RUN-ARTIFACT-SPEC (packages layer), AutoGo temporal run envelope pattern  

---

## 0. Diagnosed silent-failure surfaces

| # | Surface | File:Line | Today's behavior | Stuck-workflow outcome |
|---|---------|-----------|------------------|------------------------|
| A | `seedInitialArtifacts` R2 puts | `harness-bridge.ts:107,142-161` | No try/catch; throws bubble to step.do (3 retries) but partial put leaves R2 inconsistent | Dispatcher fails on missing artifact → retries exhaust → DLQ → stuck |
| B | RunCoordinator `/init` HARNESS_QUEUE.send | `run-coordinator.ts:123-128` | KEY_DISPATCHED written after send; idempotency guard handles re-entry | Not the stuck path |
| C | `harness-queue` consumer crash | `index.ts:1418-1446` + `harness-dispatcher.ts` | **`harness-dlq` has no consumer.** Messages that exhaust 3 retries vanish. | **Workflow waits 7 days. Canonical stuck path.** |
| D | `buildStageContextForRun` called BEFORE try block | `harness-dispatcher.ts:324` | Throw escapes dispatchOne entirely — not captured as workerThrew | 3 retries → DLQ → no harness-complete → stuck |
| E | `notifyWorkflowComplete` sendEvent failure | `run-coordinator.ts:275-302` | Logs `[INFRA SIGNAL]` and swallows. No retry. | Workflow waits 7 days even though run terminated |
| F | Pi container stderr / crash | `pi-container.ts:36-69`, `server.mjs` | stderr visible only inside container; monitor().catch(()=>{}) swallows crashes | Cause invisible |
| G | Stage lifecycle events | nowhere | No durable trace of dispatched→started→completed per stage | Can't answer "which stage is current?" |

---

## 1. Event schema — `RunEvent` (R2-durable, append-only)

```ts
// src/observability/run-events.ts

// Stage taxonomy aligns with FF-RUN-ARTIFACT-SPEC: intent | plan | execution | eval | report
export type RunStage = "intent" | "plan" | "execution" | "eval" | "report"

export type RunEventType =
  // bridge-side (intent + plan phases)
  | "run_started"           // maps to FF-RUN-ARTIFACT-SPEC intent phase entry
  | "seed_written"
  | "seed_failed"
  | "harness_loaded"        // plan phase: harness compiled + completeness verified
  | "run_coordinator_initialized"
  // dispatcher-side (execution phase)
  | "stage_dispatched"
  | "stage_started"
  | "worker_executed"
  // eval phase — ontological gate names per FF-ONTOLOGY-ADDENDUM
  | "coherence_verified"
  | "fidelity_verified"
  | "persistence_verified"
  | "gate_evaluated"          // generic harness-level gate (non-coverage gates)
  | "stage_completed"
  | "stage_failed"
  // report phase — aligns with FF-RUN-ARTIFACT-SPEC 05_report/
  | "counterfactual_recorded" // what was NOT tried and why
  | "harness_complete"
  | "workflow_notified"
  | "workflow_notify_failed"
  // recovery
  | "dlq_recovered"
  | "stuck_detected"
  // container-side
  | "container_started"
  | "container_stderr_flush"
  | "container_crashed"

export interface RunEvent {
  schemaVersion: "1.0"
  eventId: string           // ULID — sortable
  runId: string
  workflowId?: string
  stageName?: string
  attemptNumber?: number    // 1-based; present on stage_dispatched + stage_started
  type: RunEventType
  timestamp: string         // ISO-8601
  data: Record<string, unknown>
  error?: {
    code?: string
    message: string
    stack?: string          // truncated to 2KB
  }
  emitter: "harness-bridge" | "run-coordinator" | "harness-dispatcher" | "pi-container" | "dlq-consumer" | "watchdog"
}
```

**Storage layout (R2 — CF runtime layer):**
```
runs/{runId}/events/{timestamp}-{eventId}.json       ← one object per event (append-only)
runs/{runId}/events/_summary.json                    ← rolling RunSummary snapshot
runs/{runId}/logs/{stageName}/attempt-{n}.log        ← per-stage, per-attempt log (attempt-headered)
runs/{runId}/artifacts/__observability/{stageName}.pi-stderr.jsonl
runs/_active-index.json                              ← watchdog scan list
```

**Alignment with FF-RUN-ARTIFACT-SPEC local-FS layout:**
```
runs/<YYYY-MM-DD>_<HHMM>_<slug>/
  00_intent/        ← run_started + harness_loaded events
  01_plan/          ← run_coordinator_initialized event
  02_execution/     ← stage_dispatched/started/worker_executed events → commands.log, errors.log
  03_traces/        ← decision_trace.jsonl (mirrors RunEvent stream)
  04_eval/          ← coherence_verified / fidelity_verified / persistence_verified events
  05_report/        ← harness_complete event → report.md + counterfactuals.md
  artifacts/        ← existing runs/{runId}/artifacts/
```
The two layers (R2 runtime + local FS packages) share the same phase taxonomy and event names. The R2 layer is the authoritative runtime record; the local FS layer is the human-readable development artifact.

---

## 1a. `===STAGE_RESULT===` terminal contract (AutoGo pattern)

Every stage dispatch that sends a response MUST include a `===STAGE_RESULT===` delimiter line followed by a JSON result block. This is the canonical signal that separates "stage ran and produced output" from "stage hung or produced garbage."

**Format (emitted by harness-dispatcher after worker_executed):**
```
===STAGE_RESULT===
{"stage":"CONTRACT","status":"pass"|"fail","failureClass":"step_error"|"gate_abort"|"infrastructure_error","reason":"...","artifacts":["path1","path2"]}
```

**Rules:**
- If the dispatcher cannot emit `===STAGE_RESULT===` (crash, DLQ, timeout), the watchdog treats the run as `infrastructure_error`.
- `failureClass` maps directly to `RunErrorClass` — the DLQ consumer reads this field from `KEY_RESULT` in RunCoordinator storage when issuing `/force-complete`.
- The result block is written to `runs/{runId}/logs/{stageName}/attempt-{n}.log` as the final line, enabling grep-based triage without loading the full event stream.

---

## 1b. Attempt-headered per-stage logs

Each stage attempt writes to its own log file in R2. The log begins with a structured header:

```
=== STAGE: CONTRACT  ATTEMPT: 1  STARTED: 2026-05-18T14:00:00Z ===
... worker stdout/stderr ...
===STAGE_RESULT===
{"stage":"CONTRACT","status":"fail","failureClass":"step_error","reason":"..."}
```

**Path:** `runs/{runId}/logs/{stageName}/attempt-{n}.log`  
**Written by:** harness-dispatcher, streamed during execution, finalized with `===STAGE_RESULT===` on completion.  
**Benefit:** A single `wrangler r2 object get` gives the full execution context for any specific attempt without scanning the event stream.

---

## 1c. Counterfactual class enum

Counterfactuals are first-class records per AutoGo pattern. Every decision NOT to execute a stage branch must be recorded.

```ts
export type CounterfactualClass =
  | "model_candidate_skipped"   // tool-capability-probe failed; fell back to next candidate
  | "stage_branch_not_taken"    // harness declared conditional branch; condition was false
  | "retry_budget_exhausted"    // no more retries; proceeding without this stage's output
  | "gate_early_exit"           // coherence/fidelity/persistence gate aborted before all checks
  | "watchdog_terminated"       // watchdog force-completed before stage could run

export interface Counterfactual {
  class: CounterfactualClass
  what: string    // what was not tried
  why: string     // why it was skipped
  at: string      // ISO-8601
}
```

Counterfactuals accumulate in `RunSummary.counterfactuals` and are flushed to `05_report/counterfactuals.md` at harness_complete.

---

## 2. RunSummary shape

```ts
export type RunStatus =
  | "running"
  | "coherence_blocked"
  | "fidelity_blocked"
  | "persistence_blocked"
  | "completed"
  | "failed"
  | "stuck"                 // watchdog detected — no events > threshold
  | "dlq_recovered"         // synthetic completion via DLQ consumer

// Error taxonomy (AutoGo pattern — distinguish infra failures from step failures)
export type RunErrorClass =
  | "infrastructure_error"  // CF/DO/container died — reschedule candidate
  | "step_error"            // agent ran but produced bad output — not retriable same way
  | "gate_abort"            // gate evaluated and rejected — terminal
  | "dlq_exhausted"         // queue retries exhausted
  | "watchdog_stuck"        // no progress detected

export interface RunSummary {
  schemaVersion: "1.0"
  runId: string
  slug: string                // kebab from harnessKey — aligns with FF-RUN-ARTIFACT-SPEC naming
  workflowId?: string
  status: RunStatus
  // FF-RUN-ARTIFACT-SPEC stage taxonomy
  currentPhase?: RunStage     // intent | plan | execution | eval | report
  currentStage?: string       // harness stage name (SEED, CONTRACT, MAP, PATCH, VERIFY, RELEASE)
  lastEventType: RunEventType
  lastEventAt: string
  lastError?: { code?: string; message: string }
  stageHistory: Array<{
    stage: string
    phase: RunStage
    verdict: "pass" | "fail" | "in_progress"
    attempts: number          // how many attempts this stage took
    at: string
  }>
  // Verification results — ontological names
  verificationResults?: {
    coherence?: { status: "pass" | "blocked" | "warn"; at: string }
    fidelity?: { status: "pass" | "blocked" | "warn"; at: string }
    persistence?: { status: "pass" | "blocked" | "warn"; at: string }
  }
  // AutoGo tri-state: ok / failed / never_dispatched (not just pass/fail)
  stepAccounting?: {
    ok: string[]
    failed: string[]
    neverDispatched: string[]   // steps enqueued but never picked up
  }
  errorClass?: RunErrorClass
  // Counterfactual record — aligns with FF-RUN-ARTIFACT-SPEC 05_report/counterfactuals.md
  counterfactuals?: Counterfactual[]
  startedAt: string
  terminalAt?: string
  eventCount: number
}
```

**`RunEventLog` class** (`src/observability/run-event-log.ts`):
- `emit(event)` — best-effort: failures MUST NOT throw upstream
- Writes one R2 object per event + updates `_summary.json`
- Appends to `runs/{runId}/logs/{stageName}/attempt-{n}.log` for stage lifecycle events
- On `run_started`: adds runId to `runs/_active-index.json`
- On terminal events: removes runId from active index

---

## 3. Instrumentation plan — where each event is written

| Event | File | Insertion point |
|-------|------|-----------------|
| `run_started` | `harness-bridge.ts` | After R2 YAML load, before parse |
| `harness_loaded` | `harness-bridge.ts` | After completeness verification (line 99) |
| `seed_written` / `seed_failed` | `harness-bridge.ts` | Wrap each `bucket.put` in try/catch |
| `run_coordinator_initialized` | `harness-bridge.ts` | After `/init` 2xx (line 137) |
| `stage_dispatched` | `run-coordinator.ts` | After every `HARNESS_QUEUE.send` (lines 123, 232); include `attemptNumber` |
| `stage_started` | `harness-dispatcher.ts` | After fetching compiled+state (line 315); open attempt log |
| `worker_executed` | `harness-dispatcher.ts` | After try/catch around adapter.execute (line 374); write `===STAGE_RESULT===` |
| `gate_evaluated` | `harness-dispatcher.ts` | After gate loop (line 489) — summary with allPassed, per-gate verdicts |
| `stage_completed` / `stage_failed` | `harness-dispatcher.ts` | After `/stage-complete` response check |
| `counterfactual_recorded` | `harness-dispatcher.ts` | Any branch-not-taken, model-skipped, retry-exhausted decision |
| `harness_complete` | `run-coordinator.ts` | Inside complete/fail arm (line 243) |
| `workflow_notified` / `workflow_notify_failed` | `run-coordinator.ts` | After `sendEvent` try/catch |
| `dlq_recovered` | `src/harness-dlq-consumer.ts` (NEW) | At synthetic-complete dispatch |
| `stuck_detected` | `src/observability/watchdog.ts` (NEW) | When scan flags a run |
| `container_started` / `container_crashed` | `pi-container.ts` | container.start + monitor() |
| `container_stderr_flush` | `pi-container.ts` + `server.mjs` | Periodic drain via GET /logs/tail |

---

## 4. DLQ fix — synthetic harness-complete from harness-dlq

**Root cause:** `wrangler.jsonc:68` declares `"dead_letter_queue": "harness-dlq"` but no consumer is bound.

### A. `wrangler.jsonc` — add DLQ consumer
```jsonc
"consumers": [
  { "queue": "harness-queue", "max_batch_size": 1, "max_retries": 3, "dead_letter_queue": "harness-dlq" },
  { "queue": "harness-dlq", "max_batch_size": 10, "max_retries": 1 }   // NEW
]
```

### B. New file: `src/harness-dlq-consumer.ts`
```ts
export async function consumeHarnessDlq(
  batch: MessageBatch<HarnessQueueMessage>,
  env: HarnessBridgeEnv,
): Promise<void> {
  for (const msg of batch.messages) {
    const { runId, stageName } = msg.body
    try {
      // 1. POST /force-complete to RunCoordinator — unblocks the Workflow
      const doId = env.RUN_COORDINATOR.idFromName(runId)
      const stub = env.RUN_COORDINATOR.get(doId)
      await stub.fetch("https://run-coordinator/force-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: {
            overall: "fail",
            finalStage: stageName,
            reason: `Stage ${stageName} dead-lettered after queue retries exhausted.`,
            failureClass: "dlq_exhausted",
          },
          reason: "dlq",
        }),
      })
      // 2. Emit dlq_recovered event (via RunEventLog)
      msg.ack()
    } catch (err) {
      if (msg.attempts >= 1) msg.ack()
      else msg.retry()
    }
  }
}
```

### C. `run-coordinator.ts` — add `/force-complete` endpoint
```ts
// New handler: checks KEY_RESULT first (idempotent), then calls notifyWorkflowComplete
private async handleForceComplete(request: Request): Promise<Response>
```

Idempotency: checks `KEY_RESULT` first. If natural completion already won, force-complete is a no-op.

### D. `src/index.ts` — wire DLQ consumer
```ts
if (batch.queue === 'harness-dlq') {
  const { consumeHarnessDlq } = await import('./harness-dlq-consumer.js')
  await consumeHarnessDlq(batch, env as HarnessBridgeEnv)
  continue
}
```

---

## 5. Container log surfacing

**Layer 1 — `GET /logs/tail` in `pi-container/server.mjs`**
- Expose in-memory stderr ring buffer (already exists as `MAX_STDERR_TAIL_BYTES`)
- New route returns current buffer as JSONL

**Layer 2 — DO-side periodic drain (`pi-container.ts`)**
```ts
// After every stage response, opportunistically drain:
this.ctx.waitUntil(this.drainLogs(runId, stageName))

private async drainLogs(runId: string, stageName: string): Promise<void> {
  const resp = await this.ctx.container.getTcpPort(8080).fetch(
    new Request("http://pi-worker/logs/tail")
  )
  const tail = await resp.text()
  await this.env.WORKSPACE_BUCKET.put(
    `runs/${runId}/artifacts/__observability/${stageName}.pi-stderr.jsonl`,
    tail
  )
}
```

**Layer 3 — crash detection**
Replace `this.ctx.container.monitor().catch(() => {})` with:
```ts
this.ctx.container.monitor().then(
  () => this.emitContainerCrash(runId, stageName, "exited normally"),
  (err) => this.emitContainerCrash(runId, stageName, err.message),
)
```

Threading `runId`: extract from inbound request body before forwarding to container.

---

## 6. `/run-status/:runId` endpoint

**Route:** `GET /run-status/:runId`  
**In:** `src/index.ts` fetch handler  
**Reads:** `runs/{runId}/events/_summary.json` from R2 (single object, fast)  
**Optional:** `?events=true` returns newest 20 events; `?logs=STAGENAME` streams the latest attempt log  

```
curl https://ff-pipeline.koales.workers.dev/run-status/coding-autonomous-1779114105
curl https://ff-pipeline.koales.workers.dev/run-status/coding-autonomous-1779114105?logs=VERIFY
```

No wrangler access required. Returns `RunSummary` JSON.

---

## 7. Watchdog cron

**Threshold:** Global fallback 30min + per-stage YAML override, shipped together.  
**Mechanism:** reads `runs/_active-index.json` from R2 with etag-based conditional puts; scans summaries; calls `/force-complete` on stuck runs.  
**Wired into:** existing `*/5 * * * *` cron via `ctx.waitUntil(scanForStuckRuns(env))`  

```ts
// src/observability/watchdog.ts
const DEFAULT_STUCK_THRESHOLD_MS = 30 * 60 * 1000

const STAGE_THRESHOLDS_MS: Record<string, number> = {
  SEED:     5  * 60 * 1000,
  CONTRACT: 15 * 60 * 1000,
  MAP:      20 * 60 * 1000,
  PATCH:    30 * 60 * 1000,
  VERIFY:   60 * 60 * 1000,
}

export async function scanForStuckRuns(env: HarnessBridgeEnv): Promise<void> {
  // 1. Load active index from R2 (etag-conditional reads)
  // 2. For each runId, read _summary.json
  // 3. Look up per-stage threshold or fall back to DEFAULT_STUCK_THRESHOLD_MS
  // 4. If (now - lastEventAt) > threshold and status === "running" → force-complete
  // 5. Emit stuck_detected event
  // 6. Remove from active index via conditional put (If-Match etag)
}
```

Harness YAML may override stage thresholds via `runtime.stage_watchdog_minutes`.

---

## 8. Architecture decisions (resolved 2026-05-18)

1. **R2 JSON for active-runs index** — R2 with etag-based conditional puts (`If-Match`). Two writers (run_started adds, terminal events remove), low frequency, no fan-out reads. Etag guards prevent lost-update races. No DO migration needed at this scale. **Permanent answer.**

2. **Watchdog threshold** — Global fallback (30min) + per-stage YAML override shipped together. Stage-specific defaults listed in §7. Global fallback applies if stage not listed.

3. **Force-complete race safety** — Safe. CF Workflows `step.waitForEvent` is consume-once; extras are silently dropped. RunCoordinator `KEY_RESULT` check makes the DO handler idempotent. No race condition.

4. **`===STAGE_RESULT===` placement** — R2 log only. The RunCoordinator `/stage-complete` POST already carries a typed `result` object. The delimiter is a human grep aid for log files, not machine input. Do not embed in POST body.

5. **Per-stage attempt log retention** — 30-day R2 lifecycle rule on prefix `runs/_attempt-logs/` (NOT `runs/` — that would expire summaries and per-event objects). `_summary.json` and per-event objects: no expiry. Implemented via `scripts/ops/configure-r2-lifecycle.sh` with `--expire-days 30 --force`.

---

## 9. Implementation priority

| Order | Item | Unblocks | Effort |
|-------|------|----------|--------|
| **1** | Bug fix: move `buildStageContextForRun` inside try block (`harness-dispatcher.ts:324`) | Future CONTRACT/MAP/PATCH hangs | 5 min |
| **2** | Bug fix: `notifyWorkflowComplete` retry on sendEvent failure (`run-coordinator.ts:275`) | Lost completion events | 30 min |
| **3** | DLQ consumer + RunCoordinator `/force-complete` | All stuck-forever workflows | 2h |
| **4** | Watchdog cron + active-runs index | Backstop for DO-level failures | 1.5h |
| **5** | `RunEventLog` + `RunSummary` + `/run-status/:runId` | Queryable without wrangler | 2h |
| **6** | Event emissions (bridge + dispatcher + coordinator) | Full trace visibility | 2h |
| **7** | Attempt-headered per-stage logs + `===STAGE_RESULT===` | Per-attempt triage | 1h |
| **8** | Container stderr drain + crash detection | Container log visibility | 1h |

---

## New files required

```
src/observability/run-events.ts         ← RunEvent + RunSummary + Counterfactual types
src/observability/run-event-log.ts      ← RunEventLog class
src/observability/watchdog.ts           ← scanForStuckRuns
src/harness-dlq-consumer.ts             ← consumeHarnessDlq
```

## Modified files

```
src/harness-bridge.ts
src/harness-dispatcher.ts
src/coordinator/run-coordinator.ts
src/coordinator/pi-container.ts
src/index.ts
wrangler.jsonc
pi-container/server.mjs
```
