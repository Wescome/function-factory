# Current Workspace

## Status
2026-05-17T22:48:20Z: FN-SYNTH-MIGRATE JSON contract diagnostic/materialization fix is implemented, deployed, production-smoked, and ready to commit.

## Current branch
`factory/fp-motdwvr2-w7un`

## Completed this session
- Diagnosed `SmokeJsonArtifact` failure: R2 diagnostics did exist in `ff-workspaces`; the prior operator path/bucket was wrong, and Worker errors returned logical keys instead of full R2 keys.
- Added full R2 diagnostic key logging/return values for container observation and contract-evaluation artifacts.
- Made diagnostic persistence non-masking: R2 write failures now log `diagnostic.write_failed` instead of hiding the original Pi/container failure.
- Added Pi container observation previews for assistant `message_end` events.
- Added deterministic pre-prompt materialization for simple `json.required_fields` contracts, preserving the existing exact-line shortcut.
- Redeployed `ff-pipeline` version `473786de-7d73-43e5-8e14-75c47f87d14a`; Pi container application now uses image tag `473786de`.
- Verified production run `smoke-json-1779058069` completed in 10s with `overall=pass`, R2 result persistence, and `SmokeJsonArtifact` written.

## Production evidence
- Workflow: `factory-pipeline/smoke-json-1779058069` completed successfully.
- Worker tail: Pi dispatch returned `status=200`; logs included:
  - `diagnostic.written kind=observation key=runs/smoke-json-1779058069/artifacts/__observability/SMOKE.container-observation.json`
  - `diagnostic.written kind=contract-evaluation key=runs/smoke-json-1779058069/artifacts/__observability/SMOKE.contract-evaluation.json`
  - `artifact.written name=SmokeJsonArtifact bytes=75`
- Observation R2 artifact shows:
  - `contract.materialize_command` with `kind=json`
  - `contract.materialize_response` success
  - pre-prompt `contract.evaluation` pass
  - no prompt/repair turns
- `SmokeJsonArtifact` contents:

```json
{
  "status": "ok",
  "runId": "smoke-json-1779058069",
  "elapsedMs": 0
}
```

## Verification
- `node --check workers/ff-pipeline/pi-container/server.mjs && node --check workers/ff-pipeline/pi-container/contract-evaluator.mjs && node --check workers/ff-pipeline/pi-container/execution-contract.mjs`
- `pnpm --filter @factory/ff-pipeline test src/cf-workers.test.ts pi-container/contract-evaluator.test.mjs src/contract-compiler.test.ts src/harness-dispatcher.test.ts` -> 50 tests passed.
- `pnpm --filter @factory/ff-pipeline typecheck` -> passed.
- `pnpm --filter @factory/ff-pipeline exec vitest run --passWithNoTests --no-file-parallelism` -> 68 files / 961 tests passed.
- `git diff --check` -> passed.

## Commit scope
Stage only:
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
- `.agent/memory/working/WORKSPACE.md`
- `workers/ff-pipeline/pi-container/server.mjs`
- `workers/ff-pipeline/src/cf-workers.ts`
- `workers/ff-pipeline/src/cf-workers.test.ts`

Leave unrelated untracked files alone.
