# Current Workspace

## Status
Updated 2026-05-17 20:31 UTC. Architect-guided Pi harness production milestone is complete.

## Completed

- Pi execution contract hardened:
  - Container prompt now requires declared outputs as local files in the working directory.
  - Container performs an initial read, one repair prompt, then a bounded materialization fallback only for explicit exact-line file contracts.
  - Materialization uses Pi RPC `bash` and records `output.materialize_*` events in the R2 observation artifact.
- Harness result persistence is R2-primary:
  - Result record key: `runs/{runId}/artifacts/__observability/harness-result-record.json`.
  - Payload includes `substrate: "r2"`.
  - Harness path no longer writes `verification_reports` for this production smoke record.
- Harness queue routing hardened:
  - Queue handler still accepts `batch.queue === "harness-queue"`.
  - It also routes by message shape `{ runId, stageName }` so live runtimes that omit or vary `batch.queue` do not silently drop harness messages.
- Typecheck blockers cleared:
  - Coordinator strictness issues fixed with explicit agent input types and missing atom-spec guards.
  - Harness bridge test tuple casts fixed.
- Production redeployed:
  - Current Worker version: `52339baf-271b-41cb-894f-85774ac3c661`.
  - Pi container application: `a0367c71-dce7-43bd-ba24-0b6a247e9432`.

## Verification

- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/execution-contract.mjs` passed.
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- Focused tests passed:
  - `pnpm --filter @factory/ff-pipeline test src/queue-bridge.test.ts src/harness-dispatcher.test.ts src/pipeline.test.ts pi-container/execution-contract.test.mjs`
  - `pnpm --filter @factory/ff-pipeline test src/atoms-complete-wiring.test.ts src/diagnostic-routes.test.ts src/queue-bridge.test.ts src/stage6-handoff.test.ts`
- Default parallel full-suite run hit unrelated timeout/contention failures, then the same failing files passed focused.
- Full ff-pipeline suite passed serially:
  - `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism`
  - 66 files, 928 tests passed.
- `git diff --check` passed.

## Production Smoke

Clean post-deploy smoke run: `smoke-1779049770`

- Trigger: `/trigger-harness` with `harnessKey: pi-smoke`
- Workflow status: completed successfully in 14 seconds.
- `harness-complete-1`: `{"overall":"pass","finalStage":"SMOKE"}`
- `record-harness-result-1`: R2-primary persistence succeeded:
  - `runs/smoke-1779049770/artifacts/__observability/harness-result-record.json`
  - `substrate: "r2"`
  - record summary: `Harness pass at stage SMOKE`
- Container observation:
  - `runs/smoke-1779049770/artifacts/__observability/SMOKE.container-observation.json`
  - `runId: smoke-1779049770`
  - model: `anthropic/claude-sonnet-4.5`
  - route kind: `worker`
  - resolved via: `config-default`
  - events include initial miss, repair miss, `output.materialize_command`, and `output.materialize_response`.
- Artifact:
  - `runs/smoke-1779049770/artifacts/SmokeArtifact`
  - 22 bytes
  - content: `pi container smoke ok`

## Remaining Notes

- Pi still did not write `SmokeArtifact` unaided during the smoke; the bounded exact-line materialization fallback produced the artifact through Pi RPC after the repair attempt.
- Several older smoke workflow instances remain waiting because their queue messages were already lost or discarded before the queue-routing fix. The clean post-deploy run above is the authoritative production evidence.
