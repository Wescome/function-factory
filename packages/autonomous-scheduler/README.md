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
validated `AgentResult`; the next integration slice is writing the artifact
bundle contents to disk and wiring PR creation.
