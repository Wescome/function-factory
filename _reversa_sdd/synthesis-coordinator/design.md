# Design — synthesis-coordinator

> Unit: synthesis-coordinator
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — ADR-009 gate 6, D1 migration, v5.1 per-atom DO)

---

## Overview

`SynthesisCoordinator extends Agent<CoordinatorEnv>` — a Cloudflare Durable Object wrapping the agent synthesis graph.

**Current runtime state (ADR-009 gate 6):** The direct synthesis path is permanently deprecated. Any call to `POST /synthesize` returns `interrupt` verdict immediately. The Phase 2 atom dispatch code (coordinator.ts lines 428-562) is structurally correct but unreachable. The per-atom DO infrastructure (`AtomExecutor`, `CompletionLedger`, `layer-dispatch`) is fully implemented and tested but not reached via the coordinator path.

---

## HTTP Routes (current — post-ADR-009)

| Route | Method | Handler |
|---|---|---|
| `/synthesize` | POST | Validate packet → synthesize() [always returns interrupt] → notifyCallback |

**Removed routes (documented in prior SDD as present — now absent):**
- `/dispatch-atom` — REMOVED
- `/atoms-callback` — REMOVED

Atom dispatch now goes through `SYNTHESIS_QUEUE` directly from `synthesize()` (Phase 2 block, unreachable).

---

## Execution Flow (synthesize)

```
POST /synthesize
  ↓ TrellisExecutionPacket.safeParse() → 400 if invalid
  ↓ certifyTrellisExecutionPacket() → 422 if invalid
  ↓ Store __workflowId to DO storage
  ↓ synthesize(executableSpecification, trellisPacket, workflowId, dryRun)
      ├── Read persisted GraphState from DO storage
      ├── If restoredState has terminal verdict: return cached result [idempotent]
      └── runFiber('synth-{esId}', ...)
           ├── dryRun → dryRunModelBridge(); else createModelBridge()
           ├── ensureConfigSeeded() → seedHotConfig() if first run [D1]
           ├── getConfigLoader().get() → load HotConfig
           ├── prefetchAgentContext() → ArangoDB context (unreachable in practice)
           ├── Resolve 7 models via resolveAgentModel()
           ├── Instantiate 6 agent objects with hot-config alias overrides
           └── [ADR-009 gate 6] throw DEPRECATED error → caught → interrupt verdict
  ↓ [Phase 2 block — unreachable: createLedger + atom dispatch + SYNTHESIS_QUEUE sends]
  ↓ notifyCallback() → SYNTHESIS_RESULTS queue send({ workflowId, verdict, tokenUsage, repairCount })
  ↓ return synthesisResult
```

---

## GraphState Machine

```typescript
interface GraphState {
  executableSpecificationId: string
  verdict?: Verdict             // null until completion
  code?: CodeArtifact
  tests?: TestReport
  critique?: CritiqueReport
  semanticReview?: SemanticReviewResult
  plan?: Plan
  briefingScript?: BriefingScript
  trellisExecutionPacket?: TrellisExecutionPacketType
  domainExecutionRequest: DomainExecutionRequest
  domainExecutionEvidence: DomainExecutionEvidence
  tokenUsage: number
  repairCount: number
  roleHistory: { role, tokenUsage, timestamp }[]
}
```

DO Storage Keys:
| Key | Purpose |
|---|---|
| `__workflowId` | Workflow ID for queue callback |
| `__completed` | Idempotency guard |
| `__alarm_fired` | Set by alarm handler |
| `graphState` | Current synthesis state (deleted on completion) |

---

## Crash Recovery Architecture

```
runFiber('synth-{esId}', async (fiberCtx) => {
  // On eviction/restart, onFiberRecovered fires and reads snapshot
  for each agent step:
    result = await agent.doWork()
    fiberCtx.stash({ executableSpecificationId, state })  // checkpoint
})

onFiberRecovered(snapshot):
  if state exists without verdict:
    write interrupt verdict to storage
    __completed = true
    notifyCallback()
```

Alarm (coordinator): fires if DO suspended beyond deadline → writes interrupt verdict → notifyCallback().

---

## Agent Topology (code-present, path deprecated)

```
ExecutableSpecification
  ↓ ArchitectAgent.produceBriefingScript() → BriefingScript
  ↓ PlannerAgent.producePlan() → Plan
  ↓ CoderAgent.produceCode() + executionRole (3-tier: Sandbox → gdk-agent → callModel)
  ↓ CriticAgent.codeReview() → CritiqueReport
  ↓ CriticAgent.semanticReview() → SemanticReviewResult
  ↓ TesterAgent.runTests() → TestReport
  ↓ VerifierAgent.verify() → Verdict
```

All agents receive pre-fetched ArangoDB context instead of tool-calling. Hot-config alias overrides are applied per artifact schema type.

---

## Queue Communication Architecture

```
ff-pipeline Workflow
  SYNTHESIS_QUEUE.send({ type:'synthesize', workflowId, executableSpecification, trellisPacket })
    ↓
  queue consumer (Worker) → fetch SynthesisCoordinator DO POST /synthesize
    ↓
  SynthesisCoordinator.synthesize() → always returns interrupt (ADR-009 gate 6)
    ↓ [if reachable, Phase 2 would:]
    createLedger() in D1 completion_ledgers
    → dispatch Layer 0 atoms to SYNTHESIS_QUEUE (type:'atom-execute')
    → return verdict: { decision: 'dispatched' }
    ↓ [each atom-execute message]
    AtomExecutor DO POST /execute-atom → ATOM_RESULTS queue
    ↓
  atom-results consumer → recordAtomResult() → getReadyAtoms() → dispatch next layer
    → isComplete() → SYNTHESIS_RESULTS queue
    ↓
  synthesis-results consumer → workflow.sendEvent('synthesis-complete', payload)
    ↓
  SYNTHESIS_RESULTS.send({ workflowId, verdict, tokenUsage, repairCount })
    ↓
  queue consumer → workflow.sendEvent('synthesis-complete', payload)
```

---

## AtomExecutor DO (v5.1)

`AtomExecutor extends Agent<AtomExecutorEnv>` — per-atom Durable Object.

### Execution sequence (POST /execute-atom)
```
1. Idempotency check: if DO storage has 'atomResult' → return cached
2. Pre-flight auth check (non-dryRun):
   a. resolveAgentModel('coder') → keyForModel() → if no key: failResult + ingest 'infra:llm-api-401' + return 400
3. Store metadata: __atomId, __executableSpecificationId, __workflowId, __completed=false
4. Set 900s alarm: ctx.storage.setAlarm(Date.now() + 900_000)
5. fetchFileContexts(payload) → resolve GitHub files (D1 + ArangoDB cache, 5-min TTL)
6. Build AtomSlice: { atomId, atomSpec, upstreamArtifacts, sharedContext, fileContexts }
7. buildAtomDeps(dryRun) → agent stubs (lazy-import real agents for non-dryRun only)
8. executeAtomSlice(slice, deps, { maxRetries, dryRun }) → AtomResult
9. Store atomResult in DO storage
10. __completed = true; deleteAlarm()
11. publishResult() → ATOM_RESULTS queue
```

Alarm fires: produces AtomResult { decision: 'fail' }, ingests pipeline:synthesis-timeout signal, publishResult().

DO Storage Keys:
| Key | Purpose |
|---|---|
| `__atomId` | Atom ID for alarm handler |
| `__executableSpecificationId` | ES ID for alarm handler |
| `__workflowId` | Workflow ID for queue publish |
| `__completed` | Idempotency guard |
| `atomResult` | Cached result |
| `file:{path}` | Raw file content (cross-file resolution) |

---

## CompletionLedger

Stored in D1 `completion_ledgers` (not ArangoDB). Keyed by `executableSpecificationId`.

```typescript
interface CompletionLedger {
  _key: string                    // executableSpecificationId
  workflowId: string
  totalAtoms: number
  completedAtoms: number
  atomResults: Record<string, AtomResult>
  layers: DependencyLayer[]
  allAtomSpecs: Record<string, Record<string, unknown>>
  sharedContext: { executableSpecificationId, specContent, briefingScript }
  pendingAtoms: string[]          // atoms waiting for upstream deps
  phase: 'dispatched' | 'executing' | 'complete' | 'failed'
}
```

**Note:** `phase: 'executing'` is defined in the type but never written by any current function. `createLedger` sets `'dispatched'`; `recordAtomResult` transitions to `'complete'` — the intermediate state is unused.

---

## Topological Sort (Kahn's Algorithm — layer-dispatch.ts)

Used to group atoms into dependency layers for ordered dispatch:
1. Build in-degree map (count of incoming edges per atom)
2. Iteratively extract layer: atoms with inDegree == 0
3. Emit DependencyLayer { index, atomIds }
4. Decrement dependents' in-degree
5. Cycle guard: if no zero-in-degree atoms remain, dump all remaining into one layer

---

## File Context Resolution (resolveTargetFiles priority)

1. `atomSpec.targetFiles` (explicit array) — filter TBD entries
2. `atomSpec.suggestedFiles` (inferred from plan)
3. `atomSpec.file` (single file string)
4. `atomSpec.binding.target` (comma-separated paths fallback)

Cross-file resolution: follows imports one level deep (max 10 additional files, marked `confidence: 'inferred'`).

---

## Dry-Run Mode

| taskKind | Returns |
|---|---|
| `planner` | Stub Plan with one atom |
| `coder` | Stub CodeArtifact with `src/stub.ts` |
| `tester` | Stub TestReport (all pass) |
| `verifier` | `{ decision: 'pass', confidence: 1.0 }` |
| `architect` / `critic` | Handled internally by agent class |
| default | `{ result: 'dry-run stub' }` |

AtomExecutor dry-run: each agent method returns hardcoded stub without importing real agent class.

---

## ArangoDB Collections Written (synthesis path — unreachable)

| Collection | Written by | Key pattern |
|---|---|---|
| `execution_artifacts` | `persistSynthesisResult()` | `EA-{esId}-code`, `-tests`, `-synthesis` |
| `memory_episodic` | `persistSynthesisResult()` | `ep-synth-{esId}` |
| `file_context_cache` | `fetchFileContexts()` | `{sha}` (5-min TTL) |

## D1 Collections Written

| Collection | Written by |
|---|---|
| `completion_ledgers` | `createLedger()` |
| `hot_config`, `config_*` | `seedHotConfig()` (via HotConfigLoader) |
