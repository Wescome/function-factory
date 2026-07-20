---
# 004-think-executor-gaps

## JTBD
When a ThinkExecutor receives an atom-execute request, I want it to atomically claim the bead before running, post to the /consent audit route, and dispatch the next ready bead after completion — so the CoordinatorDO state machine is never left in an inconsistent state and multi-bead molecules can progress.

## Source
Gaps identified in Reversa Reviewer patch 2026-06-13:
- GAP-THINK-01 (CRITICAL): claimBead never called in executeAtom() — assigned_to stays NULL, releaseBead/failBead silently no-op, stale alarm re-dispatches infinitely
- GAP-THINK-02 (CRITICAL): /consent route missing from CoordinatorDO.fetch() — ConsentBeadAuditProcessor POSTs to it, gets 404, audit trail broken
- GAP-THINK-03 (MODERATE): No next-bead dispatch after ThinkExecutor completes — multi-bead molecules stall

## Files
- packages/gears/src/agents/think-executor.ts (Fix 1)
- packages/gears/src/beads/coordinator-do.ts (Fix 2)
- workers/ff-pipeline/src/queue-handler.ts (Fix 3)

## Fix Specs

### Fix 1 — claimBead (think-executor.ts)
At the top of executeAtom(), before runFiber():
  POST /claim to coordinatorDO with body [directive.atomId, this.ctx.id.toString()]
  If response body is null → return early (already claimed)
  coordinatorDO already resolved via env binding (check releaseHook/failHook for the exact pattern)

### Fix 2 — /consent route (coordinator-do.ts)
Add route: if (url.pathname === "/consent") return Response.json(await this.recordConsent(await req.json()))
Add recordConsent() method with consent_audit SQLite table (CREATE TABLE IF NOT EXISTS)
Schema: id TEXT PK, bead_id TEXT NOT NULL, tool_name TEXT NOT NULL, tool_call_id TEXT, timestamp INTEGER NOT NULL

### Fix 3 — bead chaining (queue-handler.ts)
In atom-execute consumer, after stub.fetch() succeeds:
  Destructure runId from incoming message
  POST to CoordinatorDO /next with JSON.stringify(runId)
  For each ready bead in response, send to SYNTHESIS_QUEUE with type atom-execute

## Gates
- Fix 1: pnpm --filter @factory/gears typecheck
- Fix 2: pnpm --filter @factory/gears typecheck
- Fix 3: pnpm --filter @factory/ff-pipeline typecheck
- Final: pnpm typecheck
---
