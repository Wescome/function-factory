# Current Workspace

## Status
2026-05-18T20:55:00Z: Deployed and verified production Pi free-form coding authoring plus live run monitoring.

## Changes in progress
- Coding-adapter harness routes every non-preseed stage through `worker: pi-author`.
- Pi authoring container now includes `git` so verifier stages can apply candidate patches and run real Node test commands.
- Seeded workspace prompt advertises the actual runtime: POSIX shell, Node.js, npm, git; Python is not installed.
- Verifier role now explicitly verifies by copying `./workspace`, applying `CandidatePatch` with `git apply`, and running the declared Node test command.
- Run status/artifact reads now reconcile from immutable per-event R2 records to avoid stale mutable summary/manifest stage displays.
- Added `/run-monitor/:runId` as a first-class operator snapshot: reconciled summary, stages, recent timeline, diagnostics, and artifacts.
- Manifest writes now use etag retry to reduce R2 read-modify-write races.

## Verification
- Focused tests passed: `pnpm --filter @factory/ff-pipeline test src/coding-adapter-harness.test.ts pi-container/workspace-seed.test.mjs pi-container/execution-policy.test.mjs` (3 files / 10 tests).
- Focused observability/diagnostic tests passed: `pnpm --filter @factory/ff-pipeline test src/diagnostic-routes.test.ts src/observability/run-event-log.test.ts` (2 files / 51 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- Default ff-pipeline tests passed: `pnpm --filter @factory/ff-pipeline test` (79 files / 1045 tests).
- `git diff --check` passed.
- Uploaded `harnesses/coding-adapter.harness.yaml` to remote R2.
- Deployed ff-pipeline Worker version `9dae0374-2c1b-4ffb-b965-93b70fdef307` with `--containers-rollout=immediate`.
- Production run `coding-freeform-prod-1779136814` completed/pass with all six coding-adapter stages passed.
- PATCH observation proved `authoringMode="autonomous_filesystem"`, `materializeContracts=false`, `assistantToolCalls=5`, `toolExecutionEvents=12`, and write-tool execution.
- VERIFY report proved `git apply /tmp/pi-VERIFY-B3byLW/CandidatePatch` and `node test/coding-adapter-smoke.test.js` both passed.
- `/run-status/coding-freeform-prod-1779136814` now shows all stages passed: SEED, CONTRACT, MAP, PATCH, VERIFY, RELEASE.
- `/run-monitor/coding-freeform-prod-1779136814?limit=8` returns stage table, recent timeline, 5 observation records, and all expected artifacts.

## Commit
- Pending commit for Pi free-form authoring and live monitoring.

## Notes
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
