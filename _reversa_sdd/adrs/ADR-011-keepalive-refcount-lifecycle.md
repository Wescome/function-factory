# ADR-011: GasCitySupervisor Keepalive Refcount Lifecycle

> Retroactive ADR — decision implemented in PRs #84 and #85, 2026-06-09
> Confidence: 🟢 CONFIRMED — formula-compiler.ts:1137, webhook-receiver.ts:223+241, gascity-supervisor/src/index.ts

---

## Status

**Accepted** (implemented)

---

## Context

`GasCitySupervisor` is a Cloudflare Container Durable Object that hosts the Gas City daemon. The CF Container platform stops the container after `sleepAfter = "30m"` of inactivity via `onActivityExpired`. A container restart has a measurable cold-start cost and can interrupt in-flight formula executions.

The pipeline dispatches formulas to Gas City (via `formula-compiler.ts`) and receives completion callbacks from Gas City (via `webhook-receiver.ts`). Between dispatch and callback, the Gas City container must remain running. Without explicit keepalive, a 30-minute pipeline execution could trigger a container stop mid-execution if no other traffic arrived.

Additionally: prior to PR #85, `onStop()` was a synchronous void method that called `.delete("keepalive_refcount").catch(() => {})` (fire-and-forget). If the Worker crashed or was preempted before the storage write completed, `keepalive_refcount` would remain non-zero in Durable Object storage. On the next wake, `onActivityExpired` would see `refcount > 0`, call `renewActivityTimeout()`, and loop indefinitely — the container would never sleep.

---

## Decision

Implement a reference-count based keepalive mechanism in `GasCitySupervisor`:

1. **keepalive/start** (`POST /v0/keepalive/start`): increments `keepalive_refcount` in DO storage and calls `renewActivityTimeout()`. Called by `formula-compiler.ts` immediately after a successful sling dispatch (best-effort, `.catch(() => {})`).

2. **keepalive/stop** (`POST /v0/keepalive/stop`): decrements `keepalive_refcount` (floor 0). If `refcount > 0` after decrement, calls `renewActivityTimeout()` (other molecules still running). Called by `webhook-receiver.ts` on two paths:
   - Successful RELEASE (any `outcome` from Gas City)
   - `amendment_halted` early return (max amendment depth exceeded)

3. **onActivityExpired override**: if `keepalive_refcount > 0`, calls `renewActivityTimeout()` and returns without calling `super.onActivityExpired()` (container stays running). If `refcount === 0`, delegates to `super.onActivityExpired()` (container sleeps).

4. **onStop is async** (PR #85 fix): `onStop` must `await` the `storage.delete("keepalive_refcount")` call to guarantee the refcount is cleared before the container shuts down. The prior fire-and-forget pattern risked stale non-zero refcount surviving crashes.

---

## Consequences

### Positive
- Container stays warm for the full dispatch → RELEASE lifecycle, eliminating cold-start risk mid-execution.
- Multiple concurrent dispatches are safe: each increments the refcount; container only sleeps when the last decrement brings refcount to 0.
- The `/__supervisor/fence` endpoint exposes `{ active: boolean, refcount: number }` for operator introspection.

### Negative / Constraints
- Both keepalive/start and keepalive/stop are **best-effort fire-and-forget** (`fetch(...).catch(() => {})`). If either call fails (network, container not yet started), the refcount drifts:
  - A missed `/start` means the container may sleep before the formula completes.
  - A missed `/stop` means the container will not sleep until the next organic `onActivityExpired` check (30m + sleepAfter window).
- There is no automatic reconciliation: if `webhook-receiver` crashes after saving the completion event but before calling `/stop`, the refcount leaks until `sleepAfter` fires and `onActivityExpired` eventually runs with `refcount > 0` — this loops indefinitely until a manual stop or supervisor restart.
- The system relies on exactly one `/start` per dispatch and exactly one `/stop` per completion. Any codepath that dispatches without later receiving a webhook callback (e.g. pipeline abort, Gas City silence) will hold the container permanently warm.

### Mitigations
- The `stale_dispatch` detector in `autonomy-monitor.ts` raises a sev2 incident after `GAS_CITY_DISPATCH_STALE_MINUTES` (default 60 min) with no completion event — this surfaces stuck keepalives as operational incidents.

---

## Evidence

| Artifact | Notes |
|----------|-------|
| `workers/gascity-supervisor/src/index.ts:30-41` | `onActivityExpired` refcount check, `onStop` async await |
| `workers/gascity-supervisor/src/index.ts:46-66` | keepalive/start and keepalive/stop HTTP handlers |
| `workers/ff-pipeline/src/compilers/formula-compiler.ts:1137` | best-effort keepalive/start on dispatch |
| `workers/ff-pipeline/src/gascity/webhook-receiver.ts:223` | best-effort keepalive/stop on amendment_halted |
| `workers/ff-pipeline/src/gascity/webhook-receiver.ts:241` | best-effort keepalive/stop on RELEASE |
| PR #84 commit message | "IS-GC-CONTAINER-KEEPALIVE Change 2 + 3" |
| PR #85 commit message | "onStop must await the storage delete — if fire-and-forget fails on crash, keepalive_refcount stays non-zero and onActivityExpired loops indefinitely" |
