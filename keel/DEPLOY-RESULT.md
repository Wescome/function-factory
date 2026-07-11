# KEEL — Live Deploy Result

**Status: LIVE and GREEN in production.** Deployed to a real Cloudflare account;
all three smokes passed with zero prod/local divergence.

- URL: `https://keel-skeleton.koales.workers.dev`
- Version: `b353a98f-82a4-45e8-8d4b-c23d2e729773`
- Bindings, no warnings: `ORCHESTRATOR` (DO), `CODEMODE_RUNTIME` (DO), `LOADER`
  (Worker Loader). Workers Paid plan; Dynamic Workers are open-beta (2026-03-24),
  no gate.

## Smokes (live)

| Smoke | Result |
|---|---|
| trivial `echo 42` | **ACCEPT**, attempt 1, A1 pass, ms 35, Verdict node present |
| `converge` | **ACCEPT** on attempt 2 with an Amendment node — fail→amend→accept live |
| `approve` | **PAUSE** (149ms, with executionId) → POST /approve → **ACCEPT**. Timeline: RunAdmitted → ActionGenerated → ExecutionRecorded → ActionPaused → ExecutionRecorded → VerdictEmitted → RunAccepted |

No ESCALATE, no error, nothing in `wrangler tail`. Cold start: smoke1 reached
ACCEPT on the first poll (sub-second after admit).

## What this confirms

- The sandbox executes generated code in production (not just Miniflare).
- The AMEND convergence loop closes against a real Dynamic Worker.
- **D8 abort-and-replay works across two separate HTTP requests** — the codemode
  execution log survives the gap between admit-lands-PAUSE and a later approve,
  and replays to completion. The pivotal claim, live.
- Spike-first paid off: M0 proved the substrate on real workerd before anything
  was built on it, so deploy surfaced no architectural surprises.

## Now retired

- "Local workerd only" — the system runs on real Cloudflare infrastructure.

## Still deferred (unchanged)

- Model scripted (next: real generation via AI Gateway — the account is now
  provisioned for it).
- Oracle suites in-process; `crossRun` not yet emitted to a D1 index.
