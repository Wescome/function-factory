# @factory/autonomous-scheduler

Contracts for the Function Factory autonomous scheduler boundary.

This package does not run Codex. It defines the fail-closed data shapes the
Governor and queue use to request Codex work, receive evidence, and record queue
events. It also includes a local JSONL queue reference implementation for
production-alpha dogfooding. Runtime implementations consume these contracts
from:

1. WorkGraph node selected by the Governor.
2. `AgentRequest` written to the queue.
3. Codex runner claims the request and opens a PR branch.
4. `AgentResult` returns test, diff, artifact, and PR evidence.
5. Coverage and verifier components decide the next WorkGraph node.

The initial operational posture is PR/branch mode. Direct default-branch
mutation, production deploys, force-pushes, and secret edits are explicitly
outside the permitted contract.

The Codex runner adapter currently plans and can execute commands through an
injectable executor:

1. Validate the `AgentRequest`.
2. Derive the PR branch name.
3. Produce git preflight commands.
4. Build the Codex worker prompt with policy, context, commands, and evidence requirements.
5. Execute the plan sequentially, stopping on the first non-zero exit.

Production wiring can use the built-in process executor; tests should inject a
deterministic executor. Runner command evidence can be converted into a
validated `AgentResult` and durable artifact bundle. Pull request creation is
also planned and executed through the same command seam using `gh pr create`.

`runSingleAgentRequest` wires the production-alpha happy path:

1. Enqueue an `AgentRequest`.
2. Claim it from the JSONL queue.
3. Execute the Codex runner plan.
4. Validate changed paths against the request policy.
5. Stage and commit worker changes from the parent scheduler process.
6. Run every `requiredCommands` entry from the parent scheduler process.
7. Create a PR only if the runner, commit, and parent verification succeed.
8. Build and persist a validated `AgentResult` bundle.
9. Complete the queue item with pass/fail evidence.

The parent scheduler owns `git add` and `git commit` because child Codex
workers run in a workspace-write sandbox that may edit files but should not
depend on direct `.git` mutation.

The parent scheduler also owns final verification. Child Codex workers still
receive the required commands in their prompt, but the scheduler reruns those
commands after the parent commit and before `git push` / `gh pr create`.
Verification failures stop publication, complete the queue item as failed, and
write `verification-output.txt` plus command-level output files into the result
bundle. This makes parent-observed tests and typechecks first-class evidence
rather than relying on child-session stdout.

Result bundles write every evidence path they advertise. Parent commits capture
`diff.patch` from the committed worker change, test commands aggregate into
`test-output.txt`, typecheck commands aggregate into `typecheck-output.txt`, and
parent verification commands aggregate into `verification-output.txt`.

`runQueueDaemon` repeats the same path for queued work with bounded polling,
claim leases, heartbeats, and stop predicates.

CLI entrypoint:

```bash
pnpm run autonomous-scheduler:cli -- validate-request packages/autonomous-scheduler/fixtures/strategy-recipes-agent-request.json
pnpm run autonomous-scheduler:cli -- enqueue /tmp/factory-queue packages/autonomous-scheduler/fixtures/strategy-recipes-agent-request.json
pnpm run autonomous-scheduler:cli -- status /tmp/factory-queue
```

`run-single` and `daemon` are intentionally explicit because they execute `git`,
`codex`, and `gh` against the requested repo.

Use `--dry-run` to exercise the queue, runner, PR, result, and bundle paths
without invoking external commands:

```bash
pnpm run autonomous-scheduler:cli -- run-single /tmp/factory-queue \
  packages/autonomous-scheduler/fixtures/strategy-recipes-agent-request.json \
  --repo-root /tmp/strategy-recipes \
  --bundle-dir /tmp/factory-bundle \
  --dry-run
```

Queue claims include leases and heartbeats. Expired claims can be reclaimed by a
later runner; active claims are excluded from pending queue counts.

The `dogfood-strategy-recipes` command defaults to the current next-slice
request:

```text
packages/autonomous-scheduler/fixtures/strategy-recipes-package-readme-agent-request.json
```

Use `--request` to replay older fixtures or run a freshly generated request.
