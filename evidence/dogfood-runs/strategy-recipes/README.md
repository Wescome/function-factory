# Strategy.Recipes Dogfood Runs

This directory contains repo-tracked scheduler run records for Strategy.Recipes,
an external product workload used to dogfood Function Factory autonomy.

Each run directory contains:

- `manifest.json`: durable run index with schema, hashes, replay seed, PR URL, and relative evidence paths.
- `request.json`: the original `AgentRequest` that can seed a replay.
- `execution.json`: command execution record from the scheduler.
- `result.json`: normalized `AgentResult` with repo-relative evidence references.
- `commands/`: captured command output files.
- Aggregate evidence files such as `verification-output.txt` when present.

These records are intentionally checked in so production-alpha dogfood evidence
survives cleanup of `/tmp` or `$HOME/.factory` runtime bundles.
