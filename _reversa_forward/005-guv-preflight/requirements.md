# 005-guv-preflight

## JTBD

When GUV is about to orchestrate a workflow, I want it to read current state first and return the minimum necessary intervention, so the factory never re-runs completed work, clobbers patched code, or launches fresh when a journal exists.

---

## Problem Statement

GUV made three consecutive bad orchestration decisions on 004-think-executor-gaps:
1. Applied architect conditions directly (bypassed the loop)
2. Launched a full 7-phase workflow when code was already patched and only the architect loop remained
3. Did not check for a resumable journal before launching fresh

Root cause: no enforced pre-flight gate. GUV acted on intent instead of state.

The pre-flight skill is that gate. It runs before every `Workflow()` call and returns a typed decision. GUV cannot orchestrate without it.

---

## Inputs

```typescript
interface PreFlightInput {
  featureId:      string    // e.g. "004-think-executor-gaps"
  workflowName:   string    // e.g. "think-executor-gaps" — matches script meta.name
  targetFiles:    string[]  // absolute paths the workflow touches
  sessionDir:     string    // path to .claude/projects/<session>/workflows/
  progressFile:   string    // absolute path to _reversa_forward/<featureId>/progress.jsonl
  finalTaskId:    string    // task ID that marks the feature done e.g. "T007"
}
```

---

## Output

```typescript
interface PreFlightResult {
  action:           'resume' | 'continue' | 'full' | 'noop'
  runId?:           string    // present for 'resume' — pass as resumeFromRunId
  scriptPath?:      string    // present for 'resume' — path to existing script
  completedTasks?:  string[]  // present for 'continue' — tasks already done
  patchedFiles?:    string[]  // present for 'continue' — files already modified
  haltReason?:      string    // what halted and why (from progress.jsonl or task output)
  reason:           string    // human-readable decision rationale
}
```

---

## Decision Logic

Execute these reads in order. Stop at the first conclusive signal.

### Step 1 — Check final task status (noop gate)
Read `progress.jsonl`. If `finalTaskId` has `status: "done"` → return `noop`.
The feature is complete. Nothing to run.

### Step 2 — Check for resumable journal
List `<sessionDir>/*.json` files. For each, parse and check:
- `meta.name === workflowName`
- `status !== 'completed'` (not already finished)
- Agent entries exist (journal has real data)

If a matching live journal exists → return `resume` with its `runId` and `scriptPath`.

### Step 3 — Check code state (continue gate)
Run `git status --short <targetFiles>`. If any file is modified (M) or untracked (??) → code has been patched by a prior run.

Read `progress.jsonl` to determine which tasks completed. Read the last workflow task output to find the last recorded log line (what phase it was in when it stopped).

Return `continue` with:
- `completedTasks` — tasks with `status: "done"` in progress.jsonl
- `patchedFiles` — files with M or ?? status
- `haltReason` — last log line from prior run output

### Step 4 — Full run
No journal, no patched files, no completed tasks. Return `full`.

---

## Decision Map

| Journal? | Code patched? | Tasks done? | Action |
|----------|--------------|-------------|--------|
| Yes (live) | — | — | `resume` |
| No | Yes | Any | `continue` |
| No | No | None | `full` |
| — | — | finalTask done | `noop` |

---

## Integration Point

GUV calls pre-flight as the FIRST agent in any workflow orchestration:

```javascript
// In every workflow script — Phase 0
phase('Pre-flight')
const preflight = await agent(preFlightPrompt(input), {
  schema: PREFLIGHT_RESULT_SCHEMA,
  label: 'preflight',
  phase: 'Pre-flight',
})

if (preflight.action === 'noop') {
  log('Pre-flight: feature already complete — nothing to do')
  return
}

if (preflight.action === 'resume') {
  log('Pre-flight: resumable journal found — resuming ' + preflight.runId)
  // Caller uses resumeFromRunId: preflight.runId
  return preflight  // GUV reads this and calls Workflow({ scriptPath, resumeFromRunId })
}

if (preflight.action === 'continue') {
  log('Pre-flight: code patched, no journal — writing continuation workflow')
  log('Completed tasks: ' + preflight.completedTasks.join(', '))
  log('Halted at: ' + preflight.haltReason)
  // Remaining workflow phases derived from completedTasks
}

// action === 'full': proceed normally
```

**Alternative — standalone pre-flight call before launching any workflow:**
GUV runs pre-flight as a one-shot Agent call, reads the result, then decides which script to launch (or resume). This keeps pre-flight out of the workflow script itself and makes it a true governor-layer gate.

---

## Skill File

Lives at: `~/.claude/skills/GUVPreFlight/SKILL.md`

Callable via: `subagent_type: 'GUVPreFlight'` in any workflow, or as a direct Agent call from GUV before launching.

The skill reads the four state sources (progress.jsonl, journal directory, git status, last task output) and applies the decision logic above. Returns `PreFlightResult` as structured output.

---

## Enforcement

Add to `sop-workflow-pattern.md` under a new **Pre-Flight Gate** section:

> GUV MUST run pre-flight before every `Workflow()` call.
> No exceptions. If pre-flight is skipped, the orchestration is invalid.

Add to GUV's `guv.yaml` operating rules:

> **PRE-FLIGHT MANDATORY [critical]**
> Before launching any Workflow(), call GUVPreFlight.
> The result determines the action: resume, continue, full, or noop.
> Never launch fresh without confirming no journal or patched code exists.

---

## Acceptance Criteria

```gherkin
Given a feature with a completed final task in progress.jsonl
When GUV runs pre-flight
Then action = 'noop' and no workflow is launched

Given a feature with a live workflow journal
When GUV runs pre-flight
Then action = 'resume' with the correct runId

Given a feature with patched files but no journal
When GUV runs pre-flight
Then action = 'continue' with completedTasks and haltReason populated

Given a feature with no prior work
When GUV runs pre-flight
Then action = 'full'
```

---

## Out of Scope

- Pre-flight does not fix the code. It only reads state and returns a decision.
- Pre-flight does not choose which continuation workflow to write. GUV does that based on `completedTasks` and `haltReason`.
- Pre-flight does not run typechecks or impact analysis. Those belong inside the workflow.
