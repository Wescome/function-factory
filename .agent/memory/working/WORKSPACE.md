# Current Workspace

## Status
2026-05-18T01:30:00Z: FN-SYNTH-MIGRATE Pi tool capability probe milestone implemented, deployed, production-verified, and ready to commit.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
- Added `tool-capability-probe.mjs` for Pi RPC filesystem capability detection.
- Added a one-turn probe before any Pi prompt turn that still requires declared output files to be authored by the model.
- Recorded `tool_execution_*` counts in container observations.
- Fail closed with `PI_TOOL_CAPABILITY_UNAVAILABLE` before repair rounds when the probe cannot observe tool execution and cannot read the probe file.
- Kept deterministic workspace-derived artifacts confined to seed fixtures with `expectedChanges`; oracle-free seeds no longer derive `CandidatePatch`.
- Aligned the dispatcher fallback model with the container/Wrangler default: `openrouter/moonshotai/kimi-k2`.
- Deployed ff-pipeline Worker version `f5859c1e-333c-4035-acbe-8d20ded4d30f`; Pi container app `a0367c71-dce7-43bd-ba24-0b6a247e9432` now uses image tag `f5859c1e`.
- Uploaded current harness YAML to remote R2 object `ff-workspaces/coding-adapter`.
- Triggered production autonomous run `coding-adapter-autonomous-1779067534` with `harnesses/coding-adapter-autonomous.seed-workspace.json`.

## Production evidence
- Workflow `factory-pipeline/coding-adapter-autonomous-1779067534` completed from `2026-05-18T01:25:38Z` to `2026-05-18T01:26:23Z`.
- Workflow result: `overall=fail`, `finalStage=PATCH`, `failureClass=gate_abort`.
- Result record persisted at `runs/coding-adapter-autonomous-1779067534/artifacts/__observability/harness-result-record.json`.
- PATCH observation persisted at `runs/coding-adapter-autonomous-1779067534/artifacts/__observability/PATCH.container-observation.json`.
- PATCH observation shows:
  - model route `openrouter/moonshotai/kimi-k2`
  - `seed_workspace.prepared` with file count 3
  - pre-prompt contract evaluation failed for missing `CandidatePatch`
  - `tool_capability.probe_start`
  - one assistant turn completed
  - `tool_capability.probe_result` with `passed=false`
  - reason `no tool_execution_* events observed during filesystem probe`
  - `toolExecutionEventCount=0`
  - `fileReadable=false`
- `SeedWorkspace` in R2 had no `expectedChanges`, confirming this was the oracle-free autonomous seed path.

## Verification
- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/tool-capability-probe.mjs` -> passed.
- Focused tests for Pi/container/harness path -> 9 files / 60 tests passed.
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- `git diff --check` -> passed before deploy.
- Full suite: `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism` -> 74 files / 996 tests passed.

## Current conclusion
The latest production code proves the issue is not stale event naming. In the autonomous seed path, Pi RPC completed a probe chat turn on `openrouter/moonshotai/kimi-k2` but emitted zero `tool_execution_*` events and did not create the probe file. Coding-adapter autonomous authoring is blocked on a model/provider/SDK route that can execute filesystem tools.

## Commit scope
Stage only:
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
- `.agent/memory/working/WORKSPACE.md`
- `workers/ff-pipeline/pi-container/Dockerfile`
- `workers/ff-pipeline/pi-container/server.mjs`
- `workers/ff-pipeline/pi-container/tool-capability-probe.mjs`
- `workers/ff-pipeline/pi-container/tool-capability-probe.test.mjs`
- `workers/ff-pipeline/pi-container/workspace-derived-artifacts.test.mjs`
- `workers/ff-pipeline/src/harness-dispatcher.ts`
- `workers/ff-pipeline/src/harness-dispatcher.test.ts`

Leave unrelated untracked files alone.
