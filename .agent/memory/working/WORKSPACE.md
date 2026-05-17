# Current Workspace

## Status
Updated 2026-05-17 19:52 UTC. Session must-do items 2-4 completed.

## Completed

- Architect model-routing review completed:
  - Pi model is resolved per dispatch, not per container boot.
  - `PI_MODEL` remains a fallback/default only.
  - Dispatcher sends a structured `model` route in the Worker -> Container payload.
  - Container validates explicit model IDs against an allowlist before spawning Pi.
- Architect observability review completed:
  - Container returns bounded in-band execution observations in `/execute`.
  - Worker persists observations to R2 under `__observability/<stage>.container-observation.json`.
  - Non-2xx container responses persist observations and throw compact errors with observation refs.
- Implementation completed:
  - Per-dispatch Pi routing in `src/harness-dispatcher.ts`, `src/cf-workers.ts`, and `pi-container/server.mjs`.
  - Observation capture/redaction in `pi-container/server.mjs`.
  - Harness result persistence fallback to R2 when prod Arango lacks `verification_reports`.
  - Worker dispatch now includes `runId`, so container observations are attributable.
- Production redeployed:
  - Current Worker version: `78694805-4686-43b3-9f3d-43418e9ce8c7`
  - Pi container application: `a0367c71-dce7-43bd-ba24-0b6a247e9432`

## Verification

- `node --check workers/ff-pipeline/pi-container/server.mjs` passed.
- Targeted tests passed:
  - `pnpm --filter @factory/ff-pipeline test src/cf-workers.test.ts src/harness-dispatcher.test.ts src/pipeline.test.ts`
  - `pnpm --filter @factory/ff-pipeline test src/atoms-complete-wiring.test.ts src/diagnostic-routes.test.ts src/queue-bridge.test.ts src/stage6-handoff.test.ts`
- Full ff-pipeline test run had suite-level timing/interference failures in unrelated synthesis/diagnostic tests; those same files passed in isolation.
- `pnpm --filter @factory/ff-pipeline typecheck` still fails only on pre-existing coordinator strictness and harness-bridge test casts:
  - `src/coordinator/coordinator.ts`
  - `src/harness-bridge.test.ts`

## Production Smoke

Clean smoke run: `smoke-1779047485`

- Trigger: `/trigger-harness` with `harnessKey: pi-smoke`
- Workflow status: completed successfully in 13 seconds.
- `harness-complete-1`: `{"overall":"pass","finalStage":"SMOKE"}`
- `record-harness-result-1`: succeeded via R2 fallback:
  - `runs/smoke-1779047485/artifacts/__observability/harness-result-record-fallback.json`
  - Fallback reason: Arango `verification_reports` missing (`[530] error code: 1016`)
- Container observation:
  - `runs/smoke-1779047485/artifacts/__observability/SMOKE.container-observation.json`
  - `runId: smoke-1779047485`
  - model: `anthropic/claude-sonnet-4.5`
  - route kind: `worker`
  - resolved via: `config-default`
  - Pi lifecycle events captured; stderr tail empty.
- Artifact:
  - `runs/smoke-1779047485/artifacts/SmokeArtifact`
  - content was the pre-seeded smoke artifact.

## Remaining Notes

- Pi executed but still did not write `SmokeArtifact` itself. Observation records the missing file. The clean smoke intentionally used a pre-seeded artifact to validate container dispatch, observation, gate completion, and Arango fallback independently of Pi artifact-writing behavior.
- Follow-up if desired: improve Pi prompting/tooling so the agent writes declared outputs reliably instead of relying on preseeded artifacts.
