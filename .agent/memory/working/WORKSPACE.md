# Current Workspace

## Status
2026-05-18T02:25:00Z: FN-SYNTH-MIGRATE corrective RPC observability patch implemented, deployed, production-smoked, and ready to commit.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
- Read the actual Pi source from `github.com/earendil-works/pi-mono` at installed tag `v0.74.1` before making the corrective decision.
- Verified Pi RPC mode wraps the same `AgentSession` tool stack as the SDK path:
  - `packages/coding-agent/src/modes/rpc/rpc-mode.ts` creates/rebinds `AgentSession`.
  - `packages/coding-agent/src/core/sdk.ts` defaults built-ins to `read,bash,edit,write` unless `--no-tools`.
  - `packages/agent/src/agent-loop.ts` sends `context.tools` to the model and emits `tool_execution_*` after tool calls.
  - `packages/ai/src/providers/openai-completions.ts` forwards `params.tools` and parses streamed `tool_calls` into `toolcall_*`.
- Reverted the premature SDK execution surface:
  - deleted `pi-container/sdk-executor.mjs`
  - removed SDK branches from the Pi container
  - kept autonomous filesystem-authoring stages on `executionSurface: "rpc"`
- Added RPC-native tool-call observability:
  - records streamed `toolcall_start/toolcall_delta/toolcall_end` as `toolcall_stream`
  - summarizes assistant `message_end` with `stopReason`, `contentTypes`, and tool call names/counts without persisting arguments
  - records `toolCallEventCount`, `assistantToolCallCount`, and `toolExecutionEventCount` in filesystem tool probes
  - distinguishes no tool calls from tool calls that fail to execute
- Updated dispatcher/Worker types and tests so Pi execution surface is RPC-only while preserving `requiredCapabilities: ["filesystem_tools"]`.
- Redeployed ff-pipeline twice; final Worker version is `a5831588-f7af-4689-bb2d-57a5cae38bce`.

## Production evidence
- First post-deploy run `coding-adapter-autonomous-1779070357` completed in 48s but hit the previous Pi image (`082ceb5d`), proving the container rollout had not yet taken effect.
- Final smoke run `coding-adapter-rpcobs-1779071043` completed from `2026-05-18T02:24:07Z` to `2026-05-18T02:24:26Z`.
- Workflow result: `overall=fail`, `finalStage=PATCH`, `failureClass=gate_abort`.
- Result record persisted in R2 at `runs/coding-adapter-rpcobs-1779071043/artifacts/__observability/harness-result-record.json`.
- PATCH observation persisted in R2 at `runs/coding-adapter-rpcobs-1779071043/artifacts/__observability/PATCH.container-observation.json`.
- PATCH observation shows:
  - `executionSurface: "rpc"`
  - model route `openrouter/moonshotai/kimi-k2`
  - `tool_capability.probe_result.passed=false`
  - reason `no toolcall_* or tool_execution_* events observed during filesystem probe`
  - `toolExecutionEventCount=0`
  - `toolCallEventCount=0`
  - `assistantToolCallCount=0`
  - assistant `message_end` summary: `stopReason: "error"`, `contentTypes: []`, `toolCallCount: 0`
- Current Cloudflare container status after smoke: Pi app still reports rollout/provisioning and `containers info` shows prior active config `082ceb5d`, but the production observation schema confirms the new Pi container code executed for `coding-adapter-rpcobs-1779071043`.

## Verification
- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/tool-capability-probe.mjs` -> passed.
- Focused tests:
  `pnpm --filter @factory/ff-pipeline test src/harness-dispatcher.test.ts src/cf-workers.test.ts pi-container/tool-capability-probe.test.mjs pi-container/workspace-derived-artifacts.test.mjs`
  -> 4 files / 34 tests passed.
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- Full suite:
  `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism`
  -> 74 files / 1000 tests passed.
- `git diff --check` -> passed.

## Current conclusion
The SDK switch was not justified by Pi source. RPC already exposes the same tool definitions and event stream. The verified production symptom is now sharper: on `openrouter/moonshotai/kimi-k2`, Pi returns an assistant message with `stopReason: "error"` and emits zero streamed tool-call events and zero tool executions during the filesystem probe. The next milestone is model/provider routing for a tool-capable route or a constrained fallback architecture; not another transport switch.

## Commit scope
Stage only:
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
- `.agent/memory/working/WORKSPACE.md`
- `workers/ff-pipeline/pi-container/Dockerfile`
- `workers/ff-pipeline/pi-container/sdk-executor.mjs`
- `workers/ff-pipeline/pi-container/server.mjs`
- `workers/ff-pipeline/pi-container/tool-capability-probe.mjs`
- `workers/ff-pipeline/pi-container/tool-capability-probe.test.mjs`
- `workers/ff-pipeline/src/cf-workers.ts`
- `workers/ff-pipeline/src/cf-workers.test.ts`
- `workers/ff-pipeline/src/harness-dispatcher.ts`
- `workers/ff-pipeline/src/harness-dispatcher.test.ts`

Leave unrelated untracked files alone.
