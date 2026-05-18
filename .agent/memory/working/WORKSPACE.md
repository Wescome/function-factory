# Current Workspace

## Status
2026-05-18T22:40:00Z: Completed production live-control smoke command and emitted deploy Verification Report.

## Completed
- Protected `POST /run-interventions/:runId/*` with operator token auth in production.
- Added executable `retry-stage` and `redispatch-stage` controls through `RunCoordinator /operator-dispatch` with idempotency, current-stage validation, queue enqueue, and `stage_dispatched` observability.
- Added `scripts/ops/control-run.mjs` plus package scripts `run:note`, `run:cancel`, `run:retry`, and `run:redispatch`.
- Added `harnesses/operator-recovery-smoke.harness.yaml` and uploaded it to remote `ff-workspaces`.
- Hardened terminal handling so late post-terminal execution events cannot mutate summary/manifest stage projections.
- Added terminal sealing so `harness_complete` can mark the final stage pass/fail when `stage_completed` arrives late.
- Added coordinator protection against duplicate `/stage-complete` after a terminal result is already persisted.
- Ran fresh production smokes for retry, redispatch/idempotency, and cancel on the current Worker.
- Removed `CF_API_TOKEN`/`CLOUDFLARE_API_TOKEN` fallback from operator control CLI and Worker authorization.
- Added `docs/how-to/OPERATOR_RUN_CONTROLS.md` runbook.
- Added `pnpm watch:run <runId> --interactive` operator loop with note, retry, redispatch, cancel confirmation, refresh, and quit actions.
- Added `pnpm prod:smoke:controls` to run production live-control verification through the interactive monitor control path and emit a `VR-*` YAML report.

## Verification
- `pnpm --filter @factory/ff-pipeline test src/observability/run-event-log.test.ts src/diagnostic-routes.test.ts src/coordinator/run-coordinator.test.ts src/harness-dispatcher.test.ts` passed (86 tests).
- `pnpm --filter @factory/ff-pipeline test src/diagnostic-routes.test.ts` passed (53 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `pnpm --filter @factory/ff-pipeline test` passed (79 files / 1056 tests).
- `pnpm exec vitest run scripts/ops/watch-run.test.mjs scripts/ops/control-run.test.mjs` passed (8 tests).
- `pnpm exec vitest run scripts/ops/watch-run.test.mjs scripts/ops/control-run.test.mjs` passed after interactive monitor changes (13 tests).
- `pnpm exec vitest run scripts/ops/watch-run.test.mjs scripts/ops/control-run.test.mjs scripts/ops/prod-live-control-smoke.test.mjs` passed (17 tests).
- `git diff --check` passed.
- `node scripts/ops/watch-run.mjs --help` prints the interactive options.
- `node scripts/ops/prod-live-control-smoke.mjs --help` prints the production smoke options.
- Deployed production Worker version `8d03426f-b52b-4d1d-9c1f-8094517e7bf3`.
- Production operator recovery smoke `operator-recovery-1779140553` completed with an authenticated `run:retry`; replay now shows status `completed`, stage `SEED` as `pass`, exactly one `harness_complete`, and operator retry evidence present.
- Fresh production retry smoke `prod-retry-mpbr9o2s` completed/pass with operator retry attempt 2.
- Fresh production redispatch smoke `prod-redispatch-mpbr9o2s` completed/pass; duplicate idempotency request deduped.
- Fresh production cancel smoke `prod-cancel-mpbr9o2s` ended failed with `errorClass: operator_cancelled`, workflow notified, and active index cleaned.
- Unauthenticated production control request returns 401 after final deploy.
- Production smoke report `VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-2026-05-18T22-37-36-823Z` passed on Worker `2ec8630f-2334-4eef-93b5-76977bdcb82a`.
- Report runs: retry `prod-live-control-retry-mpbsbdtn-7e23be51`, redispatch `prod-live-control-redispatch-mpbsbdtn-7e23be51`, cancel `prod-live-control-cancel-mpbsbdtn-7e23be51`.

## Notes
- A generated `OPERATOR_CONTROL_TOKEN` is installed in production and was rotated before the latest smoke. Set local `FF_OPERATOR_TOKEN` to the current value for future operator control commands; rotate with `wrangler secret put OPERATOR_CONTROL_TOKEN` when needed.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
- Existing unrelated untracked files remain out of scope.

## Commit
- Pending scoped commit for production smoke command/report.
