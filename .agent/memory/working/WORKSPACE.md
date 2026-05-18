# Current Workspace

## Status
2026-05-18T21:02:00Z: Added local operator watch CLI on top of production `/run-monitor`.

## Changes in progress
- Added executable `scripts/ops/watch-run.mjs`.
- Added root `pnpm watch:run` script.
- Watch command renders a compact stage table, recent timeline, artifacts, diagnostics, and optional attempt-log tail.
- Supports `--once`, `--json`, `--base-url`, `--interval`, `--limit`, `--logs active|none|STAGE`, `--log-lines`, and `--no-clear`.

## Verification
- `pnpm exec vitest run scripts/ops/watch-run.test.mjs` passed (4 tests).
- `node scripts/ops/watch-run.mjs coding-freeform-prod-1779136814 --once --limit 5 --logs RELEASE --log-lines 8` rendered production stage/timeline/artifact/log view.
- `node scripts/ops/watch-run.mjs coding-freeform-prod-1779136814 --json` returned valid monitor JSON.
- `pnpm watch:run coding-freeform-prod-1779136814 --once --limit 3 --logs none` rendered through package script.
- `git diff --check` passed.

## Commit
- Pending commit for operator watch CLI.

## Notes
- Existing unrelated untracked files remain out of scope.
- `.agent/memory/semantic/DECISIONS.md` has a pre-existing unstaged edit not made by this turn; leave it untouched.
