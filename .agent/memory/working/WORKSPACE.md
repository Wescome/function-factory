# Current Workspace

## Status
2026-05-18T18:18:00Z: Deployed and verified R2 run artifact manifest persistence.

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
- Commit `1ae37dc FN-SYNTH-MIGRATE: persist run artifact manifest` pushed to `factory/fp-motdwvr2-w7un`.
- Deployed ff-pipeline Worker version `eacc3e74-0f66-438b-beb5-75c63a7a5680` with `--containers-rollout=immediate`.
- Verified `/version` and `/debug/pi-container/health` report Worker/container version `eacc3e74-0f66-438b-beb5-75c63a7a5680`.
- Production smoke `pi-artifact-manifest-smoke-1779128106` failed during rollout with `The container is not running, consider calling start()`; its manifest still persisted failed-run execution/report data.
- Warmed the container and reran production smoke `pi-artifact-manifest-smoke-1779128160`; it completed/pass with `stepAccounting.ok=["SMOKE"]` after post-terminal dispatcher update.
- `/run-artifacts/pi-artifact-manifest-smoke-1779128160` returned manifest status `completed`, all six phase keys, harness identity, `SMOKE` stage pass, artifact key, observation key, and gate results for `exists`, `json_field_equals`, and `json_field_type`.
- Direct R2 gets confirmed these keys exist: `manifest.json`, `00_intent/intent.json`, `01_plan/harness.json`, `02_execution/execution.json`, `03_traces/trace-index.json`, `04_eval/eval.json`, and `05_report/report.json`.
- Direct R2 artifact `runs/pi-artifact-manifest-smoke-1779128160/artifacts/SmokeJsonArtifact` is valid JSON with matching runId and numeric elapsedMs.
- Direct R2 observation proves `authoringMode="autonomous_filesystem"`, execution policy event `materializeContracts=false`, tool calls/executions present (`write`, `bash`), no failed contract artifacts, and matching container `workerVersionId`.

## Commit
- `1ae37dc FN-SYNTH-MIGRATE: persist run artifact manifest`
- Pending memory closeout commit.

## Notes
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
