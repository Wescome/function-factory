# Current Workspace

## Status
2026-05-18T01:55:00Z: FN-SYNTH-MIGRATE Pi SDK execution-surface routing implemented, deployed, production-verified, and ready to commit.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
- Added per-dispatch Pi execution routing: deterministic/non-filesystem stages use RPC, autonomous filesystem-authoring stages use SDK.
- Forwarded `execution` route metadata through harness dispatcher, Worker dispatch, and Pi container requests.
- Added `sdk-executor.mjs` to invoke `@earendil-works/pi-coding-agent` directly with runtime model/provider selection and filesystem tools enabled.
- Added SDK-surface filesystem probe handling before autonomous PATCH prompt turns, with container observations recording `executionSurface`, lifecycle events, and `tool_execution_*` counts.
- Kept deterministic materialization commands on the established RPC path for RPC surface and direct shell execution for SDK surface.
- Added dispatcher and Worker tests proving PATCH routes to SDK with `filesystem_tools` while PLAN remains RPC.
- Deployed ff-pipeline Worker version `082ceb5d-d9e6-4c24-b977-8559f2106d85`; Pi container app `a0367c71-dce7-43bd-ba24-0b6a247e9432` now uses image tag `082ceb5d`.
- Triggered production SDK run `coding-adapter-sdk2-1779068504` with the coding-adapter autonomous harness.

## Production evidence
- Workflow `factory-pipeline/coding-adapter-sdk2-1779068504` completed from `2026-05-18T01:41:48Z` to `2026-05-18T01:42:58Z`.
- Workflow result: `overall=fail`, `finalStage=PATCH`, `failureClass=gate_abort`.
- Result record persisted at `runs/coding-adapter-sdk2-1779068504/artifacts/__observability/harness-result-record.json`.
- PATCH observation persisted at `runs/coding-adapter-sdk2-1779068504/artifacts/__observability/PATCH.container-observation.json`.
- PATCH observation shows:
  - `executionSurface: "sdk"`
  - model route `openrouter/moonshotai/kimi-k2`
  - `routeKind: "coder"`
  - `seed_workspace.prepared` with file count 3
  - pre-prompt contract evaluation failed for missing `CandidatePatch`
  - `tool_capability.probe_start` with `surface: "sdk"`
  - SDK emitted `agent_start`, `turn_start`, assistant `message_end`, `turn_end`, and `agent_end`
  - `tool_capability.probe_result` with `passed=false`
  - reason `no tool_execution_* events observed during filesystem probe`
  - `toolExecutionEventCount=0`
  - `fileReadable=false`
- PATCH failed fast with `PI_TOOL_CAPABILITY_UNAVAILABLE` after the SDK probe, before repair rounds.

## Verification
- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/sdk-executor.mjs` -> passed.
- Focused tests for Pi/container/harness path -> 3 files / 27 tests passed.
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- `git diff --check` -> passed before deploy.
- Full suite: `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism` -> 74 files / 997 tests passed.

## Current conclusion
The latest production code proves the issue is not only RPC transport. In the autonomous seed path, the Pi SDK completed a probe chat turn on `openrouter/moonshotai/kimi-k2` but emitted zero `tool_execution_*` events and did not create the probe file. Coding-adapter autonomous authoring is blocked on a verified tool-capable model/provider route, or on an explicit architecture decision to add a constrained text-to-command fallback.

## Commit scope
Stage only:
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
- `.agent/memory/working/WORKSPACE.md`
- `workers/ff-pipeline/pi-container/Dockerfile`
- `workers/ff-pipeline/pi-container/sdk-executor.mjs`
- `workers/ff-pipeline/pi-container/server.mjs`
- `workers/ff-pipeline/src/cf-workers.ts`
- `workers/ff-pipeline/src/cf-workers.test.ts`
- `workers/ff-pipeline/src/harness-dispatcher.ts`
- `workers/ff-pipeline/src/harness-dispatcher.test.ts`

Leave unrelated untracked files alone.
