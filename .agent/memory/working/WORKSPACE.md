# Current Workspace

## Status
2026-05-18T17:50:00Z: Implemented value-level Pi authoring smoke validation; deploy/smoke verification in progress.

## Changes in progress
- Added CF-side JSON field gates `json_field_equals` and `json_field_type`.
- Added compile-time registration for CF custom gates so NLAH compilation accepts ontology-facing gate declarations.
- Updated `pi-author-smoke-json.harness.yaml` to assert `SmokeJsonArtifact.runId == runtime runId` and `elapsedMs` is numeric.
- Updated Pi container prompts to include `runId` and `stageName` under `Run Context`.
- Threaded role responsibility into container `rolePrompt` so role text declared in harness YAML is visible to Pi.

## Verification
- Focused tests passed: `pnpm --filter @factory/ff-pipeline test src/cf-gates.test.ts src/harness-bridge.test.ts src/harness-dispatcher.test.ts pi-container/execution-contract.test.mjs` (4 files / 33 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- Harness compile sanity passed for `harnesses/pi-author-smoke-json.harness.yaml` with gates `exists`, `json_field_equals`, `json_field_type`.
- `pnpm --filter @factory/ff-pipeline exec wrangler deploy --dry-run` passed.
- `git diff --check` passed.

## Commit
- Pending commit for value-level smoke validation.

## Notes
- Existing unrelated untracked files remain out of scope.
