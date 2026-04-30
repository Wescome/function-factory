# Strategy.Recipes Dogfood

Strategy.Recipes is an external product workload. Function Factory should build
it through the autonomous scheduler boundary instead of relying on a human or
Codex chat session to select each implementation step.

## Dry Run

Dry-run mode exercises the full scheduler path without invoking real `git`,
`codex`, or `gh` commands:

```bash
pnpm run autonomous-scheduler:cli -- dogfood-strategy-recipes \
  --repo-root /Users/wes/Developer/strategy-recipes
```

The command writes queue and evidence artifacts under:

```text
$HOME/.factory/dogfood/strategy-recipes/<run-id>/
├── queue/
└── bundle/
```

## Real Mode

Real mode is intentionally explicit:

```bash
pnpm run autonomous-scheduler:cli -- dogfood-strategy-recipes \
  --repo-root /Users/wes/Developer/strategy-recipes \
  --real
```

Real mode runs the planned `git`, `codex`, and `gh pr create` commands against
the Strategy.Recipes checkout. It still operates in PR/branch mode and does not
merge, deploy, force-push, delete remote branches, or edit secrets.

The scheduler pushes the worker branch before creating the pull request, so real
mode is non-interactive at the GitHub PR boundary.

Each dogfood run appends a run-specific branch suffix by default so retries do
not collide with earlier scheduler-created branches. Use `--branch-suffix` to
force a specific suffix.

## Source Request

The default request is:

`packages/autonomous-scheduler/fixtures/strategy-recipes-package-readme-agent-request.json`

The original first-product-view request remains available as a historical
fixture:

`packages/autonomous-scheduler/fixtures/strategy-recipes-agent-request.json`

Override with:

```bash
pnpm run autonomous-scheduler:cli -- dogfood-strategy-recipes \
  --request /path/to/request.json \
  --repo-root /path/to/strategy-recipes
```

## 2026-04-30 Real Dogfood Proof

The scheduler completed a real Strategy.Recipes dogfood run for:

```text
AR-STRATEGY-RECIPES-DOGFOOD-EVIDENCE
```

The run produced, pushed, and opened Strategy.Recipes PR #71:

```text
https://github.com/Wescome/strategy-recipes/pull/71
```

The PR was squash-merged after parent-environment verification and the local
Strategy.Recipes checkout was fast-forwarded to `main`.

Evidence bundle:

```text
/tmp/factory-dogfood-evidence/strategy-recipes/strategy-recipes-20260430T214225017Z/bundle
```

Parent verification completed successfully on the PR branch:

```text
pnpm --dir packages/strategy-objects test      # pass, 5/5
pnpm --dir packages/strategy-objects typecheck # pass
npm run test:strategy-recipes                  # pass, 127/127
```

The child Codex worker reported a sandbox limitation while attempting local
network-backed tests (`listen EPERM 127.0.0.1`) and could not mutate `.git`
directly from its sandbox. The parent scheduler still completed the intended
production-alpha boundary: parent-owned commit, push, PR creation, and
independent verification.

Follow-up hardening from this proof: the scheduler now reruns
`requiredCommands` from the parent process after committing worker changes and
before pushing the PR branch. Those commands are captured as
`verification_output` evidence in each result bundle.
