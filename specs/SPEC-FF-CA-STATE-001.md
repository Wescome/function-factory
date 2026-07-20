# SPEC-FF-CA-STATE-001 — CommissioningAgentDO Run-State Persistence

**Status:** Implemented
**Worker:** `workers/ff-commissioning-agent/`
**Package:** `packages/commissioning-agent/`
**Target:** `packages/commissioning-agent/src/index.ts`
**Mastra:** `@mastra/core@1.42.1`

## Problem Statement

`caCompilerWorkflow` (Mastra `createWorkflow`) has no persistence storage backend, so `getWorkflowRunById()` always returns null and `handlePoll` always reports `phase=idle`. Worse, `run.startAsync()` is fire-and-forget: when `handleSignal` returns 202 the Worker execution context ends and the in-flight workflow is killed mid-run. The DO must own its own durable run-state in SQLite rather than querying Mastra, and must hold the execution context open with `waitUntil` until the workflow settles.

## Invariants Preserved

- **CA-INV-001** — DO stays a thin stub: no alarm handler, no phase state machine, no LLM loop. SQLite is bookkeeping for poll, not a state machine that drives the workflow.
- **CA-INV-002** — workflow I/O remains schema-validated; the DO reads only `CaWorkflowOutput.isNodeId` from the typed `success` result.
- **CA-INV-005** — no new LLM calls; this change touches lifecycle only.
- **CA-INV-007** — human-approval suspension stays `workflow.suspend()`; the DO records `status='suspended'` but never implements its own approval gate.

## DDL Change

Sessions table gains a status column (idempotent `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS sessions (
  sessionId   TEXT PRIMARY KEY,
  runId       TEXT NOT NULL,
  orgId       TEXT NOT NULL,
  isNodeId    TEXT,
  status      TEXT NOT NULL DEFAULT 'running',
  createdAt   TEXT NOT NULL
)
```

`status` domain: `'running' | 'completed' | 'failed' | 'suspended'`.

## handleSignal — waitUntil pattern

```
parse + validate signal
rc = new RequestContext([['env', this.env]])

run = await caCompilerWorkflow.createRun()   // runId available synchronously (Run.runId)
runId = run.runId

// INSERT BEFORE start() so the first poll always finds a row
this.sql.exec(
  `INSERT OR REPLACE INTO sessions
     (sessionId, runId, orgId, isNodeId, status, createdAt)
   VALUES (?, ?, ?, NULL, 'running', ?)`,
  signal.sessionId, runId, signal.orgId, new Date().toISOString())

// Keep the DO alive while the workflow runs
this.doCtx.waitUntil(
  run.start({ inputData: signal, requestContext: rc })
    .then((result) => {
      if (result.status === 'success') {
        sql.exec(`UPDATE sessions SET status='completed', isNodeId=? WHERE sessionId=?`,
          result.result.isNodeId, signal.sessionId)
      } else if (result.status === 'suspended') {
        sql.exec(`UPDATE sessions SET status='suspended' WHERE sessionId=?`, signal.sessionId)
      } else {
        sql.exec(`UPDATE sessions SET status='failed' WHERE sessionId=?`, signal.sessionId)
      }
    })
    .catch(() => {
      sql.exec(`UPDATE sessions SET status='failed' WHERE sessionId=?`, signal.sessionId)
    }))

return jsonResponse({ status:'commissioned', sessionId, runId, orgId }, 202)
```

**Notes:**
- Use `run.start()`, not `startAsync()` — `start()` returns the full `WorkflowResult` we need.
- The `suspended` branch resolves (does not reject), so it MUST be handled in `.then()`, not `.catch()`.
- `result.result` is Mastra's field name (not `result.output`).

## handlePoll — read SQLite, no Mastra call

```
SELECT sessionId, runId, orgId, isNodeId, status FROM sessions WHERE sessionId=?
404 if no row
phase = mapDbStatusToPhase(row.status)
return { sessionId, runId, phase, status:'ok', isNodeId: row.isNodeId ?? null }
```

Delete the `caCompilerWorkflow.getWorkflowRunById(...)` call and its `state` plumbing entirely.

## Status mapping

`mapDbStatusToPhase` keyed on the SQLite `status` domain:

```
running    → 'commissioning'
completed  → 'idle'
failed     → 'idle'
suspended  → 'suspended-approval'
```

## Risk — createRun() runId availability

VERIFIED in `@mastra/core@1.42.1`: `createRun()` returns `Promise<Run>`; `Run` exposes `readonly runId: string`. The runId is available synchronously after `createRun()` resolves, before `start()`. INSERT-before-start ordering is safe.

## TypeScript Implications

- `private doCtx: DurableObjectState` on the class; `waitUntil(promise)` is on `DurableObjectState`.
- `run.start(...)` returns `Promise<WorkflowResult<…>>`, discriminated union on `status`. Narrow with `result.status === 'success'` before reading `result.result`.
- `handlePoll` `SessionRow` type adds `status: string`.
- `Phase` import unchanged; `mapDbStatusToPhase(status: string): Phase`.

## Acceptance Criteria

1. POST `/signal` then immediate GET → `phase=commissioning` (row exists pre-start).
2. After workflow completes → poll returns `phase=idle`, `isNodeId` populated (`IS-…`).
3. Signal with `requireHumanApproval=true` → after settle, poll returns `phase=suspended-approval`.
4. Workflow throwing → poll returns `phase=idle`, row has `status='failed'`.
5. No `getWorkflowRunById` call remains in `handlePoll`.
