# KEEL substrate spike

Throwaway probe for **ARCH-KEEL-PLAN-001, Phase 1**. It exists to answer one
question before any contract freezes: *does the durable composition
(Agents SDK fibers + codemode + Dynamic Worker) behave the way the contracts
assume?*

It is **disposable**. Do not grow it into the real system; it informs the freeze
(Phase 2) and is then deleted.

---

## What it does

A real `Orchestrator` Durable Object dispatches its outer per-run loop via
`startFiber` (fire-and-forget, idempotency-keyed on the Specification id — D7),
calls codemode once in a Dynamic Worker, and is truly evicted mid-run via
`cloudflare:test`'s `evictDurableObject()`. Around that, eight checks (S1–S8)
assert the substrate properties the architecture depends on. The G1 gate is
green iff all eight pass.

Run it two equivalent ways:

```bash
npm install --legacy-peer-deps   # pin versions — see "VERIFY" below
npm run lint:deps                # D6 import boundary must be clean first
npm test                         # S1–S8 in the real Workers runtime (vitest-pool-workers)
# or, live:
npm run deploy && curl -s -X POST <worker-url>/spike | jq .
```

Both paths print the same report and the same `GREEN | RED` gate.

---

## D7 — the fiber primitive is resolved, not open

Phase 1 substrate contact surfaced a real fork, since resolved (see
`ARCH-KEEL-000` Part D, D7): `runFiber`'s `finally` block **unconditionally**
finalizes the fiber's tracking row on any exit, including a thrown error — a
normal JS throw inside the fiber body can never leave a recoverable
interrupted fiber. Recovery (`onFiberRecovered`) only fires when the DO
instance is genuinely destroyed mid-flight (true eviction/OOM/hibernation)
before that `finally` runs.

**Resolved:** the outer Orchestrator loop dispatches via
`startFiber(name, fn, { idempotencyKey })` — fire-and-forget, backed by its
own durable ledger, where a repeat call with the same key returns the
**existing** fiber's status rather than double-starting. This is the
dispatch-idempotency guard on admission (INTENT), with no separate Claim node
and no external lock. `runFiber` is retained for bounded, immediate-result
operations inside a single `decide()` pass — the canonical case is the
`OraclePort` verification call (`runOracle()`), wrapped in `runFiber` in
`substrate.ts`.

The underlying eviction/recovery mechanism itself — `evictDurableObject()` +
`runDurableObjectAlarm()` — is independently confirmed against `agents@0.17.3`
directly by a standalone falsifiable test (see the sibling
`fiber-recovery-verify` proof): a never-ending fiber's stashed snapshot was
recovered via `onFiberRecovered` after true eviction, and a clean-throw
control produced no pending alarm and no recovery, matching the source-level
finding exactly. `@cloudflare/think@0.12.1`'s `Think` class extends `Agent`
directly, so the mechanism applies verbatim.

---

## The checks and their cascade

| #  | Proves | If RED → re-opens |
|----|--------|-------------------|
| S1 | Idempotent dispatch (`startFiber`+`idempotencyKey`) and recovery, across a confirmed true eviction | D7, and transitively D1/D3 |
| S2 | codemode call accounting is correct (exactly 2 real invocations) | CodeExecutionPort (D5/D6) |
| S3 | Checkpoint visibility on the produced trace | ClockPort/EntropyPort — no native `step()`, tighten executor contract |
| S4 | `globalOutbound:null` blocks raw egress; connector egress logs | D5 ceiling |
| S5 | **A Dynamic Worker runs an acceptance test at runtime, in budget** | **PIVOTAL** — OraclePort goes async; D2 |
| S6 | The verify path has no model/generator binding | configuration (low risk) |
| S7 | Lineage events append durably + ordered | D4 store shape |
| S8 | codemode records an approval-gated action pending and suspends | approval/PAUSE design |

**S1 now tests a resolved primitive choice (D7), not an open assumption** — the
underlying mechanism is independently confirmed; a red S1 means the
Orchestrator's *own* `startFiber`/`idempotencyKey` usage is wrong, not that
the mechanism is unproven. **S5 remains the most likely substantive
surprise** — it is the only check probing an assumption (run tests at runtime
inside a sandbox) that the docs do not directly promise.

A red check is **information, not a bug**: per the governance model it amends
the Disposition it falsifies and re-opens exactly the contracts that
Disposition authorized — then you re-run.

---

## VERIFY — confirm before trusting a single result

Every uncertain API call is isolated in **`src/substrate.ts`** (the D6 ACL).
The SDK set is pre-1.0; most of it is now confirmed against the installed
`.d.ts` files (`agents@0.17.3`, `@cloudflare/codemode@0.4.2`), but a few
things remain modeled from behavioral description rather than independently
read from source:

```bash
grep -rn "VERIFY" .        # the full list
```

The ones that still matter most:
- `startFiber`'s exact return shape (modeled here as `{ id, isNew, status }`
  from D7's Disposition text) and the exact signatures of `listFibers()` /
  `inspectFiber()`.
- The WorkerLoader binding name/shape for Dynamic Workers (`wrangler.jsonc`,
  `loaderBinding()` in `substrate.ts`).
- How an artifact crosses into the sandbox for `runOracle()` — the real
  `ProxyToolInput` has no bindings field, so this needs a connector call, not
  a passthrough (flagged inline, not silently faked).

If any signature differs, fix it **only in `substrate.ts`** — nothing else
imports the substrate, by design (`npm run lint:deps` enforces it).

---

## Files

```
src/substrate.ts              the ACL — startRun (D7)/runFiber, codemode, oracle
src/orchestrator.ts           the Orchestrator DO — admit()/result() (D7), run() convenience
src/connectors/probe.codemode.ts  real CodemodeConnector w/ durable real-invocation counter
src/checks.ts                 S1–S8 definitions + the G1 gate
src/worker.ts                 POST /spike — live report
test/spike.test.ts            S1–S8 in the Workers runtime, true eviction via cloudflare:test
scripts/lint-deps.mjs         D6 import-boundary lint
```
