# Current Workspace

## Status
2026-05-18T18:35:00Z: Deployed and verified container rollout transient retry/recovery hardening.

## Changes in progress
- Added bounded retry around Cloudflare container dispatch when fetch throws `The container is not running, consider calling start()`.
- Retry policy is infra-specific: up to 3 attempts with backoff, no retry for normal non-2xx/model/tool failures.
- Emits `container_dispatch_retried` and `container_dispatch_recovered` events, plus Tier-1 `[INFRA SIGNAL] infra:container-dispatch-recovered`.
- Exhausted container-not-running failures are classified as `infrastructure_error`, not `step_error`.
- Manifest stage records now include `containerDispatchRetries` recovery evidence.

## Verification
- Focused tests passed: `pnpm --filter @factory/ff-pipeline test src/cf-workers.test.ts src/harness-dispatcher.test.ts src/observability/run-event-log.test.ts` (3 files / 31 tests).
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- Default ff-pipeline tests passed: `pnpm --filter @factory/ff-pipeline test` (78 files / 1039 tests).
- `pnpm --filter @factory/ff-pipeline exec wrangler deploy --dry-run` passed.
- `git diff --check` passed.
- Commit `4bacca3 FN-SYNTH-MIGRATE: retry container rollout transient` pushed to `factory/fp-motdwvr2-w7un`.
- Deployed ff-pipeline Worker version `90c9a684-d569-4cdb-ac4e-d668eea6004c` with `--containers-rollout=immediate`.
- Triggered production smoke `pi-rollout-retry-smoke-1779129097` without manually warming `/debug/pi-container/health` first.
- Smoke completed/pass with `stepAccounting.ok=["SMOKE"]`, `eventCount=11`, and no `container_dispatch_*` retry events needed in this run.
- `/run-artifacts/pi-rollout-retry-smoke-1779129097` returned completed manifest with `SMOKE` stage pass, observation key, artifact key, and value-level gate results.
- Attempt log `runs/_attempt-logs/pi-rollout-retry-smoke-1779129097/SMOKE/attempt-1.log` showed `exists`, `json_field_equals`, and `json_field_type` passed.
- Direct R2 artifact `runs/pi-rollout-retry-smoke-1779129097/artifacts/SmokeJsonArtifact` is valid JSON with matching runId and numeric elapsedMs.
- Direct R2 observation proves `authoringMode="autonomous_filesystem"`, `materializeContracts=false`, tool execution present, no failed contract artifacts, and matching container `workerVersionId`.

## Commit
- `4bacca3 FN-SYNTH-MIGRATE: retry container rollout transient`
- Pending memory closeout commit.

## Notes
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
