# SPEC-DEVOPS-FENCE-001 — Deploy Fence Endpoints (INV-8)

**Status:** APPROVED v2 — Architect + SE unanimous; auto-approved  
**Date:** 2026-06-03  
**v1 findings:** closed path union, wrong DO class name, wrong index.ts cluster, DO fence placed after proxy rewrite, redundant Worker route, singleton literal duplication — all fixed in v2  
**Closes:** SPEC-FF-DEVOPS-001-v2: `/__pi-container/fence` and `/__supervisor/fence` implemented  

**Source anchors:**
- `workers/ff-pipeline/src/coordinator/pi-container.ts` lines 36 (ACTIVE_EXECUTION_KEY), 46 (ActiveExecution type), 86-95 (DO fetch routing block), 408-421 (record/clearActiveExecution)
- `workers/ff-pipeline/src/index.ts` lines 60-64 (fetchPiContainerDiagnostic path union), 1402-1414 (authed `/__pi-container/*` cluster), 2457-2468 (authorizeOperatorControl)
- `workers/gascity-supervisor/src/index.ts` lines 4 (GasCitySupervisor class), 41-91 (DO fetch: keepalive routes then localhost rewrite at line 66), 192-206 (Worker auth + singleton catch-all)

**Active-state signals:**
- ff-pipeline: `ACTIVE_EXECUTION_KEY` in PiContainer DO storage
- gascity-supervisor: `keepalive_refcount` in GasCitySupervisor DO storage

---

## 1. `GET /__pi-container/fence` (ff-pipeline)

### 1.1 Purpose

Allow the deploy pipeline to poll whether the pi-container is processing an active molecule. Returns `active: true` while `ACTIVE_EXECUTION_KEY` is set.

### 1.2 Implementation — three edits

**Edit 1 — Widen `fetchPiContainerDiagnostic` path union** (`index.ts:62`):
```typescript
// Before:
path: '/__pi-container/status' | '/__pi-container/restart' | '/health',

// After:
path: '/__pi-container/status' | '/__pi-container/restart' | '/health' | '/__pi-container/fence',
```

**Edit 2 — Add proxy route to authed `/__pi-container/*` cluster** (`index.ts` near line 1408, alongside the existing `/__pi-container/status` route):
```typescript
if (url.pathname === '/__pi-container/fence' && request.method === 'GET') {
  const auth = authorizeOperatorControl(request, env)
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  return fetchPiContainerDiagnostic(env, '/__pi-container/fence', 'GET')
}
```

**Edit 3 — Add `fenceResponse()` to PiContainer class and wire it** (`pi-container.ts`):

Add method to PiContainer class:
```typescript
private async fenceResponse(): Promise<Response> {
  const activeExecution = await this.ctx.storage.get<ActiveExecution>(ACTIVE_EXECUTION_KEY)
  const now = Date.now()
  const startedAt = activeExecution?.startedAt
  return new Response(
    JSON.stringify({
      active: Boolean(activeExecution),
      ...(activeExecution
        ? {
            runId: activeExecution.runId,
            stageName: activeExecution.stageName,
            startedAt,
            ageMs: startedAt ? now - new Date(startedAt).getTime() : undefined,
          }
        : {}),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
```

Wire it in PiContainer `fetch()` routing block (lines 86-95), **before** `ensureContainerReady()` at line 97, alongside the existing `/__pi-container/status` handler:
```typescript
if (url.pathname === '/__pi-container/fence') {
  return this.fenceResponse()
}
```

*(Must be before `ensureContainerReady()` so the fence answers correctly even when the container is cold or restarting.)*

### 1.3 Acceptance criteria

- `AC-P1`: `GET /__pi-container/fence` with valid `OPERATOR_CONTROL_TOKEN` returns `{ active: false }` when `ACTIVE_EXECUTION_KEY` is not set.
- `AC-P2`: returns `{ active: true, runId, stageName, startedAt, ageMs }` when `ACTIVE_EXECUTION_KEY` is set.
- `AC-P3`: returns 401/403 without valid auth (inherits `authorizeOperatorControl` behavior).
- `AC-P4`: response time < 500ms (single DO storage read, no container interaction).

### 1.4 Files

- `workers/ff-pipeline/src/index.ts` — two edits: widen union type at line 62; add proxy route near line 1408
- `workers/ff-pipeline/src/coordinator/pi-container.ts` — add `fenceResponse()` method; wire in `fetch()` before `ensureContainerReady()`

---

## 2. `GET /__supervisor/fence` (gascity-supervisor)

### 2.1 Purpose

Allow the deploy pipeline to poll whether Gas City is actively processing a molecule before triggering a gascity-supervisor image deploy. Returns `active: true` while `keepalive_refcount > 0`.

### 2.2 Implementation — two edits

**The Worker-level route is NOT needed.** The existing generic catch-all at `gascity-supervisor/src/index.ts:192-206` already authenticates via `GC_SUPERVISOR_TOKEN` and forwards all unmatched paths to the `GasCitySupervisor` DO singleton. Adding only the DO-side handler is sufficient.

**Edit 1 — Hoist singleton name to a shared constant** (`gascity-supervisor/src/index.ts`, at module level before the class):
```typescript
const SUPERVISOR_SINGLETON = "singleton-v43"
```
Then replace both occurrences of the literal `"singleton-v43"` in the file with `SUPERVISOR_SINGLETON` (line 204 in the Worker catch-all).

**Edit 2 — Add fence handler to `GasCitySupervisor` DO** (`fetch()` method), **BEFORE line 66** (before the CSRF header injection and `http://localhost` rewrite):
```typescript
// Insert BEFORE the CSRF/localhost-rewrite block (line 66):
if (url.pathname === '/__supervisor/fence') {
  const refcount = (await this.ctx.storage.get<number>('keepalive_refcount')) ?? 0
  return new Response(
    JSON.stringify({ active: refcount > 0, refcount }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
```

*(Must be before line 66. The DO's fetch rewrites all unmatched requests to `http://localhost:9443` — any fence handler after that point gets proxied into the gc binary container and returns garbage.)*

### 2.3 Acceptance criteria

- `AC-S1`: `GET /__supervisor/fence` with valid `GC_SUPERVISOR_TOKEN` returns `{ active: false, refcount: 0 }` when `keepalive_refcount` is 0 or absent.
- `AC-S2`: returns `{ active: true, refcount: N }` when `keepalive_refcount > 0`.
- `AC-S3`: returns 401 without valid `GC_SUPERVISOR_TOKEN` (existing catch-all behavior).
- `AC-S4`: response time < 500ms (single DO storage read).

### 2.4 Files

- `workers/gascity-supervisor/src/index.ts` — two edits: hoist `SUPERVISOR_SINGLETON` const; add DO-side fence handler before line 66
