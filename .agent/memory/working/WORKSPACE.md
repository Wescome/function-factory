# Current Workspace

## Status
2026-05-18T17:37:00Z: Completed and deployed real Pi filesystem-authoring smoke slice.

## Changes in progress
- Added `worker: pi-author` as a DSL-visible alias for the existing Pi container adapter.
- Added per-dispatch `execution.authoringMode` routing: normal `pi` keeps `contract_materialized_when_possible`; `pi-author` uses `autonomous_filesystem`.
- Added Pi container `execution-policy.mjs` so autonomous filesystem runs skip deterministic contract materialization and record expected Pi tool inventory (`read`, `bash`, `edit`, `write`) in container observations.
- Added `harnesses/pi-author-smoke-json.harness.yaml` for real authoring smoke without preseed/materializer.
- Updated Pi container Dockerfile to copy `execution-policy.mjs`.

## Verification
- Inspected `@earendil-works/pi-coding-agent@0.74.1` npm tarball in `/tmp`; RPC docs/source confirm streamed `agent_start`, `turn_*`, `message_update`, `tool_execution_*`, and `agent_end` events. No RPC command exposes active tools directly; default tool inventory comes from packaged system prompt/SDK defaults.
- Focused tests passed: `pnpm --filter @factory/ff-pipeline test src/harness-dispatcher.test.ts src/cf-workers.test.ts pi-container/execution-policy.test.mjs pi-container/tool-capability-probe.test.mjs` (4 files / 36 tests).
- Default ff-pipeline tests passed: `pnpm --filter @factory/ff-pipeline test` (78 files / 1030 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `pnpm exec wrangler deploy --dry-run` passed after Dockerfile copy fix and confirmed `execution-policy.mjs` included in the Pi container image layer.
- `git diff --check` passed.
- Commit `e65b7e9 FN-SYNTH-MIGRATE: add pi authoring smoke route` pushed to `factory/fp-motdwvr2-w7un`.
- Deployed ff-pipeline Worker version `36eabb81-11f8-4783-9528-47fb2757ddc8` with `--containers-rollout=immediate`.
- Uploaded `harnesses/pi-author-smoke-json.harness.yaml` to remote R2 bucket `ff-workspaces`.
- Verified `/version`, `/debug/pi-container/status`, and `/debug/pi-container/health` all resolve to Worker/container version `36eabb81-11f8-4783-9528-47fb2757ddc8`.
- Production authoring smoke `pi-author-smoke-1779125728` completed with `stepAccounting.ok=["SMOKE"]`, `currentPhase="report"`, and `eventCount=11`.
- `/run-status/pi-author-smoke-1779125728?logs=SMOKE` returned `X-Run-Log-Key: runs/_attempt-logs/pi-author-smoke-1779125728/SMOKE/attempt-1.log` and final `===STAGE_RESULT===` pass.
- Direct R2 observation `runs/pi-author-smoke-1779125728/artifacts/__observability/SMOKE.container-observation.json` proves `authoringMode="autonomous_filesystem"`, `materializeContracts=false`, `toolCallEventCount=55`, `assistantToolCallCount=2`, `toolExecutionEventCount=4`, tool `write`, and no failed contract artifacts.
- Direct R2 artifact `runs/pi-author-smoke-1779125728/artifacts/SmokeJsonArtifact` is valid JSON with required fields.

## Commit
- `e65b7e9 FN-SYNTH-MIGRATE: add pi authoring smoke route`
- Pending memory closeout commit.

## Notes
- Existing unrelated untracked files remain out of scope.
