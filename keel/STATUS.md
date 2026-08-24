# KEEL — Status

**One doc. Everything else in the repo is reference; you don't need it.**

## Where it stands

Live in production (`keel-skeleton.koales.workers.dev`), real model + real
oracle, fully governed. Domain frozen and never moved across every
integration. Two threads are in flight, independent of each other:

- **Thread A — the governed loop itself (D10, amend-evidence):** open, one
  live run short of proof. See below.
- **Thread B — SCR/land (getting an ACCEPTed run's code into a real repo):**
  functionally complete through PORT-4 (the capstone), gate is **green**
  (see "Gate status" below). PORT-4's own live verification is deferred —
  see the PORT-4 entry.

- Loop: INTENT → GENERATE → EXECUTE → VERIFY → {ACCEPT | AMEND | ESCALATE | PAUSE}
- Real model (AI Gateway, Workers AI / kimi-k2.6) writes connectors-only code;
  independent oracle judges it; loop amends with evidence or fails closed.
- Append-only content-addressed lineage; any run replays; cross-run D1 index.
- Once a run ACCEPTs, SCR's ported review core seals it, merges it, and lands
  it (real git compose, real push, real PR) onto an external repo — this is
  Thread B.

## Done (all live-confirmed)

Spike · freeze · skeleton · close-loop · replay · real oracle · deploy ·
real model · cross-run D1 index · SCR review core on a KEEL DO · real git
merge/commit · real two-tier land (push + PR) · land-honesty (partial-failure
safe) · git-fs substrate swapped to `@cloudflare/computer` · the slice→Change
boundary (PORT-4). Every claim verified on the actual deployment, a
disposable external repo, or (PORT-4 specifically) the vitest suite — see
that entry for exactly which parts are live-proven and which aren't yet.

## Gate status (as of 2026-08-24)

`npm run gate` is **green**: 82 test files passed (1 skipped), 677 tests
passed (2 skipped), exit 0, confirmed independently multiple times. It was
briefly red on 2026-08-23 — root-caused and fixed. The cause was NOT an RPC
double-delivery (an earlier version of this doc guessed wrong): `stub.land(...)`
(a real Durable Object RPC call) returns a workerd `JsRpcPromise`, a proxy
that is both a thenable and a pipelining target. Vitest's `expect(...).rejects`
introspects its subject via property access before awaiting it; on a raw
`JsRpcPromise` that introspection mints a second, derived pipelined promise
for the same call, and when the call rejects both branches reject — Vitest
only observes the one it awaited, so the other is a genuine unhandled
rejection (V8 was right to report it). Fixed at the two call sites in
`test/scr-land-port3.test.ts` that passed the raw RPC promise straight to
`.rejects` — wrapping the call in an async function first collapses the
subject to a single native Promise before `.rejects` ever touches it. Written
up at `.agent/patterns/workerd-jsrpc-rejects-proxy.md` for next time.

## Thread A — D10, disposed (implemented)

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

## Thread B — SCR/land, PORT-1 through 4 + COMPUTER-SWAP (functionally done, gate green)

Ports SCR (a pre-existing, runtime-neutral review/merge/seal system —
`src/scr/`) into KEEL as the mechanism that takes an ACCEPTed run's code and
actually lands it on a real external repo. Independent of Thread A/D10 —
this is what happens *after* ACCEPT, not part of the GENERATE/VERIFY loop.

- **PORT-1:** SCR's review core (event log, derived model, invariant-enforcing
  service, seal, audit) lifted into `src/scr/`, backed by a new `ReviewCore`
  DO (separate DO-SQLite `review_log` table from KEEL's own run/lineage log)
  and a runtime-native Ed25519 seal. No git yet.
- **PORT-2:** real three-way merge (`diff3`) and real commits via
  isomorphic-git, replacing PORT-1's no-git simulators. `Composer.compose()`
  became async — a disclosed, platform-forced deviation from SCR's original
  synchronous Node API.
- **PORT-3:** the real two-tier land — R2-owned working repo, real
  fetch/compose/fence/push/PR-open via GitHub REST, sealed `LandEvent`, an
  INV-6 guard against interleaving review-log writes during a land.
  Live-verified against a disposable external repo: real commit, real push,
  real opened PR, a genuine drift/fence/replay cycle.
- **PORT-3.5:** the land-honesty fix. Split the binary `LandEvent` into a
  sealed `LandAuthorised` (atomic domain decision) plus sealed
  `Pushed`/`PrOpened` (written only once each external step actually
  confirms) — a partial failure can no longer leave the log claiming LANDED
  when nothing shipped. `resumeLand()` checks external reality before acting,
  so a crash mid-land can't double-push or double-open-PR. Live-verified by
  inducing the exact partial-failure window and confirming honest, idempotent
  resume.
- **COMPUTER-SWAP:** repointed the git-fs substrate from `@cloudflare/shell`'s
  unexported `createGitFs` mirror to `@cloudflare/computer`'s first-class
  `workspace.fs`. Composer/rebaser logic unchanged; only the fs source moved.
  Live-verified full land against a disposable external repo; full suite
  passed twice in a row at the time, and does again now — see "Gate status"
  above (the brief gap in between was a test-authoring bug, not a substrate
  regression from this swap).

- **PORT-4 (the capstone):** joins KEEL's own orchestration (C1/C1b/C2) to
  the SCR land layer at the slice→Change boundary. Three tracks: (1) the C2
  dependency DAG *is* SCR's series graph — one graph, no second ordering
  authority, proven by asserting `Model.openOrder` equals the C2 topological
  order on a fixture whose input order is deliberately not its topological
  order; VERIFY becomes a slice's check, a real human approval (via a new
  `approverId` on `Orchestrator.approve()` — no fabricated reviewer identity)
  becomes its verdict. (2) The seam replay: `checkFileOverlap`'s deferred
  auto-resolution is now real — overlapping slices replay through the
  rebaser, clean → resolved via a new `state.writeSection` connector
  (disjoint sub-file anchors, not just whole-file writes) → INV-14 (already
  existed in SCR, only now reachable) forbids the resolution inheriting a
  verdict, so it re-enters review as a genuinely new Change; conflict → INV-9
  refuse, naming `file:anchor`. (3) The handoff: `consumesResults` grounds on
  `provenanceOf`, never rewritten git.
  - **OD-PORT4-1 (the merged-content check) is real, not fabricated.** First
    build shipped with `resolveSeam` receiving no check outcome at all (every
    real seam resolution silently refused at land), papered over by a test
    hardcoding `checkOutcome: "pass"` under a comment falsely claiming
    observation. Caught on review, fixed: `Orchestrator.verifyMergedContent`
    genuinely re-runs the VERIFY oracle over the merged content before
    `resolveSeam` is called, and a suite must now declare
    `mergeSensitive: true` on an assertion for its merged-content check to
    count at all — a suite that only reads `trace.result` (blind to what the
    merge produced) stays silently unverifiable rather than rubber-stamped.
  - **Live verification is deferred, deliberately.** An initial live probe
    against `Wescome/keel-scr-scratch` did land a real seam replay as a real
    PR — but it drove `ReviewCore` directly, bypassing `Orchestrator`
    entirely, so it never actually proved the orchestration↔SCR join PORT-4
    exists for. That probe also left an unauthenticated route on the
    deployed worker for about an hour, capable of pushing to arbitrary
    attacker-supplied repos with the worker's own `GIT_PUSH_TOKEN` — caught,
    stripped, redeployed, confirmed dead. A separate incident during
    teardown deleted the wrong scratch-repo branch (a PORT-3.5 leftover,
    matched by name suffix instead of the DO-id qualifier `branchFor` exists
    to prevent) and auto-closed its PR; both were restored within 57 seconds
    and independently confirmed genuine against GitHub's own event timeline.
    Given that history, live re-verification of PORT-4 specifically — ideally
    a real end-to-end `Orchestrator` run, not a `ReviewCore`-direct one — is
    intentionally left for a deliberate, human-driven pass rather than
    something an agent reaches for routinely.
  - **Known, disclosed, out-of-scope gap:** `Orchestrator.approve()` never
    pushes a completion signal to wake a waiting parent (unlike the derived-
    child ACCEPT/ESCALATE path) — pre-existing in C2, unrelated to PORT-4,
    surfaced only because PORT-4's fixtures are the first to use *gated*
    (not ungated) children. Degrades to latency (the reaper eventually
    catches it), not incorrectness. Worked around honestly in PORT-4's own
    tests via the same public `childCompleted` RPC a real child calls.
    Tracked, not fixed here.
  - Not committed as of this writing.

## Run it

```
npm install --legacy-peer-deps && npm run gate     # 677/677 (2 skipped), exit 0
```
Live smoke (against the deployment):
```
KEEL=https://keel-skeleton.koales.workers.dev
curl -s -X POST "$KEEL/admit?name=t1" -H 'content-type: application/json' \
  -d '{"intent":"echo 42","acceptance":[{"id":"A1","statement":"","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"echo@v1"}'
curl -s "$KEEL/result?name=t1"        # -> ACCEPT
curl -s "$KEEL/runs"                  # cross-run index
```

## Next

- **Thread A:** dispose D10 — one live run of `derived-fair@v1` with a
  reliable amend turn, to capture the still-missing real-model
  wrong→right→ACCEPT trace.
- **Thread B:** PORT-4 is functionally complete and gate-clean; a real
  end-to-end live probe through `Orchestrator` (not `ReviewCore`-direct) is
  the deliberate, human-driven follow-up, on no particular timeline. The
  `approve()` completion-push gap is a tracked, low-priority follow.
- **After both:** Phase 6 (spec-loop automation + MCP boundary), which is a
  design brief before code.

---
*Reference (in repo, not required reading): per-phase RESULTs, the playbooks
(deploy / AI-gateway / D1), ROLE-RUNBOOK, FREEZE, V1-READY, and
BRIEF-KEEL-AMEND-EVIDENCE-001 (the full D10 option table). The authoritative
architecture is ARCH-KEEL-000.docx.*
