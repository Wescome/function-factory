# Current Workspace

## Status
Updated 2026-05-17 20:44 UTC. Pi harness contract-first smoke milestone is complete.

## Completed

- Pi execution contract hardened:
  - Container prompt requires declared outputs as local files in the working directory.
  - For explicit exact-line contracts, the container now uses Pi RPC `bash` before the chat loop.
  - If contract materialization satisfies all declared outputs, the prompt/repair/fallback path is skipped.
  - Non-deterministic or partially unresolved outputs still fall through to prompt, repair, then bounded exact-line fallback.
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
  - Current Worker version: `96932435-db10-4037-89fa-828c012784f2`.
  - Pi container application: `a0367c71-dce7-43bd-ba24-0b6a247e9432`.

## Verification

- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/execution-contract.mjs` passed.
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- Focused tests passed:
  - `pnpm --filter @factory/ff-pipeline test src/queue-bridge.test.ts src/harness-dispatcher.test.ts src/pipeline.test.ts pi-container/execution-contract.test.mjs`
  - `pnpm --filter @factory/ff-pipeline test src/atoms-complete-wiring.test.ts src/diagnostic-routes.test.ts src/queue-bridge.test.ts src/stage6-handoff.test.ts`
  - `pnpm --filter @factory/ff-pipeline test pi-container/execution-contract.test.mjs src/cf-workers.test.ts src/harness-dispatcher.test.ts src/pipeline.test.ts src/queue-bridge.test.ts`
- Default parallel full-suite run hit unrelated timeout/contention failures, then the same failing files passed focused.
- Full ff-pipeline suite passed serially:
  - `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism`
  - 66 files, 928 tests passed.
- `git diff --check` passed.

## Production Smoke

Clean post-deploy smoke run: `smoke-1779050655`

- Trigger: `/trigger-harness` with `harnessKey: pi-smoke`.
- Workflow status: completed successfully in 11 seconds.
- `harness-complete-1`: `{"overall":"pass","finalStage":"SMOKE"}`.
- `record-harness-result-1`: R2-primary persistence succeeded:
  - `runs/smoke-1779050655/artifacts/__observability/harness-result-record.json`
  - `substrate: "r2"`
  - record summary: `Harness pass at stage SMOKE`
- Container observation:
  - `runs/smoke-1779050655/artifacts/__observability/SMOKE.container-observation.json`
  - `runId: smoke-1779050655`
  - elapsed: 1822ms
  - events: `execute.workdir`, `pi.spawned`, `output.contract_command`, `response`, `output.contract_response`, `output.contract_satisfied`
  - artifacts: `SmokeArtifact` read on attempt `contract`
  - stderr tail empty
- Artifact:
  - `runs/smoke-1779050655/artifacts/SmokeArtifact`
  - 22 bytes
  - content: `pi container smoke ok`

## Remaining Notes

- The deterministic smoke now validates Pi RPC artifact creation directly instead of relying on repair/fallback.
- General LLM-authored artifact production still needs a broader contract for non-exact-line artifacts; unresolved outputs continue through the existing prompt/repair/fallback path.
- Several older smoke workflow instances remain waiting because their queue messages were already lost or discarded before the queue-routing fix. The clean post-deploy run above is the authoritative production evidence.
