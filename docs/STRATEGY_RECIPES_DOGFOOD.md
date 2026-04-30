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

## Source Request

The default request is:

`packages/autonomous-scheduler/fixtures/strategy-recipes-agent-request.json`

Override with:

```bash
pnpm run autonomous-scheduler:cli -- dogfood-strategy-recipes \
  --request /path/to/request.json \
  --repo-root /path/to/strategy-recipes
```
