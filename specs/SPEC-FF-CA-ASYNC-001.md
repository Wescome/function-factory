# SPEC-FF-CA-ASYNC-001 — Async Commissioning: 202 Accept + Poll for LLM-Chain DOs

**Status:** Draft · **Layer:** I-layer · **Date:** 2026-06-16
**Owner:** Architect (spec) → Workflow agents (implementation)
**Decision class:** Architecture (request/response → async accept+poll). Event surface unchanged.

---

## JTBD

When a WeOps signal triggers the Commissioning Agent, I want the gateway to acknowledge the
signal in well under the platform HTTP timeout, so I can run a 10–60s LLM chain to completion
without the caller's connection dying mid-flight (`UND_ERR_HEADERS_TIMEOUT`), and so the e2e
test can deterministically observe commissioning reach a terminal state.

---

## Problem: the chain is synchronous end-to-end

A single inbound `POST /signals` blocks across three hops, all awaited inline:

```
WeOps ──POST /signals──► ff-gateway.handleSignals()
                           validateJwt() (7 steps)            [fast]
                           caStub.fetch('/signal')  ◄── BLOCKS here, awaited
                             │
                             ▼
                         CommissioningAgentDO.handleSignal()  (packages/commissioning-agent/src/index.ts:267)
                           Phase 1 Pattern Appraisal   → _generateText()  [LLM 10–60s]
                           Phase 2 Deliberation        → _generateText()  [LLM]
                           Phase 3 WorkGraph Authoring → _generateText()  [LLM]
                           mediationStub.fetch('/commission')  ◄── BLOCKS, awaited
                             │
                             ▼
                         MediationAgentDO.handleCommission()   (packages/mediation-agent/src/mediation-agent-do.ts)
                           9-step compile → returns { status: 'seeded', runId, atomCount, … }
```

Findings from the current code:

- **ff-commissioning-agent worker** (`workers/ff-commissioning-agent/src/index.ts`) is a thin
  router. It does **not** use `waitUntil` and never returns early — it `return stub.fetch(...)`,
  so it inherits the DO's full latency. No async seam here.
- **`handleSignal`** (`packages/commissioning-agent/src/index.ts:267–417`) is **fully synchronous
  through the response path.** Every phase is `await`ed; the function only returns after Mediation
  responds (line 413, proxying the mediation body verbatim). The only fire-and-forget work is the
  `SUB_BUFFER` liveness hint (`void subBufStub.fetch`, line 289) and `emitCA` events — neither gates
  the response.
- **ff-gateway** (`workers/ff-gateway/src/signals-handler.ts:369–398`) `await`s `caStub.fetch(...)`
  and `return resp` verbatim. The gateway has **no `waitUntil`, no 202, no async seam.** It surfaces
  whatever the deepest DO returns after all LLM calls finish.
- **`status: 'seeded'`** is **not** a CA surface. It is the Mediation Agent's terminal compile result
  (`mediation-agent-do.ts:139, 226`) that bubbles up unchanged through CA → gateway → caller.

The e2e timeout is structural, not a tuning bug: Node's default `fetch` header timeout (~300s ceiling,
but the agent/undici path trips far earlier on first-byte) fires because **no byte is sent until the
entire chain completes.** Raising client timeouts only masks it and couples test wall-clock to LLM
latency.

---

## The architectural question, answered

> Should the **gateway** return 202 and fire the CA call via `ctx.waitUntil()`?
> Or should the **CA DO** return 202 and process in a separate alarm/queue?

**Neither in the gateway. The DO returns 202; the DO drives its own continuation via the Durable
Object alarm.** Reasoning from the platform's fundamental constraints:

1. **`ctx.waitUntil()` in the gateway is the wrong tool and is unsafe here.** `waitUntil` extends the
   *invocation's* lifetime, but the gateway invocation is request-scoped and subject to Workers CPU/wall
   limits. A 10–60s LLM chain hung off `waitUntil` in the gateway means the gateway worker stays
   resident for the whole chain — you have moved the blocking, not removed it, and you have put
   long-lived orchestration in the stateless edge tier that is supposed to be a thin auth/route shell.
   It also has **no durability**: if the gateway isolate is evicted, the in-flight chain is lost with no
   resumption record.

2. **The Durable Object is the correct home for long-running, stateful orchestration.** The DO already
   owns the session machine (`currentPhase`, `setPhase`, `persistSessionContext`) and already arms an
   **alarm** (`ctx.storage.setAlarm`, line 405). The alarm is the platform-blessed primitive for
   "accept now, do work later, survive eviction." Work driven by an alarm runs in a **fresh invocation
   with its own CPU/wall budget**, persists across isolate eviction, and is single-threaded per DO
   (input gates) — exactly the guarantees an LLM chain with intermediate state needs.

3. **Accept-and-poll is the timeless pattern for "the work outlives one HTTP round-trip."** This is
   the same shape as `202 Accepted` + `Location` in REST, async job submission in every queue system,
   and CF's own Queues/Workflows. We are not inventing; we are conforming to the constraint that
   **request latency must be bounded and independent of work latency.**

**Why not a Queue instead of the alarm?** A Queue is the right answer if commissioning fan-out grows,
needs retry-with-backoff across workers, or must survive a DO being deleted. For v1, the DO **already
holds the session state and already arms an alarm** — the alarm path is the smaller, lower-risk delta
and keeps all commissioning state co-located in one DO. Treat "promote to Queue/Workflow" as a known
future seam (see Risks), not v1 scope.

---

## Recommended async pattern

### 1. Synchronous portion (must finish in < 1s)

In `handleSignal` (CA DO), do **only** the cheap, deterministic work inline, then return:

- Validate signal (`CommissioningSignalSchema.safeParse`) — already present, keep.
- `emitCA(SESSION_SUBMITTED)` and the `SUB_BUFFER` liveness hint — already fire-and-forget, keep.
- `persistSessionContext({ currentPhase: 'pattern-appraisal', domainProfile, lastSignalAt })` — keep.
- **Persist the inbound signal to DO storage** (new) so the alarm can pick it up:
  `this.ctx.storage.put('pending-signal', signal)`.
- **Arm an immediate alarm:** `this.ctx.storage.setAlarm(Date.now())` (or +1ms). The phase work moves
  into `alarm()`.
- **Return `202 Accepted`** with the poll contract (see §4):
  `{ status: 'commissioned', sessionId, dispositionEventId, poll: { href, method: 'GET' } }`.

JWT validation stays in the gateway, unchanged — the gateway still validates *before* it forwards, and
still returns 401/403 synchronously. The gateway change is minimal: it proxies the DO's 202 verbatim
(it already does `return resp`). **The gateway does not adopt `waitUntil` and does not own the chain.**

### 2. Asynchronous portion (in the DO `alarm()` handler)

Move Phases 1–3 + Mediation commission out of `handleSignal` into the alarm-driven worker. The alarm
reads `pending-signal`, runs the existing phase logic verbatim (Pattern Appraisal → Deliberation →
WorkGraph Authoring → Mediation `/commission`), and writes a **terminal result record** to DO storage:

```
this.ctx.storage.put('commission-result', {
  status: 'seeded' | 'archived' | 'rejected' | 'commission-failed',
  runId, atomCount, workGraphVersion, reason?, error?,
  completedAt: <iso>,
})
```

`setPhase('idle')` and the existing terminal `emitCA(MONITORED)` stay as the completion markers. The
**existing 6h cycle-advisory alarm must not collide** with the new processing alarm — gate the
advisory work behind a stored flag (e.g. only run advisory logic if `commission-result` already exists
and the current alarm is the 6h tick), or use a `next-alarm-kind` storage key the `alarm()` handler
switches on. This is the one real hazard in the refactor; call it out in the task spec.

### 3. Failure semantics

A failed phase (appraisal miss, deliberation/authoring failure, mediation error) is no longer an HTTP
status to the original caller — the caller already got 202. It becomes the **terminal `status` in the
`commission-result` record** the poller reads. `archived` / `rejected` / `commission-failed` are
terminal-but-not-`seeded`; the poller distinguishes them by `status`, not HTTP code.

### 4. How the e2e test polls for completion

Add a **read-only `GET` status endpoint on the CA DO**, surfaced through the gateway, keyed by
`sessionId` (the gateway-minted streaming identity already threaded through `caSessionId`):

```
GET /agents/commissioning/{orgId}/signal/{sessionId}     → CA DO
  200 { phase: 'pattern-appraisal' | 'deliberation' | 'workgraph-authoring' | 'idle',
        status: 'commissioning' }                         (work in flight; keep polling)
  200 { phase: 'idle', status: 'seeded', runId, atomCount, workGraphVersion, completedAt }
                                                           (terminal success)
  200 { phase: 'idle', status: 'archived' | 'rejected' | 'commission-failed', reason }
                                                           (terminal non-success)
  404                                                      (unknown sessionId)
```

Implementation note: the CA DO `fetch` router (line 247) only handles `POST`; add a `GET` branch that
reads `currentPhase` (already available via `restoreSessionContext`) and `commission-result`. The
`getSkills`/phase machinery already exposes `currentPhase`, so this is a thin read.

**e2e test shape:** POST the signal, assert `202` + `status: 'commissioned'`, then poll the status
endpoint on an interval (e.g. every 2s, cap ~90s) until `status` is terminal (`seeded` or a failure),
asserting `seeded` for the happy path. The poll requests are individually fast, so no single request
ever approaches the undici header timeout — the structural cause of `UND_ERR_HEADERS_TIMEOUT` is
removed, not tuned around.

---

## `status: 'seeded'` — is it the right sync surface?

**No — but it stays the right *terminal* surface; it just moves off the synchronous accept path.**

- Today `seeded` is returned **synchronously** as the accept response only because the gateway blocks
  for the whole chain. That coupling is the bug. `seeded` is a *Mediation compile outcome*, not a
  *signal-accepted* acknowledgement — overloading one HTTP response to mean both is what makes the
  accept path slow.
- **Accept response (synchronous, immediate):** `202` + `{ status: 'commissioned', sessionId, poll }`.
  `'commissioned'` here means "signal accepted and commissioning has begun" — an acknowledgement, not a
  completion claim. (If `'commissioned'` reads as too strong a completion word, `'accepted'` is the
  safer token; pick one in the task spec and keep it stable, since e2e asserts on it.)
- **Terminal outcome (read via poll):** `status: 'seeded'` (plus `archived` / `rejected` /
  `commission-failed`) — unchanged from the Mediation contract, now surfaced through the status
  endpoint instead of the accept response.

So: **replace the synchronous `seeded` accept surface with a `202 commissioned` (accept) + poll for
`seeded` (terminal).** Do not rename or repurpose `seeded` itself — it remains Mediation's compile
result and must keep flowing verbatim, only via the poll endpoint.

---

## Scope of change (delta, for the task spec)

| Component | Change |
|---|---|
| `packages/commissioning-agent/src/index.ts` `handleSignal` | Return `202 { status:'commissioned', sessionId, poll }` after persisting signal + arming immediate alarm. Move Phases 1–3 + Mediation into `alarm()`. |
| `packages/commissioning-agent/src/index.ts` `alarm()` | Add processing branch (run phases, write `commission-result`); disambiguate from existing 6h advisory alarm via a stored alarm-kind flag. |
| `packages/commissioning-agent/src/index.ts` `fetch` router | Add `GET /signal/{sessionId}` status read (phase + `commission-result`). |
| `workers/ff-gateway/src/signals-handler.ts` | None required for accept (it proxies `resp` verbatim, line 398). Add `GET` route for the status read so the poll is reachable through the gateway. |
| `workers/ff-commissioning-agent/src/index.ts` | None — router already forwards arbitrary subpaths/methods to the DO. |
| e2e test | Switch from single blocking POST-and-assert to POST→202→poll-until-terminal. |

---

## Risks

- **Alarm collision (highest):** the existing 6h cycle-advisory alarm and the new immediate processing
  alarm share `ctx.storage.setAlarm` (single alarm slot per DO). Must be disambiguated with a stored
  alarm-kind key or the advisory work will fire the processing path (or vice-versa). This is the one
  change that can corrupt session state if done carelessly.
- **Lost terminal record:** if the alarm crashes mid-chain before writing `commission-result`, the
  poller sees `phase:'idle'` with no result. Mitigate: only set `phase:'idle'` *after* writing the
  terminal record, and treat `idle` + no `commission-result` as a retryable/failed state, not success.
- **Poll storms:** an aggressive poller can hammer the DO. Bound the e2e poll interval (≥2s) and add a
  cheap ETag/`Retry-After` later if real clients poll.
- **Future scale:** if commissioning needs cross-worker retry/backoff or must survive DO deletion,
  promote the alarm path to a **CF Queue or Workflow**. The accept+poll contract above is forward-
  compatible — only the internal driver changes, not the client surface.

---

## Decision

Adopt **DO-owned 202-Accept + alarm-driven processing + poll-for-terminal.** Keep JWT validation
synchronous in the gateway. Do **not** use `ctx.waitUntil()` in the gateway for the LLM chain. Replace
the synchronous `seeded` accept surface with `202 commissioned`; surface `seeded` (and failure states)
via a new `GET` status endpoint the e2e test polls.
