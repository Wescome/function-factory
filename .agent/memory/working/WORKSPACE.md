# Current Workspace

## Status
2026-05-18T15:42:00Z: Implemented the full runtime observability pipeline from `specs/reference/observability-pipeline-spec.md` for the harness path. Added R2 append-only run events, rolling run summaries, active-run index, per-attempt logs with final `===STAGE_RESULT===`, `/run-status/:runId`, watchdog force-complete scan, container stderr tail route/drain, container lifecycle events, verification-specific event projection, and model-failover counterfactual recording. Verification passed: `node --check workers/ff-pipeline/pi-container/server.mjs`, `pnpm --filter @factory/ff-pipeline typecheck`, focused observability/harness/coordinator/queue/diagnostic/cf-worker tests, stable full suite `77 files / 1022 tests`, `git diff --check`, and `pnpm exec wrangler deploy --dry-run`.

2026-05-18T15:09:30Z: FN-SYNTH-MIGRATE stuck-workflow recovery patch implemented, tested, committed, pushed, and deployed. Context-building exceptions are captured as worker failures, terminal harness-complete sendEvent failures retry via DO alarm, and harness-dlq messages force-complete the run through RunCoordinator. Production Worker version `4af8970e-1465-4ca4-b6bc-9a4fb376f423`; Pi singleton desired/started build IDs match that Worker version.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
- Added stuck-workflow recovery fixes from `specs/reference/observability-se-diagnosis.md`:
  - moved `buildStageContextForRun` inside the dispatcher try/catch so missing input artifacts become captured worker failures instead of queue/DLQ hangs
  - added RunCoordinator alarm retry for failed `harness-complete` workflow notifications
  - added RunCoordinator `/force-complete` for idempotent terminal recovery
  - added `harness-dlq` consumer wiring and `consumeHarnessDlq`
  - kept new user-facing logs/comments on ontology language (`executionNode`, verification checks) while preserving existing NLAH compatibility fields (`stageName`, `gateResults`, `finalStage`)
- Added Cloudflare rollout architecture fix:
  - `version_metadata` binding `CF_VERSION_METADATA`
  - persisted Pi singleton `startedBuildId` in the Durable Object
  - restart-on-mismatch when the Worker version changes or when a legacy running container has no persisted build id
  - `/__pi-container/status` and `/__pi-container/restart` internal DO routes
  - public Worker diagnostics `/debug/pi-container/status`, `/debug/pi-container/health`, and `POST /debug/pi-container/restart`
  - Pi `/health` and R2 observations now include `containerRuntime`
- Used OpenClaw's working pattern at the right FF boundary: model/provider capability is now explicit Agent Call route metadata and observable worker behavior, not embedded deep in prompt logic.
- Kept OFOX as the provider boundary:
  - `OPENROUTER_API_KEY` is sourced from `OFOX_API_KEY`.
  - Pi `openrouter` provider base URL remains `https://api.ofox.ai/v1`.
  - production primary is `openrouter/openai/gpt-5.4`.
- Added per-dispatch filesystem model candidates for autonomous Pi stages:
  - `openrouter/openai/gpt-5.4`
  - `openrouter/anthropic/claude-sonnet-4.6`
  - `openrouter/google/gemini-3.1-pro-preview`
  - `openrouter/x-ai/grok-4.20`
- Added container-side route failover:
  - records `modelCandidates`
  - emits `model.attempt_start`
  - probes filesystem tool execution before the task prompt
  - emits `model.failover` on failed tool-capability probes
  - emits `model.capability_route_selected` when a route passes
  - continues to later candidates if a model route exits immediately
- Preserved RPC as the Pi execution surface after verifying Pi source showed RPC already carries tools.
- Added assistant `errorMessage` summaries for faster provider diagnosis without persisting tool args.
- Tightened pre-seeded coding-adapter smoke:
  - `VerifierReport` DSL contract now explicitly requires `Tests run`
  - workspace-derived `VerifierReport` now includes `## Verdict`, `## Tests`, `## Evidence`
  - added test proving the derived verifier report satisfies the smoke harness contract

## Verification
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- Focused rollout/diagnostic tests:
  `pnpm --filter @factory/ff-pipeline test src/diagnostic-routes.test.ts src/coordinator/pi-container-version.test.ts src/coordinator/sandbox-preflight.test.ts src/cf-workers.test.ts`
  -> 4 files / 67 tests passed.
- Added `/debug/pi-container/health` and reran:
  `pnpm --filter @factory/ff-pipeline test src/diagnostic-routes.test.ts`
  -> 1 file / 40 tests passed.
- `pnpm exec wrangler deploy --dry-run` from `workers/ff-pipeline` -> passed; validated `env.CF_VERSION_METADATA` as Worker Version Metadata and built both container images locally.
- Local Pi image health check on `ff-pipeline-picontainer:worker` returned `runtime.workerVersionId="local-check"`.
- Full suite first run hit 5 unrelated timeout/queue failures under file parallelism; rerunning the failed subset passed: 4 files / 82 tests.
- Stable full suite:
  `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism`
  -> 75 files / 1017 tests passed.
- Stuck-workflow focused tests:
  `pnpm --filter @factory/ff-pipeline test src/harness-dispatcher.test.ts src/coordinator/run-coordinator.test.ts src/queue-bridge.test.ts`
  -> 3 files / 51 tests passed.
- Wrangler deploy dry-run passed with the added `harness-dlq` queue consumer binding.
- Deployed with `pnpm exec wrangler deploy --containers-rollout=immediate`.
  - Worker version: `4af8970e-1465-4ca4-b6bc-9a4fb376f423`
  - Wrangler output includes `Consumer for harness-dlq`
  - `/debug/pi-container/health` returned runtime `workerVersionId=4af8970e-1465-4ca4-b6bc-9a4fb376f423`
  - `/debug/pi-container/status` returned matching `desiredBuildId` and `startedBuildId`
- `node --check workers/ff-pipeline/pi-container/server.mjs`
- `node --check workers/ff-pipeline/pi-container/tool-capability-probe.mjs`
- `node --check workers/ff-pipeline/pi-container/workspace-derived-artifacts.mjs`
- Focused tests:
  `pnpm --filter @factory/ff-pipeline test pi-container/workspace-derived-artifacts.test.mjs src/harness-dispatcher.test.ts src/cf-workers.test.ts pi-container/tool-capability-probe.test.mjs`
  -> 4 files / 35 tests passed.
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- Full suite:
  `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism`
  -> 74 files / 1001 tests passed.
- `git diff --check` -> passed.
- Local container sanity:
  - `docker run --rm ff-pipeline-picontainer:0990f03e node --check server.mjs` -> passed
  - `docker run --rm ff-pipeline-picontainer:0990f03e node --check workspace-derived-artifacts.mjs` -> passed
  - local `/health` on `ff-pipeline-picontainer:0990f03e` returned OK.

## Production evidence
- Deploy 1:
  - Worker version `8e577444-9271-4526-9f48-0d364c258ead`
  - Pi container image `8e577444`
- Smoke `coding-adapter-routeplan-1779072410`:
  - reached VERIFY
  - failed only at `test_results_support_claims` because the generated verifier report said `Ran:` instead of literal `Tests run`
  - PATCH observation persisted in R2 at `runs/coding-adapter-routeplan-1779072410/artifacts/__observability/PATCH.container-observation.json`
  - PATCH evidence: `openrouter/openai/gpt-5.4`, `executionSurface: "rpc"`, `tool_capability.probe_result.passed=true`, `toolExecutionEventCount=18`, `toolCallEventCount=226`, `assistantToolCallCount=7`
- Deploy 2:
  - Worker version `d883afb1-5ee5-4ddd-b834-e5f8dfcefb4e`
  - Pi container image `d883afb1`
- Pre-seeded smoke `coding-adapter-preseed-1779072813`:
  - failed at VERIFY contract evaluation because production still executed stale Pi image `a5831588`
  - observation lacked new `modelCandidates` field and matched old verifier report behavior
  - R2 evidence:
    - `runs/coding-adapter-preseed-1779072813/artifacts/__observability/VERIFY.container-observation.json`
    - `runs/coding-adapter-preseed-1779072813/artifacts/__observability/VERIFY.contract-evaluation.json`
- Deploy 3 with `--containers-rollout immediate`:
  - Worker version `0990f03e-47e3-403c-a585-d69b551fd221`
  - Pi container image `0990f03e`
  - Cloudflare `containers info` still reports active config image `a5831588` with one active old instance and one starting replacement.
  - `wrangler containers instances` shows the Pi instance inactive; container rollout/visibility remains inconsistent.

## Current conclusion
The original tool-call blocker is resolved on OFOX via RPC when the routed model is `openrouter/openai/gpt-5.4`: production PATCH emitted real toolcall and tool_execution events and wrote `CandidatePatch`. The Cloudflare rollout blocker is architectural, not Pi: Worker code updates immediately, container instances roll separately, and the old singleton had no build identity. The fix is now version-coordinated singleton lifecycle at the PiContainer DO boundary plus runtime diagnostics.

## Commit scope
Stage only:
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
- `.agent/memory/working/WORKSPACE.md`
- `harnesses/coding-adapter.harness.yaml`
- `workers/ff-pipeline/pi-container/server.mjs`
- `workers/ff-pipeline/pi-container/tool-capability-probe.mjs`
- `workers/ff-pipeline/pi-container/tool-capability-probe.test.mjs`
- `workers/ff-pipeline/pi-container/workspace-derived-artifacts.mjs`
- `workers/ff-pipeline/pi-container/workspace-derived-artifacts.test.mjs`
- `workers/ff-pipeline/src/cf-workers.test.ts`
- `workers/ff-pipeline/src/coordinator/pi-container.ts`
- `workers/ff-pipeline/src/harness-dispatcher.test.ts`
- `workers/ff-pipeline/src/harness-dispatcher.ts`
- `workers/ff-pipeline/src/harness-env.ts`
- `workers/ff-pipeline/wrangler.jsonc`

Leave unrelated untracked files alone.
