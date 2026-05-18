# Current Workspace

## Status
2026-05-18T21:54:00Z: Completed production live-control milestone 1-4 for ff-pipeline.

## Completed
- Protected `POST /run-interventions/:runId/*` with operator token auth in production.
- Added executable `retry-stage` and `redispatch-stage` controls through `RunCoordinator /operator-dispatch` with idempotency, current-stage validation, queue enqueue, and `stage_dispatched` observability.
- Added `scripts/ops/control-run.mjs` plus package scripts `run:note`, `run:cancel`, `run:retry`, and `run:redispatch`.
- Added `harnesses/operator-recovery-smoke.harness.yaml` and uploaded it to remote `ff-workspaces`.
- Hardened terminal handling so late post-terminal execution events cannot mutate summary/manifest stage projections.
- Added terminal sealing so `harness_complete` can mark the final stage pass/fail when `stage_completed` arrives late.
- Added coordinator protection against duplicate `/stage-complete` after a terminal result is already persisted.

## Verification
- `pnpm --filter @factory/ff-pipeline test src/observability/run-event-log.test.ts src/diagnostic-routes.test.ts src/coordinator/run-coordinator.test.ts src/harness-dispatcher.test.ts` passed (86 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `pnpm --filter @factory/ff-pipeline test` passed (79 files / 1055 tests).
- `pnpm exec vitest run scripts/ops/watch-run.test.mjs scripts/ops/control-run.test.mjs` passed (7 tests).
- `git diff --check` passed.
- Deployed production Worker version `c17c8233-a381-430e-8624-ec3fae625dde`.
- Production operator recovery smoke `operator-recovery-1779140553` completed with an authenticated `run:retry`; replay now shows status `completed`, stage `SEED` as `pass`, exactly one `harness_complete`, and operator retry evidence present.

## Notes
- A generated `OPERATOR_CONTROL_TOKEN` is installed in production. Rotate it and set local `FF_OPERATOR_TOKEN` for future operator control commands.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
- Existing unrelated untracked files remain out of scope.

## Commit
- Pending scoped commit for production live-control milestone.
