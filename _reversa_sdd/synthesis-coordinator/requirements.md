# Requirements — synthesis-coordinator

> Unit: synthesis-coordinator (SynthesisCoordinator DO + AtomExecutor DO)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — ADR-009 gate 6, D1 migration, v5.1 per-atom DO)

---

## JTBD

When an ExecutableSpecification is ready for synthesis (legacy path), I want the system to validate the TrellisExecutionPacket, dispatch individual atoms to isolated DOs, and coordinate completion via D1-backed ledgers, so that code changes are produced in a traceable, crash-recoverable manner — even though the full graph path is permanently deprecated and the coordinator always returns `interrupt` in the current runtime state.

---

## Functional Requirements

### FR-01: TrellisExecutionPacket Validation
The coordinator MUST validate the `trellisExecutionPacket` against the `TrellisExecutionPacket` Zod schema and then certify it via `certifyTrellisExecutionPacket()`. If validation fails, return 400 with `issues`. If certification fails, return 422 with `diagnostics`.
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:fetch()` lines 118-141

### FR-02: Idempotent Re-entry (Crash Recovery)
The coordinator MUST check persisted `GraphState` from DO storage on every `/synthesize` call. If synthesis was already completed (verdict `pass`/`fail`/`interrupt`), the coordinator MUST return the cached result without re-executing (idempotency guarantee).
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:synthesize()` early-exit block lines 218-562

### FR-03: ADR-009 Gate 6 — Permanent Interrupt
The direct synthesis execution path (agents executing in-DO) is permanently deprecated. Any call to `/synthesize` MUST return `interrupt` verdict. This is enforced by a deliberate `throw new Error('[DEPRECATED]...')` at line 403. The Phase 2 atom dispatch code (lines 428-562) is present but unreachable.
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:synthesize()` DEPRECATED throw

### FR-04: SYNTHESIS_RESULTS Queue Publish
On synthesis completion (any verdict including interrupt), the coordinator MUST publish the verdict to the `SYNTHESIS_RESULTS` queue so the ff-pipeline Worker can forward the event to the Workflow via `sendEvent`. Queue publish errors MUST be logged but NOT re-thrown.
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:notifyCallback()` lines 634-650

### FR-05: Hot Config Loading (Model Routing)
On first synthesis, the coordinator MUST seed and load hot configuration from D1 via `seedHotConfig()` and `HotConfigLoader.get()`. Configuration MUST include model routing overrides, alias overrides per artifact schema type, and feature flags.
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:ensureConfigSeeded()`, `getConfigLoader()`

### FR-06: ArangoDB Context Pre-fetch (Single-Turn Agents)
Before instantiating agents, the coordinator MUST pre-fetch Factory Knowledge Graph context from ArangoDB once. This context MUST be injected into every agent's user message, replacing multi-turn tool-calling patterns.
- Priority: **Must** (code-present but unreachable due to FR-03)
- 🟡 INFERIDO — `coordinator.ts:prefetchAgentContext()`, unreachable due to ADR-009 gate

### FR-07: Alarm-Based Deadline Enforcement (Coordinator)
The coordinator MUST handle a DO alarm that fires if synthesis exceeds the wall-clock deadline. On alarm: write `interrupt` verdict to `graphState`, set `__alarm_fired=true`, set `__completed=true`, call `notifyCallback()`.
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:alarm()` lines 164-184

### FR-08: onFiberRecovered Crash Recovery
When the coordinator DO is evicted mid-synthesis and restarts, `onFiberRecovered` MUST fire, read the stashed snapshot, write `interrupt` verdict to storage, mark `__completed=true`, and call `notifyCallback()` to unblock the Workflow.
- Priority: **Must**
- 🟢 CONFIRMADO — `coordinator.ts:onFiberRecovered()` lines 190-215

### FR-09: CRP Auto-Generation on Low Confidence
When synthesis verdict confidence < 0.7 AND verdict is not 'pass', the coordinator MUST create a CRP record in D1. It MUST also create a CRP for semantic review results with confidence < 0.7.
- Priority: **Should** (code-present but unreachable due to FR-03)
- 🟢 CONFIRMADO — `coordinator.ts:persistSynthesisResult()` lines 756-780

### FR-10: Per-Atom DO Isolation (v5.1)
Each atom MUST execute in its own `AtomExecutor` Durable Object instance with a 900-second wall-clock alarm. The per-atom isolation prevents coordinator eviction under large atom counts.
- Priority: **Must** (code-present but unreachable due to FR-03 on coordinator path)
- 🟢 CONFIRMADO — `atom-executor-do.ts:handleExecuteAtom()` lines 113-215

### FR-11: AtomExecutor Pre-flight API Key Check
Before setting the 900-second alarm, AtomExecutor MUST verify the coder model's API key exists. If the key is missing: write failResult to DO storage, ingest `infra:llm-api-401` internal signal (best-effort), return 400 immediately (no alarm set).
- Priority: **Must**
- 🟢 CONFIRMADO — `atom-executor-do.ts:handleExecuteAtom()` lines 126-167

### FR-12: AtomExecutor Idempotent Re-execution
AtomExecutor MUST check DO storage for an existing `atomResult` before executing. If present, return the cached result immediately (no re-execution).
- Priority: **Must**
- 🟢 CONFIRMADO — `atom-executor-do.ts:handleExecuteAtom()` first check

### FR-13: GitHub File Context Caching (5-min TTL)
AtomExecutor MUST fetch target files from GitHub for non-dryRun execution. Cache MUST be checked in D1 `file_context_cache` by content SHA (5-minute TTL) before making a GitHub API call. Cross-file imports MUST be resolved one level deep (max 10 additional files).
- Priority: **Must**
- 🟢 CONFIRMADO — `atom-executor-do.ts:fetchFileContexts()` lines 343-436

### FR-14: CompletionLedger Event-Driven Coordination
A `CompletionLedger` in D1 (`completion_ledgers`) MUST track cross-atom completion state. `recordAtomResult()` MUST use read-modify-write, increment `completedAtoms`, remove atomId from `pendingAtoms`, and transition phase to `'complete'` when all atoms finish. `getReadyAtoms()` MUST return only atoms whose all dependencies are in `completedAtoms`.
- Priority: **Must**
- 🟢 CONFIRMADO — `completion-ledger.ts:1-158`

---

## Non-Functional Requirements

### NFR-01: Phase 2 Dead Code — Known Gap
The atom dispatch code in `coordinator.ts` lines 428-562 is present but unreachable because ADR-009 gate 6 (FR-03) always fires first. This is a known architectural gap documented in the code. It is NOT a defect — it is intentionally retained for future activation.
- 🟢 CONFIRMADO — `coordinator.ts` comment + DEPRECATED throw

### NFR-02: Stale Route Documentation
The prior SDD documented `/dispatch-atom` and `/atoms-callback` routes. These routes have been REMOVED from `coordinator.ts`. The only current HTTP route is `POST /synthesize`. Architecture diagrams referencing these routes are stale.
- 🟢 CONFIRMADO — `coordinator.ts:fetch()` lines 108-157 (no /dispatch-atom or /atoms-callback)

### NFR-03: D1 as Primary Store (Completion Ledger)
The `completion_ledgers` collection is persisted to D1 (not ArangoDB). The `file_context_cache` collection remains in ArangoDB for the 5-minute TTL caching path.
- 🟢 CONFIRMADO — completion-ledger uses `db-client`; atom-executor fetchFileContexts uses ArangoDB

### NFR-04: Lazy Agent Import
Real agent classes in AtomExecutor MUST be lazy-imported only for non-dryRun execution. Dry-run execution MUST use stub implementations without importing real agent classes.
- 🟢 CONFIRMADO — `atom-executor-do.ts:buildAtomDeps()` lines 248-341

---

## Acceptance Criteria

**Scenario: Invalid TrellisExecutionPacket**
```
Dado: POST /synthesize with malformed trellisExecutionPacket
Quando: fetch() handler processes the request
Then: Response 400 with { error: 'Missing or invalid trellisExecutionPacket', issues: [...] }
```

**Scenario: Already-completed synthesis (idempotent re-entry)**
```
Dado: GraphState in DO storage has verdict.decision = 'interrupt'
Quando: POST /synthesize is called again
Then: Returns cached interrupt result without re-executing any synthesis steps
```

**Scenario: Synthesis returns interrupt (ADR-009 gate)**
```
Dado: Valid TrellisExecutionPacket submitted; no prior GraphState
Quando: synthesize() runs to the DEPRECATED throw
Then: interrupt verdict returned; SYNTHESIS_RESULTS queue receives { workflowId, verdict: { decision: 'interrupt' }, tokenUsage, repairCount }
```

**Scenario: Coordinator alarm fires (deadline exceeded)**
```
Dado: DO alarm fires before synthesis completes
Quando: alarm() handler executes
Then: graphState.verdict = 'interrupt'; __completed=true; notifyCallback() called; Workflow unblocked
```

**Scenario: AtomExecutor pre-flight key check fails**
```
Dado: AtomExecutor executed with dryRun=false and no OFOX_API_KEY or CF_API_TOKEN
Quando: handleExecuteAtom() runs pre-flight check
Then: failResult written to DO storage; infra:llm-api-401 signal ingested (best-effort); HTTP 400 returned; 900s alarm NOT set
```

**Scenario: AtomExecutor result is cached (idempotent)**
```
Dado: DO storage contains 'atomResult' key from a prior execution
Quando: handleExecuteAtom() is called again
Then: Cached result returned; no LLM call made; no 900s alarm set
```
