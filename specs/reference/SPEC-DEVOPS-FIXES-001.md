# SPEC-DEVOPS-FIXES-001 — pi-container Safety Fixes (INV-9, INV-10, INV-15)

**Status:** APPROVED v3 — Architect + SE unanimous; auto-approved per standing instruction  
**Date:** 2026-06-03  
**v1 findings:** wrong CF error strings (Architect), wrong file path, missing try/catch, wrong method name, missing export, retry budget too short (SE) — all corrected in v2  
**Closes:** SPEC-FF-DEVOPS-001-v2 checklist items:
- `pi-container.ts:340` classification literal replaced (INV-9)
- `pi-container.ts:242` checkpoint-before-delete (INV-10)
- `cf-workers.ts:422` + `:364` rollout-retry path (INV-15)

**Source anchors read:**
- `workers/ff-pipeline/src/coordinator/pi-container.ts` lines 40-55 (types), 85-130 (timeout), 215-260 (restartContainer), 317-360 (recordMonitorEvent)
- `workers/ff-pipeline/src/cf-workers.ts` lines 40-45 (retry constants), 340-435 (dispatch loop, isContainerNotRunningTransient)
- `node_modules/.pnpm/@cloudflare+containers@0.3.5/…/dist/lib/container.js:10-12, 962-971` — authoritative CF Container runtime error strings

**Confirmed CF Container runtime error strings (from node_modules source):**
- `"runtime signalled the container to exit: <code>"` — SIGTERM/rollout (exit 143)
- `"container exited with unexpected exit code: <code>"` — crash
- `"the container is not listening"` — port not up
- `"there is no container instance that can be provided to this durable object"` — cold/no-instance
- `"Network connection lost."` — in-flight `getTcpPort().fetch()` when container destroyed mid-request
- `"Container suddenly disconnected, try again"` — wrapper message for the above

---

## 1. Fix A — INV-9: classifyContainerCrash() at pi-container.ts:340

### 1.1 Problem

`recordMonitorEvent()` (pi-container.ts:317) hardcodes `failureClass: "infrastructure_error"` for ALL monitor errors. When a rollout SIGTERMs the container, the monitor Promise rejects with `"runtime signalled the container to exit: 143"`, which lands in the `.catch()` branch as `event.message`. The system currently marks those runs as permanent failures.

### 1.2 Fix

Add `export function classifyContainerCrash(message: string | undefined): "rollout_interrupted" | "infrastructure_error"` to `pi-container.ts`. Replace the hardcoded literal at line 340.

```typescript
// Regex grounded in CF Container runtime error strings from
// @cloudflare/containers dist/lib/container.js:10-12
const ROLLOUT_INTERRUPTED_RE = /runtime signalled the container to exit/i

export function classifyContainerCrash(
  message: string | undefined,
): "rollout_interrupted" | "infrastructure_error" {
  if (message && ROLLOUT_INTERRUPTED_RE.test(message)) return "rollout_interrupted"
  return "infrastructure_error"
}
```

**Change at line 340** (inside `recordMonitorEvent`, `emitRunEvent` for `container_crashed`):
```typescript
// Before:
failureClass: "infrastructure_error",

// After:
failureClass: classifyContainerCrash(event.message ?? event.event),
```

Note: `event.event` is typed `"exit" | "error"` and can never match the regex — the `?? event.event` fallback is kept for safety and will always return `"infrastructure_error"` when `event.message` is absent, which is correct.

### 1.3 Acceptance criteria

- `AC-A1`: `classifyContainerCrash("runtime signalled the container to exit: 143")` returns `"rollout_interrupted"`.
- `AC-A2`: `classifyContainerCrash("container exited with unexpected exit code: 1")` returns `"infrastructure_error"`.
- `AC-A3`: `classifyContainerCrash(undefined)` returns `"infrastructure_error"`.
- `AC-A4`: line 108 (`container_execute_timed_out` path) is NOT modified — timeout stays `"infrastructure_error"`.

### 1.4 Files

- `workers/ff-pipeline/src/coordinator/pi-container.ts` — add exported `classifyContainerCrash`, replace literal at line 340 only.

---

## 2. Fix B — INV-10: checkpoint-before-delete at pi-container.ts:242

### 2.1 Problem

`restartContainer()` deletes `ACTIVE_EXECUTION_KEY` (line 242) without first writing a checkpoint. If a molecule was in-flight, its run context is silently lost.

### 2.2 Fix

Before deleting `ACTIVE_EXECUTION_KEY` in `restartContainer(desiredBuildId, reason)`, read the active execution and attempt an R2 checkpoint write. The write is wrapped in try/catch so R2 failures never block the restart (AC-B4).

```typescript
// Insert BEFORE: await this.ctx.storage.delete(ACTIVE_EXECUTION_KEY)  (line 242)
// storage.get is wrapped so a DO storage error never blocks the restart (AC-B6).
let activeExec: ActiveExecution | undefined
try {
  activeExec = await this.ctx.storage.get<ActiveExecution>(ACTIVE_EXECUTION_KEY)
} catch (err) {
  console.error("pi.container.checkpoint_read_failed", {
    message: err instanceof Error ? err.message : String(err),
  })
}
if (activeExec && this.env.WORKSPACE_BUCKET) {
  const checkpointKey = `runs/${activeExec.runId}/checkpoints/${activeExec.stageName}.${activeExec.attemptNumber ?? 1}.json`
  try {
    await this.env.WORKSPACE_BUCKET.put(
      checkpointKey,
      JSON.stringify({
        runId: activeExec.runId,
        stageName: activeExec.stageName,
        attemptNumber: activeExec.attemptNumber ?? 1,
        interruptedAt: new Date().toISOString(),
        reason: "rollout_interrupted",
        restartReason: reason,
      }),
      { httpMetadata: { contentType: "application/json" } },
    )
  } catch (err) {
    console.error("pi.container.checkpoint_write_failed", {
      runId: activeExec.runId,
      stageName: activeExec.stageName,
      message: err instanceof Error ? err.message : String(err),
    })
    // Intentionally swallowed — restart must proceed even if checkpoint fails.
  }
}
// Original line 242 — must remain unconditional:
await this.ctx.storage.delete(ACTIVE_EXECUTION_KEY)
```

**`clearActiveExecution` is intentionally NOT modified.** That method runs in the `finally` of a completed execution — checkpointing there would create phantom `rollout_interrupted` markers for runs that already finished, which the dispatcher would wrongly try to resume.

**Checkpoint consumer:** The checkpoint created here is a durable signal for future tooling. A full resume consumer (reading `runs/{runId}/checkpoints/…` and re-dispatching the stage) is out of scope for this spec — tracked separately. The checkpoint prevents silent data loss; reuse is a follow-on.

### 2.3 Acceptance criteria

- `AC-B1`: when `restartContainer()` is called and `ACTIVE_EXECUTION_KEY` is set, a checkpoint JSON is written to `runs/{runId}/checkpoints/{stageName}.{attemptNumber}.json` in `WORKSPACE_BUCKET`.
- `AC-B2`: when `ACTIVE_EXECUTION_KEY` is not set, no R2 write occurs.
- `AC-B3`: when R2 throws, the error is logged and swallowed — `storage.delete` still runs.
- `AC-B4`: `ACTIVE_EXECUTION_KEY` is deleted unconditionally after the checkpoint attempt.
- `AC-B5`: `clearActiveExecution` is not modified.
- `AC-B6`: when `storage.get` throws, the error is logged and restart still proceeds to `storage.delete`.

### 2.4 Files

- `workers/ff-pipeline/src/coordinator/pi-container.ts` — modify `restartContainer()` only.

---

## 3. Fix C — INV-15: rollout-retry expansion at cf-workers.ts:364 + :422

### 3.1 Problem

The dispatch retry loop (line 364) only retries `isContainerNotRunningTransient` errors (cold-start: `"container is not running, consider calling start()"`). When a rollout destroys a running container mid-dispatch, the fetch throws `"Network connection lost."` — which does not match, so the dispatch fails permanently.

The current retry budget: `MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS = 3`, backoff `[1s, 3s]` ≈ 4s total. This is appropriate for cold-start (seconds) but not for rollout cold-start (30–60s for the new container). Fix C introduces a **separate rollout retry budget** with longer delays.

### 3.2 Fix

**Add alongside existing constants** (near line 41):
```typescript
// Rollout-specific retry constants. Container replacement after a rollout
// can take 30-60s (CF cold-start). The shorter infra budget is deliberately
// preserved for cold-start; rollout gets a longer window.
const MAX_CONTAINER_ROLLOUT_DISPATCH_ATTEMPTS = 12
const CONTAINER_ROLLOUT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 15_000]
```

**Add function** (near line 422, alongside `isContainerNotRunningTransient`):
```typescript
// Error strings confirmed from @cloudflare/containers@0.3.5 dist/lib/container.js:962-971
export function isContainerRolloutTransient(message: string): boolean {
  return /network connection lost|container suddenly disconnected|runtime signalled the container to exit/i.test(message)
}
```

**Change at line 348** — raise the loop bound to the larger budget so rollout retries can actually reach attempt 12:
```typescript
// Before:
for (let attempt = 1; attempt <= MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS; attempt += 1) {

// After:
for (let attempt = 1; attempt <= MAX_CONTAINER_ROLLOUT_DISPATCH_ATTEMPTS; attempt += 1) {
```
The inner per-class guards (below) still cap infra retries at 3, preserving AC-C7.

**Change at line 364** — expand the retry condition and select the appropriate budget:
```typescript
// Before:
if (!isContainerNotRunningTransient(msg) || attempt >= MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS) {
  throw fetchErr
}
const delayMs = containerDispatchRetryDelayMs(attempt)

// After:
const isInfraTransient = isContainerNotRunningTransient(msg)
const isRolloutTransient = isContainerRolloutTransient(msg)
if (!isInfraTransient && !isRolloutTransient) throw fetchErr
if (isInfraTransient && attempt >= MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS) throw fetchErr
if (isRolloutTransient && attempt >= MAX_CONTAINER_ROLLOUT_DISPATCH_ATTEMPTS) throw fetchErr
const delayMs = isRolloutTransient
  ? (CONTAINER_ROLLOUT_RETRY_DELAYS_MS[Math.min(attempt - 1, CONTAINER_ROLLOUT_RETRY_DELAYS_MS.length - 1)] ?? 15_000)
  : containerDispatchRetryDelayMs(attempt)
```

**Also update `emitContainerDispatchRetryScheduled`** (line ~392, `maxAttempts` field in the emitted event):
```typescript
// Before:
maxAttempts: MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS,

// After:
maxAttempts: isContainerRolloutTransient(reason ?? "")
  ? MAX_CONTAINER_ROLLOUT_DISPATCH_ATTEMPTS
  : MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS,
```
*(Pass `reason` (the retry reason string) to the emit helper, or derive it from the stored `lastRetryReason` already in scope.)*

### 3.3 Acceptance criteria

- `AC-C1`: `isContainerRolloutTransient("Network connection lost.")` returns `true`.
- `AC-C2`: `isContainerRolloutTransient("Container suddenly disconnected, try again")` returns `true`.
- `AC-C3`: `isContainerRolloutTransient("runtime signalled the container to exit: 143")` returns `true`.
- `AC-C4`: `isContainerNotRunningTransient("container is not running, consider calling start()")` still returns `true` (no regression).
- `AC-C5`: a non-transient error (e.g. `"invalid request"`) throws immediately.
- `AC-C6`: rollout-transient errors retry up to 12 attempts with delays capped at 15s (total budget ≈ 2+5+10+15×9 = 152s, covering a 30-60s cold-start with margin).
- `AC-C7`: infra-transient errors (cold-start) still respect `MAX_CONTAINER_DISPATCH_INFRA_ATTEMPTS = 3`.
- `AC-C8`: the dispatch `for`-loop upper bound equals `MAX_CONTAINER_ROLLOUT_DISPATCH_ATTEMPTS` so rollout-transient errors can actually reach attempt 12.

### 3.4 Files

- `workers/ff-pipeline/src/cf-workers.ts` — add constants, add `isContainerRolloutTransient`, modify retry condition at line 364.
