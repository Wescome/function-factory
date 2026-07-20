# KEEL v1 — Ship-Ready Record (M5)

**Status: v1 acceptance bar MET.** All four M5 conditions (ARCH-KEEL-ROADMAP-001
§5) are satisfied against the built system, verified by a green suite on real
workerd.

## The v1-done checklist

| # | Condition | Evidence |
|---|---|---|
| a | G1–G5 green on the current build | G1 = substrate spike (green, decisions D7/D8/D9 folded in). G2–G5 = the `@koales/keel` suite: 24/24 tests pass — contracts (G2), skeleton (G3), close-loop (G4), replay (G5). |
| b | The three use cases reproduced against the built system | `test/usecases.test.ts`: UC-001 feature-add → amend → ACCEPT; UC-002 schema migration → PAUSE → approve → ACCEPT; UC-003 stale-total → ESCALATE. Each reaches its UC-specified terminal with the expected custody. |
| c | Degraded mode: fail closed | `test/degraded.test.ts`: the executor is fault-injected; the run fails **closed to ESCALATE** (never crash, never false-ACCEPT), while lineage (`readRun`) and verification + the read side (`verifyReplay`, `timeline`) **keep serving**. The Verifier is a separate adapter and is unaffected — the architecture's independence claim, demonstrated. |
| d | Role runbook | `ROLE-RUNBOOK.md`: Operator / Approver / Governor, each mapped to concrete operations, none able to do another's job by construction. |

## What v1 IS

A governed agent loop on Cloudflare that: dispatches idempotently (D7); runs
connectors-only code in an isolated sandbox (D5); verifies every result with an
independent oracle (D2); amends with evidence, escalates at budget, and pauses
for human approval via abort-and-replay (D8); records everything as an
append-only, content-addressed custody graph; and replays any run from any state
with decision-level determinism. The domain is substrate-free and frozen; four
phases of real integration changed no frozen shape.

## What v1 is NOT (honest boundary)

- ~~The model is scripted~~ **built (post-v1):** an AI Gateway ModelPort adapter
  generates connectors-only code, env-gated so CI stays scripted; live generation
  via AI-GATEWAY-PLAYBOOK.md.
- ~~The oracle checks a fixed criterion~~ **DONE (post-v1 step 1):** the oracle now compiles oracleRef acceptance suites into per-criterion assertions, fail-closed to escalate on anything unverifiable.
- ~~Local workerd only~~ **DEPLOYED:** live on a real account
  (keel-skeleton.koales.workers.dev); all three smokes green in production.
- ~~crossRun not yet emitted to D1~~ **DONE:** fanned to a shared D1 index
  (CrossRunIndexPort + D1 adapter), queryable via GET /runs; tested on real D1.
- **No fork-replay** (re-executing from a prior state); deterministic
  reconstruction + decide()-consistency is the verifiable form built.

These are scope boundaries, not defects — each is a named next step, not a
surprise.

## Post-v1, in order

1. ~~AI Gateway ModelPort~~ **built** — real generation, env-gated.
2. ~~Real oracle~~ **done** — compiles `oracleRef` suites to per-criterion assertions.
3. ~~Emit crossRun to D1~~ **done** \u2014 shared cross-run index, GET /runs.
4. ~~Live-account deploy~~ **done** — production-green, zero prod/local divergence.
5. Spec-loop automation + the MCP foreign-executor boundary (Phase 6).
