# KEEL — Status

**One doc. Everything else in the repo is reference; you don't need it.**

## Where it stands

Live in production (`keel-skeleton.koales.workers.dev`), real model + real
oracle, fully governed. **36/36 tests green** on real workerd. Domain frozen and
never moved across every integration.

- Loop: INTENT → GENERATE → EXECUTE → VERIFY → {ACCEPT | AMEND | ESCALATE | PAUSE}
- Real model (AI Gateway, Workers AI / kimi-k2.6) writes connectors-only code;
  independent oracle judges it; loop amends with evidence or fails closed.
- Append-only content-addressed lineage; any run replays; cross-run D1 index.

## Done (all live-confirmed)

Spike · freeze · skeleton · close-loop · replay · real oracle · deploy ·
real model · cross-run D1 index. Every claim verified on the actual deployment.

## D10 — disposed (implemented)

A live real-model run on a deliberately underspecified task **ESCALATED**. Two
outcomes:

- **Fixed already:** empty gateway responses were silently laundered into
  `return undefined;` (looked like a model mistake). Now they fail loud as a
  throwing action. Done, tested.
- **Implemented (Option A+D):** the oracle now feeds the *observed* value back
  on amend ("you produced check=42, which did not satisfy this") plus a "try a
  materially different interpretation" nudge — never the expected answer
  (**INV-ORACLE-BLIND**). `max_tokens` raised to 2000. Suite assertions gained an
  `observe` operand so a check can report what it read. All adapter-side, 36/36.

  **Live result — mechanism validated, blocker relocated (instrumented):**
  Re-runs showed the observed-value gradient *works*: on one amend turn the model
  produced a genuinely different, evidence-informed guess (`value===42` → `42`).
  So evidence design + oracle are cleared. New precise blocker: the **amend-turn
  generation call returns empty** (every retry, never the cold start), and 2000
  tokens didn't fix it — so it's not a raw budget ceiling. The fail-loud fix
  fired correctly and recorded it honestly instead of laundering it.

  **Now instrumented, not theorized:** an empty response records its raw
  diagnostics into the trace — `finish_reason`, whether `reasoning_content` is
  present, `completion_tokens` — so the next live run's `/debug/nodes` *names*
  the cause (truncation vs all-reasoning-no-content) instead of guessing.

  **Also fixed — backend stall (a distinct hole):** a live run *hung* (attempt 1
  never returned — a stalled gateway call, not empty, not erroring). `generate()`
  had no bounded wait. Now it uses `AbortSignal.timeout` (30s, configurable) and a
  stall fails loud into a throwing action ("request timed out…") like the other
  modes, so the budget engages and the run fails closed instead of hanging. The
  adapter now fails loud on all three backend failures: HTTP error, empty
  response, and stall.

  **Diagnosed + fixed (data, not guesses):** a controlled run (non-reasoning
  model, same harness/prompt) showed the amend-turn variance **vanishes** — so
  it's reasoning-chain blowup specific to kimi-k2.6 on retries, NOT the prompt.
  Three builds landed: (1) an amend-turn-only reasoning cap (`amendParams`,
  injectable since the exact param is provider-specific); (2) `derived-fair@v1`
  (check = value*2, derivable) as the convergence target; (3) `derived-blind@v1`
  (value*2+7) kept as the boundary fixture — a rule genuinely beyond evidence's
  reach, which the harness correctly ESCALATEs (proven deterministically; llama
  couldn't get it either, and shouldn't — getting it would require leaking the
  answer, violating INV-ORACLE-BLIND).

  **Honest status — the one thing still not shown:** a clean *real-model*
  ACCEPT-after-amend trace. Proven so far: the mechanism (deterministic,
  fair-converges + blind-escalates, 40/40), the gradient works live (kimi made a
  genuine evidence-informed re-guess), the harness fails closed on every backend
  failure (error/empty/stall). NOT yet shown: a real model going wrong→right to
  ACCEPT on a fair blind task. That is one live run away (playbook Step 7:
  `derived-fair@v1` + a reliable amend turn). This is a convergence-RATE question,
  not a safety one — the governance thesis holds regardless.

## Run it

```
npm install --legacy-peer-deps && npm run gate     # 36/36
```
Live smoke (against the deployment):
```
KEEL=https://keel-skeleton.koales.workers.dev
curl -s -X POST "$KEEL/admit?name=t1" -H 'content-type: application/json' \
  -d '{"intent":"echo 42","acceptance":[{"id":"A1","statement":"","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"echo@v1"}'
curl -s "$KEEL/result?name=t1"        # -> ACCEPT
curl -s "$KEEL/runs"                  # cross-run index
```

## Next (new scope, not a gap)

Dispose D10 → I implement + re-run the amend smoke. Then Phase 6 (spec-loop
automation + MCP boundary), which is a design brief before code.

---
*Reference (in repo, not required reading): per-phase RESULTs, the playbooks
(deploy / AI-gateway / D1), ROLE-RUNBOOK, FREEZE, V1-READY, and
BRIEF-KEEL-AMEND-EVIDENCE-001 (the full D10 option table). The authoritative
architecture is ARCH-KEEL-000.docx.*
