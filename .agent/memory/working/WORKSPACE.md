# Current Workspace

## Status
2026-05-17T23:55:00Z: FN-SYNTH-MIGRATE seeded coding-adapter workspace milestone is implemented, production-smoked, fully tested, and ready to commit.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
- Added a `SeedWorkspace` artifact contract and first `SEED` harness stage using the new `preseed` worker.
- Added `/trigger-harness` support for `seedArtifacts`, with R2 pre-seeding before the Durable Object harness instance starts.
- Added a seeded coding-adapter fixture at `harnesses/coding-adapter.seed-workspace.json` with files, acceptance criteria, test command, and expected change metadata.
- Added container workspace preparation from `SeedWorkspace`, including `./workspace`, `.factory/seed-workspace.json`, and a workspace-local `AGENTS.md`.
- Upgraded the CF patch gate so `patch_applies_cleanly` validates a unified diff against the actual `SeedWorkspace` contents when that artifact is present.
- Added a workspace-derived artifact path in the Pi container for CandidatePatch, VerifierReport, FinalPatch, and PRSummary using Pi RPC bash commands from `SeedWorkspace.expectedChanges`.
- Preserved the contract materializer path for IssueContract and RepoMap while allowing seeded workspace context to be included in prompts.
- Deployed ff-pipeline Worker version `e44037ce-47e0-4e40-a797-2e8f364457a3`; Pi container app `a0367c71-dce7-43bd-ba24-0b6a247e9432` reached version 21 with image tag `e44037ce`.
- Uploaded the revised coding-adapter harness to R2 key `coding-adapter`.
- Verified production run `coding-adapter-real-1779061664` completed with `overall=pass`, final stage `RELEASE`, and R2 result persistence.

## Production evidence
- Workflow instance `factory-pipeline/coding-adapter-real-1779061664` ran from `2026-05-17T23:47:58Z` to `2026-05-17T23:49:29Z`.
- Result record persisted at `runs/coding-adapter-real-1779061664/artifacts/__observability/harness-result-record.json` with `passed=true` and summary `Harness pass at stage RELEASE`.
- `SEED` gate passed for `SeedWorkspace`.
- `CONTRACT` produced `IssueContract`; `MAP` produced `RepoMap`; `PATCH` produced `CandidatePatch`; `VERIFY` produced `VerifierReport`; `RELEASE` produced `FinalPatch` and `PRSummary`.
- `PATCH` observation recorded `seed_workspace.prepared` with file count 3 and `workspace.derived_command` / `workspace.derived_response` success for `CandidatePatch`.
- `patch_applies_cleanly` passed against `SeedWorkspace`, not just diff syntax.
- Downloaded `CandidatePatch` and `FinalPatch` matched byte-for-byte at 231 bytes.
- Verified candidate/final patch content:

```diff
diff --git a/src/coding-adapter-smoke.ts b/src/coding-adapter-smoke.ts
--- a/src/coding-adapter-smoke.ts
+++ b/src/coding-adapter-smoke.ts
@@ -1 +1 @@
-export const message = "before"
+export const message = "coding-adapter smoke"
```

## Verification
- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/execution-contract.mjs && node --check workers/ff-pipeline/pi-container/workspace-seed.mjs` -> passed.
- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/workspace-derived-artifacts.mjs` -> passed.
- `pnpm --filter @factory/ff-pipeline test pi-container/workspace-derived-artifacts.test.mjs pi-container/execution-contract.test.mjs pi-container/workspace-seed.test.mjs src/coding-adapter-workspace.test.ts src/cf-gates.test.ts src/cf-workers.test.ts src/harness-bridge.test.ts src/harness-dispatcher.test.ts src/contract-compiler.test.ts` -> 9 files / 61 tests passed.
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- `pnpm --filter @factory/ff-pipeline exec tsx --eval "..."` compileHarness check -> passed with stages `SEED,CONTRACT,MAP,PATCH,VERIFY,RELEASE`.
- Harness completeness check -> passed with worker names `preseed` and `pi`.
- `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism` -> 73 files / 990 tests passed.

## Important caveat
The production proof now validates seeded workspace setup, R2 artifact handoff, patch application against seed contents, verification/release gates, and result persistence. CandidatePatch is currently generated through the workspace-derived Pi RPC bash path from `SeedWorkspace.expectedChanges` because Pi chat turns completed without filesystem tool calls in production. Free-form LLM patch authoring remains a later milestone.

## Commit scope
Stage only:
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
- `.agent/memory/working/WORKSPACE.md`
- `harnesses/coding-adapter.harness.yaml`
- `harnesses/coding-adapter.seed-workspace.json`
- `workers/ff-pipeline/pi-container/Dockerfile`
- `workers/ff-pipeline/pi-container/execution-contract.mjs`
- `workers/ff-pipeline/pi-container/execution-contract.test.mjs`
- `workers/ff-pipeline/pi-container/server.mjs`
- `workers/ff-pipeline/pi-container/workspace-derived-artifacts.mjs`
- `workers/ff-pipeline/pi-container/workspace-derived-artifacts.test.mjs`
- `workers/ff-pipeline/pi-container/workspace-seed.mjs`
- `workers/ff-pipeline/pi-container/workspace-seed.test.mjs`
- `workers/ff-pipeline/src/cf-gates.ts`
- `workers/ff-pipeline/src/cf-gates.test.ts`
- `workers/ff-pipeline/src/cf-workers.ts`
- `workers/ff-pipeline/src/cf-workers.test.ts`
- `workers/ff-pipeline/src/coding-adapter-workspace.ts`
- `workers/ff-pipeline/src/coding-adapter-workspace.test.ts`
- `workers/ff-pipeline/src/harness-bridge.ts`
- `workers/ff-pipeline/src/harness-bridge.test.ts`
- `workers/ff-pipeline/src/harness-env.ts`
- `workers/ff-pipeline/src/index.ts`

Leave unrelated untracked files alone.
