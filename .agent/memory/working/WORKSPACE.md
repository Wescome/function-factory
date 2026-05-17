# Current Workspace

## Status
Active pickup from prior ff-pipeline/Pi container session.

## Last update
2026-05-17T18:07:06Z

## Current thread

- Prior session left local edits for live Pi container dispatch after commits through `728dbdd` (`FN-SYNTH-MIGRATE: wire live worker registry into harness completeness check`).
- Local code patch currently changes Pi RPC handling to send `{ type: "prompt", message }`, wait for `agent_end`, use HTTP for internal CF Container dispatch, retry Pi container cold start, and add stage/dispatch observability.
- Verification this pickup:
  - `pnpm --filter @factory/ff-pipeline test` passed after local edits: 65 files, 915 tests.
  - `node --check workers/ff-pipeline/pi-container/server.mjs` passed.
  - `pnpm --filter @factory/ff-pipeline typecheck` still fails on remaining branch debt: archived coordinator tests included by typecheck, older coordinator strictness, `RunCoordinator.fetch` missing `override`, `harness-bridge.test.ts` casts, and a `harness-dispatcher.test.ts` mock type. The local `PiContainer.fetch` `override` regression and `cf-workers.test.ts` cast failures were fixed.
- Untracked local files remain outside the current dispatch patch: `scripts/ops/restore-arango-secrets.sh`, `specs/reference/_archive/`, `specs/reference/crystalizer_dsl.md`, `specs/reference/tessera-capability-exposure.md`, and `workers/ff-pipeline/.wrangler/`.

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
