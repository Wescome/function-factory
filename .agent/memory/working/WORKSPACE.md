# Current Workspace

## Status
2026-05-18T18:13:00Z: Implemented R2 run artifact manifest persistence; deploy/smoke verification pending.

## Changes in progress
- Added canonical R2 run artifact manifest at `runs/{runId}/manifest.json`.
- Added numbered phase records under `00_intent/`, `01_plan/`, `02_execution/`, `03_traces/`, `04_eval/`, and `05_report/`.
- Manifest captures harness identity, stage execution state, produced artifact keys, observation/contract diagnostics, event prefix, attempt-log prefix, status, and terminal timestamp.
- Added `GET /run-artifacts/:runId` to read the manifest without knowing R2 keys.

## Verification
- Focused tests passed: `pnpm --filter @factory/ff-pipeline test src/observability/run-event-log.test.ts src/diagnostic-routes.test.ts` (2 files / 48 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- Default ff-pipeline tests passed: `pnpm --filter @factory/ff-pipeline test` (78 files / 1037 tests).
- `pnpm --filter @factory/ff-pipeline exec wrangler deploy --dry-run` passed.
- `git diff --check` passed.

## Commit
- Pending commit for R2 run artifact manifest persistence.

## Notes
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
