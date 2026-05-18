# Current Workspace

## Status
2026-05-18T18:29:00Z: Implemented container rollout transient retry/recovery hardening; deploy/smoke verification pending.

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

## Commit
- Pending commit for container rollout transient retry/recovery hardening.

## Notes
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
