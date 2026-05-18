# Current Workspace

## Status
2026-05-18T03:02:29Z: FN-SYNTH-MIGRATE OpenClaw-informed Pi routing patch implemented, tested, deployed, and production-smoked. Commit pending.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
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
The original tool-call blocker is resolved on OFOX via RPC when the routed model is `openrouter/openai/gpt-5.4`: production PATCH emitted real toolcall and tool_execution events and wrote `CandidatePatch`. The remaining blocker for a fully clean smoke is Cloudflare container rollout observability/control: production continues to serve stale Pi image `a5831588` despite successful deploys and an immediate rollout request.

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
