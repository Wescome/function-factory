---
id: IS-TESSERA-PRE-MERGE-GATE
version: 1
title: "Tessera Pre-Merge Gate — CI blast-radius analysis on every PR, CRITICAL blocks merge"
sourceCapabilityId: BC-TESSERA-PRE-MERGE-GATE
sourceFunctionId: FP-TESSERA-PRE-MERGE-GATE
source_refs:
  - TESSERA-GATE-CONOPS
  - IS-TESSERA-PRE-EDIT-GATE
  - IS-TESSERA-IMPACT
  - IS-TESSERA-MCP
explicitness: explicit
rationale: >
  Gate 1 (pre-edit) and Gate 2 (pre-commit) operate inside the agent's session,
  before the first edit and before the commit. They depend on the agent calling
  them. Gate 3 is the CI-enforced safety net for everything those gates missed:
  multi-commit PRs, edits assembled across a session, side effects an agent
  never recognized, and human contributions that never touched a Tessera gate at
  all. It fires automatically on every pull request and cannot be skipped by an
  agent under context pressure, because it runs in CI, not in the agent.

  Per TESSERA-GATE-CONOPS §3 (Gate 3), the pre-merge gate computes the diff
  between the PR base and head, runs `tessera_impact` on every changed symbol,
  aggregates the risk, and posts a structured impact comment on the PR. CRITICAL
  risk sets a `failure` commit status that blocks merge; HIGH sets a `warning`
  status that informs reviewers without blocking; MEDIUM and LOW pass with a
  report. This is the gate that converts blast-radius intelligence from an
  in-session advisory into a merge-blocking CI requirement.

  The mechanism mirrors IS-TESSERA-INDEXER: the same GitHub App that indexes the
  repo posts the commit status and PR comment. The gate is triggered by the
  `pull_request` webhook (opened, synchronize), so every push to a PR branch
  re-evaluates the full blast radius.
---

# Tessera Pre-Merge Gate

## JTBD

When a pull request is opened or updated, the CI system wants to know the full
blast radius of every changed symbol in the PR diff, so that reviewers see
structured impact data and CRITICAL changes block merge automatically rather
than slipping through unreviewed.

## Problem

The pre-edit and pre-commit gates live inside the coding agent's session. They
catch what the agent declares and what the agent commits — but only if the agent
calls them. They are blind to:

- **Multi-commit PRs** — blast radius assembled across many commits, where no
  single commit looks dangerous but the aggregate is HIGH.
- **Cross-session edits** — an agent working across resets, or several agents
  contributing to one branch.
- **Human contributions** — a developer who edits directly and never invokes a
  Tessera tool.
- **Side effects the agent never recognized** — anything that slipped past
  Gate 1's single-symbol intent and Gate 2's diff reconciliation.

By the time a PR is open, all edits are assembled and the diff is final. This is
the last point before `main` where the full blast radius can be computed and
surfaced to a human reviewer. Today nothing does this automatically. A PR that
touches the `runWorkflowServe` chain and quietly raises risk to HIGH merges with
no signal to the reviewer, because the impact data — though it exists in
Tessera — is never pulled into the PR review surface.

`tessera_impact` already computes upstream blast radius per symbol. What is
missing is a CI trigger that runs it across every changed symbol in a PR diff,
aggregates the risk, blocks merge on CRITICAL, and writes the result where the
reviewer will see it: the PR commit status and a structured PR comment.

## Goal

1. Implement a **pre-merge gate function** (`checkMergeGate`) in the Tessera
   Worker, triggered by CI on every PR. The gate:
   - Computes the diff between the PR `base` and `head` git refs
   - Runs `tessera_impact` on every changed symbol in that diff
   - Aggregates risk: overall risk = the highest individual symbol risk
   - Maps overall risk to a GitHub commit status and a PR comment
2. Expose `POST /repos/:slug/pre-merge-check` accepting `{ base, head }`,
   designed to be called by CI (the `pull_request` webhook handler), not by
   agents directly.
3. Use the **GitHub App token** (the same identity as IS-TESSERA-INDEXER) to set
   the commit status and post the PR comment.
4. Produce a **gate audit log** entry in ArangoDB for every PR check:
   `tessera_pre_merge_gates` collection. Immutable.

## Scope

**In scope:**
- `workers/tessera-worker/src/pre-merge-gate.ts` — `checkMergeGate()` + HTTP
  route `POST /repos/:slug/pre-merge-check`
- `workers/tessera-worker/src/github.ts` — `pull_request` webhook handler
  (opened, synchronize) that invokes the route; commit-status and PR-comment
  helpers using the GitHub App token
- `workers/tessera-worker/src/schema.ts` — `tessera_pre_merge_gates`
  collection (append-only, no DELETE route)

**Out of scope:**
- Any change to the `tessera_impact` engine itself (IS-TESSERA-IMPACT owns that)
- Re-indexing logic (IS-TESSERA-INDEXER owns the index lifecycle; this gate
  consumes the index it produces)
- Auto-merge or auto-revert (the gate sets status and comments; merge policy is
  GitHub branch protection, configured out of band)
- Agent-facing MCP tool — this gate is CI-triggered, not agent-invoked

## Acceptance Criteria

### Gate logic (AC-PM*)

**AC-PM1.** `POST /repos/:slug/pre-merge-check` accepts `{ base, head }` (git
refs). It computes the diff between them, extracts the changed symbols, and runs
`tessera_impact` on each:
```json
{ "base": "main", "head": "factory/fix-timeout" }
```

**AC-PM2.** The gate aggregates risk across all changed symbols. The overall PR
risk equals the highest individual symbol risk (CRITICAL > HIGH > MEDIUM > LOW).

**AC-PM3.** Overall risk maps to a GitHub commit status:

| Overall risk | Commit status | Merge effect |
|--------------|---------------|--------------|
| CRITICAL | `failure` | Blocks merge (via branch protection) |
| HIGH | `warning` (or `success` with warning context) | Does not block; reviewer warned |
| MEDIUM | `success` | Passes with report |
| LOW | `success` | Passes with report |

**AC-PM4.** The gate posts a structured comment on the PR containing: a table of
changed symbols, the affected processes, the overall risk level, and the d=1
callers for any symbol that individually scored HIGH or CRITICAL:
```
## Tessera Pre-Merge Impact

| Changed symbol | Risk | d=1 callers |
|----------------|------|-------------|
| workflowServeList | HIGH | runWorkflowServe, runWorkflowServeFollow, ... |

Affected processes: runWorkflowServe, runConvoyControlServe
Overall risk: HIGH — reviewer must verify test coverage on the serve chain.
```

**AC-PM5.** Every `pre-merge-check` writes a document to
`tessera_pre_merge_gates` (append-only):
```json
{
  "_key": "<uid>",
  "repo": "gascity",
  "base": "main",
  "head": "factory/fix-timeout",
  "prNumber": 72,
  "changedSymbols": 4,
  "affectedSymbols": 18,
  "risk": "HIGH",
  "affectedProcesses": ["runConvoyControlServe"],
  "commitStatus": "warning",
  "timestamp": "2026-06-01T..."
}
```
There is NO DELETE route. The collection is append-only and immutable.

**AC-PM6.** The gate uses the GitHub App token (the same App identity that
IS-TESSERA-INDEXER uses) to set the commit status and post the PR comment. No
new credential is introduced.

**AC-PM7.** When the index is stale relative to the PR head commit, the gate
sets a `warning` (not `failure`, not `success`) commit status with the explicit
message "Index is stale relative to this PR head — re-index before this check is
authoritative," and re-runs once the indexer catches up (synchronize event).
It MUST NEVER post a clean `success` on a stale index.

### Reference case (AC-REF*)

**AC-REF1.** A PR that modifies `dispatch_runtime.go` and
`cmd_convoy_dispatch_test.go` in gascity, where a changed symbol routes through
the `runWorkflowServe` chain, returns overall risk HIGH, sets a `warning` commit
status, and posts a PR comment naming the affected processes and the d=1 callers
of the HIGH symbol. A PR that changes a symbol with no upstream callers returns
LOW and a `success` status.

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var | Database name |
| `GITHUB_APP_ID` | var | GitHub App identity (shared with indexer) |
| `GITHUB_APP_PRIVATE_KEY` | secret | GitHub App token signing (shared with indexer) |
| `GITHUB_WEBHOOK_SECRET` | secret | Verify `pull_request` webhook signatures |

Inherits the GitHub App credentials from IS-TESSERA-INDEXER. No new App is
registered.

## Non-negotiables

- CRITICAL blocks merge (`failure` commit status). HIGH does not block but MUST
  warn (status + comment). There is no silent pass on HIGH or CRITICAL.
- The gate runs in CI, triggered by the `pull_request` webhook — it does not
  depend on an agent calling it.
- `tessera_impact` is the engine; the gate aggregates across the PR diff but
  does not reimplement impact analysis.
- The audit log is immutable. There is no API to delete or modify gate entries.
- A stale index returns a `warning` status, never a clean `success`.
- Per TESSERA-GATE-CONOPS §5, the risk→decision mapping, audit-trail
  immutability, and AGENTS.md enforcement contracts are shared across all five
  gates and apply here unchanged.

## Success Metrics

No HIGH- or CRITICAL-risk change reaches `main` without a reviewer seeing its
blast radius:

1. Every PR receives a Tessera impact comment and a commit status before merge.
2. A CRITICAL-risk PR is blocked from merging until a human clears it.
3. A HIGH-risk PR shows the reviewer the affected processes and d=1 callers, so
   the review decision is informed, not blind.
4. The audit log records the blast radius of every PR evaluated, enabling
   retrospective analysis of which changes carried the most risk.
