# Repository ADRs

This directory is for repository/process ADRs that govern how the project is
operated or integrated. Factory architecture ADRs also exist in
[`../../specs/reference/`](../../specs/reference/README.md) because they are
part of the broader architecture/spec corpus.

## Current ADRs

| ADR | Status | Scope |
| --- | --- | --- |
| [`ADR-0001-autonomous-scheduler-boundary.md`](ADR-0001-autonomous-scheduler-boundary.md) | Accepted | Defines the autonomous scheduler boundary: Function Factory emits `AgentRequest` records, Codex runners claim work, and completed work returns `AgentResult` evidence. |
| [`ADR-0012-candidatepatch-untracked-file-fix.md`](ADR-0012-candidatepatch-untracked-file-fix.md) | Accepted | Fixes CandidatePatch untracked-file blindness: patch capture must run `git add -A && git diff --cached` so agent-created files are not silently omitted. |
| [`ADR-0013-ladybugdb-closed-loop-artifact-graph.md`](ADR-0013-ladybugdb-closed-loop-artifact-graph.md) | Accepted | Establishes LadybugDB as the closed-loop artifact graph store, replacing ArangoDB with Cloudflare D1. |

## Relationship To `specs/reference/ADR-*`

The ADRs under `specs/reference/` describe Factory architecture decisions such
as Stage 6 execution, graph runners, vertical slicing, output reliability, and
self-healing. They are indexed in
[`../../specs/reference/README.md`](../../specs/reference/README.md).

Do not consolidate the two ADR locations as part of routine docs cleanup. A
move would need an explicit migration decision because existing links,
architecture references, and session handoffs may depend on current paths.
