---
id: IS-TESSERA-PRE-COMMIT-GATE
version: 1
title: "Tessera Pre-Commit Gate — Diff-to-symbol reconciliation before git commit"
sourceCapabilityId: BC-TESSERA-PRE-COMMIT-GATE
sourceFunctionId: FP-TESSERA-PRE-COMMIT-GATE
source_refs:
  - TESSERA-GATE-CONOPS
  - IS-TESSERA-PRE-EDIT-GATE
  - IS-TESSERA-MCP
explicitness: explicit
rationale: >
  Gate 1 (IS-TESSERA-PRE-EDIT-GATE) catches *intent* — the blast radius of the
  symbol the agent says it is about to change. It cannot catch what actually
  landed in the diff. An agent that edits the correct function but drifts into
  an adjacent line, refactors a shared helper, or touches a neighboring symbol
  while threading a parameter produces a diff that no longer matches its stated
  intent. The 2026-06-01 gascity incident began as a single-function fix and
  ended touching the test seam `workflowServeList` — a symbol the agent never
  intended to change.

  This IS specifies Gate 2: a mandatory reconciliation between the staged diff
  and the agent's declared edit intent, run before `git commit`. The engine is
  `tessera_detect_changes`, which maps diff hunks to the symbols and execution
  flows they touch. The gate compares the resulting symbol set against the
  symbols the agent declared it intended to change and surfaces any symbol that
  appears in the diff but was never declared — the `unintended` set.

  Per TESSERA-GATE-CONOPS §3, the pre-commit gate WARNs on unintended diff
  rather than blocking outright: an unintended symbol is a signal to confirm or
  revert, not an automatic STOP. The agent must explicitly acknowledge or back
  out unintended changes before the commit proceeds. This gate is the safety
  net between "I meant to change X" (Gate 1) and "X plus three other things
  landed in the diff" (reality).
---

# Tessera Pre-Commit Gate

## JTBD

When a coding agent has made its edits and is about to commit, it wants to know
exactly which symbols its diff actually changed and whether any of them fall
outside what it set out to change, so it does not commit side effects it never
intended.

## Problem

Gate 1 fires before the first edit and reasons about a single declared target
symbol. It is blind to everything that happens after: multi-file edits, a
refactor of a shared helper, an IDE auto-format that rewrites a neighboring
function, a parameter threaded through three call sites. By the time the agent
reaches `git commit`, the diff is the ground truth — and nothing reconciles that
diff against the original intent.

The 2026-06-01 gascity incident is the canonical example. The agent's stated
intent was to fix a hanging test by making one event watcher use a cancelable
context. The diff that actually accumulated rerouted the production call path
and touched `workflowServeList`, the package-level function variable that 12
tests override as a test seam. Had a gate compared the diff's symbol set against
the declared intent before commit, `workflowServeList` would have surfaced as an
unintended symbol and the agent would have been forced to confirm or revert it
before the regression spiral began.

`tessera_detect_changes` already maps diff hunks to symbols and processes. What
is missing is enforcement: a gate that runs it against the staged diff at commit
time and reconciles the result against intent. Today that requirement lives only
in AGENTS.md prose ("MUST run `tessera_detect_changes()` before committing"),
which agents skip under context pressure.

## Goal

1. Implement a **pre-commit gate function** (`checkCommitGate`) in the Tessera
   Worker that coding agents MUST call before `git commit`. The gate:
   - Calls `tessera_detect_changes` on the staged diff
   - Reconciles the resulting changed-symbol set against the agent's declared
     edit intent (`intent: string[]`)
   - Returns a structured `CommitGateResult` (PROCEED / WARN)
   - WARN is returned whenever the diff contains symbols not present in the
     declared intent (the `unintended` set is non-empty)
   - PROCEED is returned when every changed symbol was declared

2. Expose `tessera_pre_commit_check` as the **15th MCP tool** on the Tessera
   Worker, callable by any agent via JSON-RPC before committing.

3. Add `tessera_pre_commit_check` to the gascity and function-factory AGENTS.md
   `## Never Do` block as a hard pre-commit requirement.

4. Produce a **gate audit log** entry in ArangoDB for every call:
   `tessera_pre_commit_gates` collection — repo, changed symbols, affected
   processes, unintended set, decision, agentId, timestamp. Immutable.

## Scope

**In scope:**
- `workers/tessera-worker/src/pre-commit-gate.ts` — `checkCommitGate()` + HTTP
  route `POST /repos/:slug/pre-commit-check`
- `workers/tessera-worker/src/mcp.ts` — register `tessera_pre_commit_check` as
  15th tool
- `workers/tessera-worker/src/schema.ts` — `tessera_pre_commit_gates`
  collection (append-only, no DELETE route)
- AGENTS.md in gascity and function-factory repos — add hard requirement

**Out of scope:**
- Any change to the `tessera_detect_changes` engine itself (its owning IS owns
  that)
- File-system-level enforcement (cannot prevent a raw `git commit --no-verify`)
- Blocking the commit at the git layer (the gate WARNs; the human/agent decides)
- Re-running impact analysis on changed symbols (that is Gate 3, pre-merge)

## Acceptance Criteria

### Gate logic (AC-PC*)

**AC-PC1.** `POST /repos/:slug/pre-commit-check` calls `tessera_detect_changes`
on the staged diff and accepts:
```json
{
  "intent": ["workflowServeQueue"],
  "agentId": "codex-agent-01"
}
```
`intent` is the list of symbol names the agent declared it set out to change.

**AC-PC2.** The gate returns:
```json
{
  "decision": "WARN",
  "changedSymbols": ["workflowServeQueue", "drainWorkflowServeWork", "workflowServeList"],
  "affectedProcesses": ["runWorkflowServe", "runConvoyControlServe"],
  "unintended": ["workflowServeList"],
  "message": "1 symbol in diff was not in stated intent: workflowServeList. Confirm or revert before committing."
}
```
where `unintended` = symbols present in the diff but absent from `intent`.

**AC-PC3.** When `unintended` is non-empty the gate returns `WARN` (not STOP).
The agent must confirm the unintended symbols (documenting rationale) or revert
them — it is not blocked outright, but it MUST NOT commit silently. When
`unintended` is empty the gate returns `PROCEED`.

**AC-PC4.** Every `pre-commit-check` call writes a document to
`tessera_pre_commit_gates` (append-only):
```json
{
  "_key": "<uid>",
  "repo": "gascity",
  "intent": ["workflowServeQueue"],
  "changedSymbols": ["workflowServeQueue", "drainWorkflowServeWork", "workflowServeList"],
  "affectedProcesses": ["runWorkflowServe", "runConvoyControlServe"],
  "unintended": ["workflowServeList"],
  "decision": "WARN",
  "agentId": "codex-agent-01",
  "timestamp": "2026-06-01T..."
}
```
There is NO DELETE route. The collection is append-only and immutable.

**AC-PC5.** When the index is stale (commit mismatch between the repo and
`tessera_meta`), the gate returns `WARN` with the explicit message
"Index is stale — re-index before this check is authoritative." It MUST NEVER
return `PROCEED` on a stale index, even when `unintended` is empty.

### MCP tool (AC-MCP*)

**AC-MCP1.** `tessera_pre_commit_check` is registered as the 15th MCP tool.
Input schema matches AC-PC1. Output schema matches AC-PC2.

**AC-MCP2.** The tool is listed in `tools/list` alongside the existing tools
and documented in TESSERA-CF-SPEC §6 (update required).

### Audit log (AC-LOG*)

**AC-LOG1.** `GET /repos/:slug/pre-commit-gates` returns the last 50 pre-commit
checks for a repo, most recent first, including all WARN decisions and their
`unintended` sets.

### AGENTS.md enforcement (AC-AGENTS*)

**AC-AGENTS1.** `gascity/AGENTS.md` and `function-factory/AGENTS.md`
`## Never Do` block includes:
```
- NEVER run git commit without first calling tessera_pre_commit_check.
  A WARN result with unintended symbols requires the agent to confirm or
  revert those symbols before committing. This is not advisory.
```

### Reference case (AC-REF*)

**AC-REF1.** Replaying the 2026-06-01 gascity diff through the gate with
`intent: ["workflowServeQueue"]` returns `decision: "WARN"` and
`unintended` includes `workflowServeList`. The audit log records the warning
and the agent's confirm/revert decision.

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var | Database name |
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth |

Inherits all env from IS-TESSERA-MCP and the `tessera_detect_changes` engine.
No new env vars.

## Non-negotiables

- `tessera_detect_changes` is the engine. The gate is a reconciliation layer
  OVER it, not a replacement. Both must be callable independently.
- The gate MUST NOT auto-proceed when the diff contains unintended symbols. It
  WARNs and requires the agent to confirm or revert. Silent commit of
  unintended diff violates the contract.
- The audit log is immutable. There is no API to delete or modify gate entries.
- A stale index returns WARN, never PROCEED.
- AGENTS.md enforcement is part of this IS. Per TESSERA-GATE-CONOPS §5, the
  risk→decision mapping, audit-trail immutability, and AGENTS.md enforcement
  contracts are shared across all five gates and apply here unchanged.

## Success Metrics

The 2026-06-01 class of incident — an agent committing a diff that touched a
symbol it never intended to change — cannot reach `main` silently:

1. An agent that commits after editing the correct function but drifting into a
   neighboring symbol receives WARN before the commit lands.
2. The `unintended` set names every symbol in the diff that was not declared in
   intent, so the agent (or operator) can confirm or revert with full context.
3. The audit log shows the pre-commit check ran, the unintended set, and the
   agent's confirm/revert decision.
4. Every indexed repo's AGENTS.md makes the pre-commit check mandatory — not
   advisory, mandatory.
