# Current Workspace

## Status
2026-05-18T21:16:32Z: Implemented and deployed first-class run interventions for live operator monitoring.

## Changes in progress
- Added `POST /run-interventions/:runId/note` for immutable operator notes.
- Added `POST /run-interventions/:runId/cancel` to record cancellation intent and ask `RunCoordinator` to `/force-complete` with `failureClass: operator_cancelled`.
- Added `POST /run-interventions/:runId/retry-stage` and `/redispatch-stage` as visible recorded-only intents; actual queue mutation remains a later control-plane slice.
- Added run-existence and terminal-run protection so unknown runs return 404, cancel/control actions return 409 after terminal status, and rejected requests emit no event.
- Extended `/run-monitor/:runId` and `pnpm watch:run` with an `interventions` section derived from immutable R2 events.

## Verification
- `pnpm exec vitest run scripts/ops/watch-run.test.mjs` passed (4 tests).
- `pnpm --filter @factory/ff-pipeline test src/diagnostic-routes.test.ts src/observability/run-event-log.test.ts` passed (56 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `pnpm --filter @factory/ff-pipeline test` passed (79 files / 1050 tests).
- `git diff --check` passed.
- Deployed production Worker version `3176645d-eb61-4870-91e4-8fa3df1499fa`.
- Live non-destructive verification run `intervention-live-1779138971` confirmed note and retry-stage events persist in R2, appear in `/run-monitor`, and render through `pnpm watch:run`.
- Live guard verification confirmed unknown run intervention returns 404 and retry-stage on completed `coding-freeform-prod-1779136814` returns 409 without mutating terminal state.

## Commit
- Pending commit for live intervention controls.

## Notes
- Live cancel was not exercised against production because it intentionally mutates run terminal state; unit tests cover the `RunCoordinator /force-complete` call and terminal guard.
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
