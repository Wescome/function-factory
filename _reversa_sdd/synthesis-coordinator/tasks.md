# Tasks — synthesis-coordinator

> Unit: synthesis-coordinator
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — ADR-009 gate 6, D1 migration, v5.1)

---

## Implementation Tasks

### T-01: Implement TrellisExecutionPacket Validation and Certification
**Source:** `workers/ff-pipeline/src/coordinator/coordinator.ts:fetch()` lines 118-141
**Behavior:** Parse body, run `TrellisExecutionPacket.safeParse()`, then `certifyTrellisExecutionPacket()`. Return 400 on parse fail with `issues`; return 422 on certification fail with `diagnostics`.
**Criterion for done:** Invalid packet returns 400/422 with detailed diagnostics; valid packet proceeds to synthesize().
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement Idempotent Re-entry Check
**Source:** `coordinator.ts:synthesize()` early-exit block
**Behavior:** Read `graphState` from DO storage on every call. If `verdict.decision` is `pass|fail|interrupt`, return cached result immediately without re-executing.
**Criterion for done:** Calling /synthesize twice for same ES returns identical interrupt result on second call without any agent work.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement ADR-009 Gate (Always-Interrupt)
**Source:** `coordinator.ts:synthesize()` line ~403
**Behavior:** At the designated gate point, throw `new Error('[DEPRECATED] graph path removed...')`. Catch block converts to `interrupt` verdict. The Phase 2 atom dispatch block (lines 428-562) is intentionally left in place but unreachable.
**Criterion for done:** Every POST /synthesize with a valid packet returns interrupt verdict.
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement SYNTHESIS_RESULTS Queue Publish
**Source:** `coordinator.ts:notifyCallback()` lines 634-650
**Behavior:** Read `__workflowId` from DO storage. If present, send `{ workflowId, verdict, tokenUsage, repairCount }` to `SYNTHESIS_RESULTS` queue. Log errors but do not throw (non-fatal).
**Criterion for done:** Workflow receives synthesis-complete event after every synthesize() call; publish failure does not crash coordinator.
**Confidence:** 🟢 CONFIRMADO

### T-05: Wire Hot Config Loading
**Source:** `coordinator.ts:ensureConfigSeeded()`, `getConfigLoader()`
**Behavior:** On first synthesis, call `seedHotConfig(db)` (idempotent D1 upsert). Load config via `HotConfigLoader.get()`. Apply alias overrides per agent schema type to each resolved model.
**Criterion for done:** Model routing reflects D1 hot-config values; falls back to hardcoded defaults if D1 unreachable.
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement Coordinator Alarm Handler
**Source:** `coordinator.ts:alarm()` lines 164-184
**Behavior:** Check `__completed` — return immediately if done. Read or reconstruct GraphState. Write `interrupt` verdict to `graphState`. Set `__alarm_fired=true`, `__completed=true`. Call `notifyCallback()`.
**Criterion for done:** Alarm fires → Workflow receives interrupt verdict → is unblocked from waitForEvent.
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement onFiberRecovered Crash Recovery
**Source:** `coordinator.ts:onFiberRecovered()` lines 190-215
**Behavior:** Read `snapshot.executableSpecificationId` and `snapshot.state`. If state exists without a verdict: write interrupt verdict to storage, `__completed=true`, call `notifyCallback()`.
**Criterion for done:** After DO eviction and restart, Workflow is unblocked within one reconciliation cycle.
**Confidence:** 🟢 CONFIRMADO

### T-08: Implement AtomExecutor Pre-flight Auth Check
**Source:** `atom-executor-do.ts:handleExecuteAtom()` lines 126-167
**Behavior:** Before 900s alarm, call `resolveAgentModel('coder')` → `keyForModel()`. If no key: write failResult to DO storage, `__completed=true`, ingest `infra:llm-api-401` internal signal (best-effort), return HTTP 400. Do NOT set 900s alarm.
**Criterion for done:** Missing API key returns 400 immediately; DO storage has failResult; 900s alarm never set.
**Confidence:** 🟢 CONFIRMADO

### T-09: Implement AtomExecutor File Context Caching
**Source:** `atom-executor-do.ts:fetchFileContexts()` lines 343-436
**Behavior:**
- Skip if no GITHUB_TOKEN
- `resolveTargetFiles(atomSpec)` — priority: targetFiles → suggestedFiles → file → binding.target
- For each file: check ArangoDB `file_context_cache` by SHA (5-min TTL)
- On cache miss: fetch GitHub Contents API, UPSERT to ArangoDB cache
- Resolve imports one level deep (max 10 additional, mark `confidence:'inferred'`)
- Cache raw content in DO storage `file:{path}`
**Criterion for done:** Second execution with same file SHA avoids GitHub API call; import resolution follows 1-level deep.
**Confidence:** 🟢 CONFIRMADO

### T-10: Implement CompletionLedger in D1
**Source:** `workers/ff-pipeline/src/coordinator/completion-ledger.ts:1-158`
**Behavior:**
- `createLedger()`: Layer 0 atoms dispatched immediately; others in pendingAtoms; phase='dispatched'
- `recordAtomResult()`: read-modify-write in D1; increment completedAtoms; remove from pendingAtoms; if completedAtoms >= totalAtoms → phase='complete'
- `getReadyAtoms()`: return pendingAtoms whose all dependencies are in completedAtoms set
- `isComplete()`: returns completedAtoms >= totalAtoms
**Criterion for done:** After all atoms complete, ledger phase='complete'; getReadyAtoms() returns only dependency-satisfied atoms.
**Confidence:** 🟢 CONFIRMADO

### T-11: Implement Topological Sort for Layer Dispatch
**Source:** `workers/ff-pipeline/src/coordinator/layer-dispatch.ts:topologicalSort()` lines 34-99
**Behavior:** Kahn's algorithm grouping atoms into DependencyLayer[]. Cycle guard: if no zero-in-degree atoms found, dump remaining into one layer (no infinite loop).
**Criterion for done:** Atoms with no dependencies emit in Layer 0; dependent atoms emit in subsequent layers; cycle in atom graph does not cause infinite loop.
**Confidence:** 🟢 CONFIRMADO
