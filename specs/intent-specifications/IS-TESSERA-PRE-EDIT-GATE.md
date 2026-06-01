---
id: IS-TESSERA-PRE-EDIT-GATE
version: 1
title: "Tessera Pre-Edit Impact Gate — Mandatory blast-radius check before any symbol edit"
sourceCapabilityId: BC-TESSERA-IMPACT
sourceFunctionId: FP-TESSERA-PRE-EDIT-GATE
source_refs:
  - TESSERA-GATE-CONOPS
  - TESSERA-CF-SPEC
  - IS-TESSERA-IMPACT
  - IS-TESSERA-MCP
  - BC-TESSERA-IMPACT
explicitness: explicit
rationale: >
  On 2026-06-01, a coding agent edited workflowServeQueue in gascity/cmd/gc/
  dispatch_runtime.go without first running impact analysis. workflowServeList
  is the test seam that 12+ RunWorkflowServe* tests stub to inject beads.
  By changing the production call path to bypass workflowServeList, every
  test that relied on that seam immediately failed ("controlled beads = nil").
  The agent then spent 45 minutes making iterative fixes that each introduced
  new regressions, ending with a compile error and a full revert.

  The root cause is not a bad agent — it is an absent gate. No tool forced
  the agent to check blast radius before touching the symbol. This IS
  specifies that gate: a mandatory tessera_impact call before any symbol
  edit, with a hard STOP on HIGH or CRITICAL risk unless explicitly
  overridden by the human operator.

  This is UC-1 from TESSERA-CF-SPEC — the critical path. It is not optional
  infrastructure. Every future coding agent session on any indexed repo MUST
  go through this gate.
---

# Tessera Pre-Edit Impact Gate

## JTBD

When a coding agent is about to edit a function, method, or class, it wants
to know the blast radius of that change — every direct caller, every affected
test, every execution flow — before writing a single line, so it does not
introduce regressions it cannot see.

## Problem

### What happened (2026-06-01, gascity)

A coding agent was fixing test timeout failures in `cmd/gc`. The targeted
fix was legitimate: `TestRunWorkflowServeFollowUsesSweepFallback` was hanging
because the event watcher used `context.Background()` instead of a cancelable
context.

The agent then changed the production call path in `workflowServeQueue` to
route through a new `workflowServeQueueFn` variable instead of the existing
`workflowServeList`. This was architecturally motivated — the test was not
hitting the right stub. But the agent did not know:

- `workflowServeList` is a package-level function variable (test seam) used
  by **12 RunWorkflowServe* tests** to inject controlled beads.
- Changing the call path to bypass `workflowServeList` made every one of
  those tests return `controlled beads = nil`.
- 45 minutes of iterative fixes followed, each introducing new regressions,
  ending with a compile error (`no new variables on left side of :=`) and
  a full revert.

**The entire incident was preventable with one command run before the first
edit:**

```
tessera_impact({ target: "workflowServeList", direction: "upstream", repo: "gascity" })
```

That call would have returned: 12+ callers at d=1, multiple test functions,
risk CRITICAL or HIGH — and the agent would have known the seam must be
preserved before touching the call path.

### Why the gate does not exist today

Tessera runs locally. Coding agents (Codex, GasCity coders) run in
Cloudflare Workers or Containers. There is no enforceable mechanism that
forces an agent to call `tessera_impact` before an edit. The requirement
exists only in AGENTS.md prose ("MUST run impact analysis before editing
any symbol") — which agents can and do skip when context is tight or the
fix looks obvious.

## Goal

1. Implement a **pre-edit gate function** (`checkEditGate`) in the Tessera
   Worker that coding agents MUST call before any symbol mutation. The gate:
   - Calls `tessera_impact` on the target symbol
   - Returns a structured `EditGateResult` (PROCEED / WARN / STOP)
   - STOP is returned for CRITICAL or HIGH risk unless the operator has
     explicitly acknowledged the risk via `override: true`
   - WARN is returned for MEDIUM risk (agent may proceed with documented
     rationale)
   - PROCEED is returned for LOW risk

2. Expose `tessera_pre_edit_check` as a **14th MCP tool** on the Tessera
   Worker, callable by any agent via JSON-RPC before any file edit.

3. Add `tessera_pre_edit_check` to the GasCity AGENTS.md `## Never Do`
   block as a hard requirement alongside the existing impact/detect_changes
   rules.

4. Produce a **gate audit log** entry in ArangoDB for every call:
   `tessera_pre_edit_gates` collection — symbol, repo, risk, decision,
   override flag, timestamp. Immutable. Agents cannot delete it.

## Scope

**In scope:**
- `workers/tessera-worker/src/pre-edit-gate.ts` — `checkEditGate()` + HTTP
  route `POST /repos/:slug/pre-edit-check`
- `workers/tessera-worker/src/mcp.ts` — register `tessera_pre_edit_check`
  as 14th tool
- `workers/tessera-worker/src/schema.ts` — `tessera_pre_edit_gates`
  collection (append-only, no DELETE route)
- AGENTS.md in gascity and function-factory repos — add hard requirement
- CLAUDE.md in gascity — add to `## Never Do` block

**Out of scope:**
- Enforcement at the file-system level (cannot prevent a raw file write)
- Blocking CI/CD if gate was not called (V2 — CI gate)
- Retroactive audit of past edits
- Any change to the impact analysis engine itself (IS-TESSERA-IMPACT owns that)

## Acceptance Criteria

### Gate logic (AC-GATE*)

**AC-GATE1.** `POST /repos/:slug/pre-edit-check` accepts:
```json
{
  "target": "workflowServeList",
  "kind": "Function",
  "direction": "upstream",
  "override": false
}
```

**AC-GATE2.** The gate calls `tessera_impact` internally and maps risk to
decision:

| Risk | Decision | Meaning |
|------|----------|---------|
| CRITICAL | STOP | Edit blocked. Override required. |
| HIGH | STOP | Edit blocked. Override required. |
| MEDIUM | WARN | Proceed with documented rationale. |
| LOW | PROCEED | Safe to edit. |
| UNKNOWN | WARN | Symbol not found or index stale. |

**AC-GATE3.** When `override: true` is passed with a STOP decision, the gate
returns `PROCEED_WITH_OVERRIDE` and logs the override in
`tessera_pre_edit_gates` with `overridden: true`. Only a human operator
may pass `override: true` — automated agents must surface STOP to the
human and wait for explicit approval.

**AC-GATE4.** The gate response includes the full impact result so the agent
can surface it to the operator:
```json
{
  "decision": "STOP",
  "risk": "HIGH",
  "impactedCount": 14,
  "directCallers": ["runWorkflowServe", "runWorkflowServeFollow", ...],
  "message": "14 symbols impacted at d=1. Edit workflowServeList requires human review.",
  "impact": { ... }
}
```

**AC-GATE5.** The exact failure case from 2026-06-01 must return STOP:
`tessera_pre_edit_check({ target: "workflowServeList", repo: "gascity" })`
returns `decision: "STOP"`, `risk: "HIGH"` or `"CRITICAL"`, and
`directCallers` includes at least 5 `RunWorkflowServe*` functions.

### Audit log (AC-LOG*)

**AC-LOG1.** Every `pre-edit-check` call writes a document to
`tessera_pre_edit_gates`:
```json
{
  "_key": "<uid>",
  "repo": "gascity",
  "target": "workflowServeList",
  "risk": "HIGH",
  "decision": "STOP",
  "overridden": false,
  "agentId": "codex-agent-01",
  "timestamp": "2026-06-01T...",
  "impactedCount": 14
}
```

**AC-LOG2.** There is NO DELETE route for `tessera_pre_edit_gates`.
The collection is append-only. Audit log entries are immutable.

**AC-LOG3.** `GET /repos/:slug/pre-edit-gates` returns the last 50 gate
checks for a repo, most recent first. Includes overrides.

### MCP tool (AC-MCP*)

**AC-MCP1.** `tessera_pre_edit_check` is registered as the 14th MCP tool.
Input schema matches AC-GATE1. Output schema matches AC-GATE4.

**AC-MCP2.** The tool is listed in `tools/list` alongside the other 13
tools and is documented in TESSERA-CF-SPEC §6 (update required).

### AGENTS.md enforcement (AC-AGENTS*)

**AC-AGENTS1.** `gascity/AGENTS.md` `## Never Do` block includes:
```
- NEVER edit a function, class, or method without first calling
  tessera_pre_edit_check. A STOP result requires human operator
  acknowledgment before proceeding. This is not advisory.
```

**AC-AGENTS2.** `gascity/AGENTS.md` `## Always Do` block includes an
explicit example showing the 2026-06-01 failure case and the command
that would have prevented it:
```
# Before editing workflowServeList (or any function):
tessera_pre_edit_check({ target: "workflowServeList", repo: "gascity" })
# → STOP: 14 callers, risk HIGH. Do not proceed without operator approval.
```

### Reference case (AC-REF*)

**AC-REF1.** The 2026-06-01 incident is the acceptance fixture. After
indexing the current gascity codebase:
- `tessera_pre_edit_check({ target: "workflowServeList", repo: "gascity" })`
  returns `decision: "STOP"`
- `tessera_pre_edit_check({ target: "workflowServeQueue", repo: "gascity" })`
  returns `decision: "STOP"` or `"WARN"` (it has 4 upstream callers
  including `runWorkflowServe` — the agent should have checked this too)
- The gate audit log shows both checks were run before the edit
- Without the gate: 45 minutes of regressions, a compile error, full revert

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var | Database name |
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth |

Inherits all env from IS-TESSERA-IMPACT and IS-TESSERA-MCP. No new env vars.

## Non-negotiables

- `tessera_pre_edit_check` calls `tessera_impact` internally — it is a
  gate OVER impact analysis, not a replacement. Both must be callable
  independently.
- STOP means STOP. The gate must not auto-proceed on HIGH/CRITICAL — it
  must surface to the human. An agent that bypasses STOP without
  `override: true` is violating the contract.
- The audit log is immutable. There is no API to delete or modify gate
  entries. Override is logged, not hidden.
- AGENTS.md enforcement is part of this IS — the gate has no value if
  agents do not know it is mandatory.

## Success Metrics

The 2026-06-01 incident cannot recur:

1. An agent running `tessera_pre_edit_check` on `workflowServeList` in
   gascity receives STOP before writing a single line of code.
2. The 45-minute regression spiral collapses to a 30-second gate check.
3. The audit log shows the pre-edit check was run, the risk was HIGH,
   and the operator approved the override before the edit proceeded.
4. Every indexed repo's AGENTS.md makes the gate mandatory — not advisory,
   not "should", mandatory.

The gate is not a suggestion. It is the line between an agent that ships
and an agent that reverts.
