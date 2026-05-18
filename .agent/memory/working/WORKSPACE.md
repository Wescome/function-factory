# Current Workspace

## Status
2026-05-18T18:36:00Z: Implemented real Pi filesystem-authoring smoke slice locally; deploy and production smoke pending.

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

## Commit
- Pending.

## Notes
- Existing unrelated untracked files remain out of scope.
