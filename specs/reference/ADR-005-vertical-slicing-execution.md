# ADR-005: Vertical Slicing Execution Engine

## Status

Proposed -- pending Architect review (2026-04-27)

## Date

2026-04-27

## Lineage

ADR-004 (custom StateGraph over LangGraph), factory-ontology.ttl (Domain 4:
Execution & Synthesis), IMPLEMENTATION-PLAN.md (Phases 0-F), vertical-slicing
research synthesis (MASAI, LLMCompiler, DynTaskMAS, SASE, AgentMesh,
Blueprint2Code), operational evidence from Phase 4-5 deployment
(2026-04-25/27).

---

## 1. Decision

Replace the monolithic 10-node synthesis graph with a three-phase execution
engine that processes atoms as independent vertical slices:

- **Phase 1 (WorkGraph-level, serial):** architect, semantic-critic, compile,
  gate-1, planner -- produces the atom plan and BriefingScript
- **Phase 2 (per-atom, parallel):** for each atom or dependency layer, run
  code, code-critic, test, verify as an independent pipeline in its own
  Durable Object
- **Phase 3 (integration):** merge atom artifacts, verify cross-atom
  contracts, emit final verdict

Additionally, decouple the queue consumer from the DO synthesis lifecycle to
eliminate the immediate timeout failure.

---

## 2. Context

### 2.1 The Immediate Problem (Queue Consumer Timeout)

The queue consumer in `src/index.ts` (line 97-168) blocks on
`stub.fetch(DO)` for the entire synthesis duration. A real synthesis takes
5-15 minutes. CF Queue visibility timeout kills the consumer, causing retry,
which spawns a second DO fetch, leading to duplicate work or terminal failure
after max_retries (3 attempts).

The root chain:
```
Queue consumer receives message
  -> calls stub.fetch('https://do/synthesize')
  -> DO runs 10-node graph (5-15 min)
  -> Queue visibility timeout fires (~30s)
  -> Consumer retried or message dead-lettered
  -> Workflow never receives synthesis-complete event
  -> Workflow times out at waitForEvent('synthesis-complete', 30min)
```

The DO alarm handler (coordinator.ts line 75-89) correctly detects
wall-clock timeout but writes the interrupted state to DO storage without
notifying the Workflow -- a dead end.

### 2.2 The Systemic Problem (Monolithic Atom Processing)

The current graph (graph.ts) processes ALL atoms as a single batch through
10 serial nodes. Four pathologies follow:

1. **Latency:** 10 nodes x all atoms x 2-3 LLM turns each = 5-10 minutes
   serial chain. A 6-atom WorkGraph with 3 independent atoms wastes half its
   time waiting serially.

2. **Blast radius:** One bad atom poisons the entire verdict. The verifier
   returns `patch`, the whole inner loop replays -- every atom re-planned,
   re-coded, re-reviewed, even if only one atom failed.

3. **Cost:** The repair loop re-does everything, not just the broken atom.
   At $0.50-2.00 per LLM call, a 3-atom retry costs 3x what it should.

4. **Context dilution:** The more atoms stuffed into a single LLM call, the
   more likely comprehension failures manifest. The world-models research
   predicts this: converting conceptual dependencies into procedural inputs
   (concrete interface definitions from completed atoms) keeps tasks in the
   constraint-following band where transformers are reliable.

### 2.3 Research Support

Six bodies of research validate the vertical slicing approach:

**MASAI (Arora et al., 2024):** Decompose problems into specialized
sub-agents with defined I/O specs. Per-sub-problem agents avoid
"unnecessarily long trajectories which inflate costs and add extraneous
context." Each atom's vertical slice IS a MASAI-style sub-agent composition.
28.33% resolution on SWE-bench Lite at <$2/issue demonstrates cost
competitiveness.

**LLMCompiler (Kim et al., ICML 2024):** DAG decomposition with parallel
dispatch and placeholder variable replacement. Up to 3.7x latency reduction,
6.7x cost savings, ~9% accuracy improvement from shorter context windows.
The WorkGraph already IS a DAG with typed edges -- LLMCompiler provides the
execution semantics.

**DynTaskMAS (Yu et al., 2025):** Asynchronous parallel execution engine
with semantic-aware context management. Near-linear throughput scaling up to
16 concurrent agents (3.47x for 4x agents). 21-33% execution time reduction
with higher gains for complex tasks.

**SASE (Hassan et al., 2025):** Adaptable over universal processes -- not
all atoms need the same pipeline depth. Trust calibration should be
per-task, not blanket-granted for an entire WorkGraph.

**AgentMesh + Blueprint2Code:** Validate the Planner/Coder/Debugger/Reviewer
pipeline but highlight error propagation as the primary failure mode of
sequential multi-agent pipelines. Per-atom isolation eliminates cross-atom
error propagation.

**Blast radius practitioner literature (2025-2026):** METR trial found
experienced developers using AI tools in complex codebases took 19% longer
than without AI, largely due to reviewing large diffs. Per-atom slicing
ensures each unit stays in the "small" category (1-5 files).

---

## 3. Bug Fix Design: Decouple Dispatch From Relay

### 3.1 Problem Statement

The queue consumer awaits the DO response synchronously. CF Queues have a
visibility timeout (~30 seconds) that the consumer cannot exceed. The DO
synthesis takes minutes.

### 3.2 Design: Fire-and-Forget + Callback

```
                        (1) fire-and-forget
Queue consumer ──────────────────────────> Coordinator DO
     |                                          |
     | (2) ack immediately                      | (3) runs synthesis
     v                                          |     (5-15 min)
  [message acked,                               |
   consumer exits]                              |
                                                v
                        (4) POST /synthesis-callback
Worker fetch() handler <──────────────── DO.alarm() or DO.synthesize()
     |
     | (5) workflow.sendEvent('synthesis-complete')
     v
  Workflow resumes
```

### 3.3 Queue Consumer Changes (src/index.ts, queue() handler)

**Current (blocking):**
```typescript
const doResponse = await stub.fetch(...)  // blocks 5-15 min
const result = await doResponse.json()
await workflow.sendEvent(...)
msg.ack()
```

**Proposed (fire-and-forget):**
```typescript
// Send workflowId to the DO so it knows where to call back
await stub.fetch(new Request('https://do/synthesize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workGraph,
    dryRun,
    callbackWorkflowId: workflowId,  // NEW: DO uses this for callback
    ...(specContent ? { specContent } : {}),
  }),
}))
// DO accepted the request -- ack immediately
// DO will call back to Worker /synthesis-callback on completion
msg.ack()
```

The queue consumer now completes in <1 second. No visibility timeout risk.

### 3.4 DO Changes (coordinator.ts)

The `synthesize()` method stores `callbackWorkflowId` and, upon completion
(or alarm), calls back to the Worker:

```typescript
// After graph.run() completes (or on alarm/error):
private async notifyCompletion(result: SynthesisResult): Promise<void> {
  const callbackWorkflowId = await this.ctx.storage.get<string>('callbackWorkflowId')
  if (!callbackWorkflowId) return

  // Call back to Worker's /synthesis-callback route
  // The Worker has access to FACTORY_PIPELINE binding; the DO does not
  const callbackUrl = 'https://ff-pipeline.koales.workers.dev/synthesis-callback'
  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: callbackWorkflowId,
      verdict: result.verdict,
      tokenUsage: result.tokenUsage,
      repairCount: result.repairCount,
    }),
  })

  if (!response.ok) {
    // Retry once after 5s via alarm
    await this.ctx.storage.put('__callback_retry', true)
    await this.ctx.storage.setAlarm(Date.now() + 5_000)
  }
}
```

### 3.5 Worker Callback Route (src/index.ts, fetch() handler)

New route that receives DO completion and forwards to Workflow:

```typescript
if (url.pathname === '/synthesis-callback' && request.method === 'POST') {
  const body = await request.json() as {
    workflowId: string
    verdict: { decision: string; confidence: number; reason: string }
    tokenUsage: number
    repairCount: number
  }

  const workflow = await env.FACTORY_PIPELINE.get(body.workflowId)
  await workflow.sendEvent({
    type: 'synthesis-complete',
    payload: {
      verdict: body.verdict,
      tokenUsage: body.tokenUsage,
      repairCount: body.repairCount,
    },
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

### 3.6 Alarm Handler Fix (coordinator.ts)

The current alarm handler writes interrupted state to DO storage but never
notifies the Workflow. Fix: call `notifyCompletion()` from alarm:

```typescript
override async alarm(): Promise<void> {
  const completed = await this.ctx.storage.get<boolean>('__completed')
  if (completed) return

  // Check if this is a callback retry
  const callbackRetry = await this.ctx.storage.get<boolean>('__callback_retry')
  if (callbackRetry) {
    await this.ctx.storage.delete('__callback_retry')
    const state = await this.ctx.storage.get<GraphState>('graphState')
    if (state) {
      await this.notifyCompletion(this.buildResult(
        await this.ctx.storage.get<string>('workGraphId') ?? 'unknown',
        state,
      ))
    }
    return
  }

  // Original timeout logic
  const state = await this.ctx.storage.get<GraphState>('graphState')
  const timedOutState: GraphState = {
    ...(state ?? createInitialState('unknown', {})),
    verdict: {
      decision: 'interrupt',
      confidence: 1.0,
      reason: 'DO alarm: synthesis exceeded wall-clock deadline',
    },
  }
  await this.ctx.storage.put('graphState', timedOutState)
  await this.ctx.storage.put('__completed', true)

  // NEW: notify the Workflow so it doesn't hang
  await this.notifyCompletion(this.buildResult(
    timedOutState.workGraphId,
    timedOutState,
  ))
}
```

### 3.7 Error Handling

| Failure mode | Current behavior | Proposed behavior |
|---|---|---|
| Queue visibility timeout | Consumer retried, duplicate DO work | Consumer acks immediately, no retry |
| DO synthesis timeout | Alarm writes state, Workflow hangs | Alarm calls notifyCompletion, Workflow resumes |
| Callback POST fails | N/A | DO sets alarm for 5s retry, re-attempts callback |
| Callback retry fails | N/A | State persisted in DO storage; manual recovery possible via /synthesis-callback admin route |
| Worker unreachable from DO | N/A | DO self-fetch works (same zone); if CF routes internally, no cold start |

### 3.8 Invariants

- The Workflow ALWAYS receives a `synthesis-complete` event (pass, fail, or
  interrupt). No more hanging.
- The queue consumer ALWAYS completes within seconds. No more visibility
  timeout failures.
- The DO is the single source of truth for synthesis state. The callback is
  a notification, not a state transfer.

---

## 4. Vertical Slicing Design (Systemic)

### 4.1 Three-Phase Execution Model

```
WorkGraph (DAG of atoms with typed dependency edges)
    |
    v
=== PHASE 1: WorkGraph-level (serial, fast) ===
    |
    v
budget-check --> architect --> semantic-critic --> compile --> gate-1 --> planner
    |                                                                      |
    | (if budget blown or miscast: END)                                    |
    v                                                                      v
  END                                                              atom plan + BriefingScript
                                                                           |
                                                                           v
=== PHASE 2: Per-atom (parallel by dependency layer) ===
    |
    v
Topological sort atoms --> dependency layers
    |
    v
Layer 0: [Atom_1, Atom_2]  <-- no dependencies, parallel DOs
Layer 1: [Atom_3]           <-- depends on Atom_1, gets Atom_1's CodeArtifact
Layer 2: [Atom_4, Atom_5]   <-- depends on Atom_3, parallel DOs
    |
    v (each atom runs independently in its own DO)
Atom_N --> code --> code-critic --> test --> verify
              |                              |
              |<-- (on patch: retry loop) <--|
              |    (scoped to THIS atom)     |
              v                              v
         CodeArtifact_N              AtomVerdict_N
    |
    v
=== PHASE 3: Integration (serial, fast) ===
    |
    v
Merge atom artifacts --> cross-atom contract verification --> final verdict
```

### 4.2 Phase 1: WorkGraph-Level Pipeline

**Nodes:** budget-check, architect, semantic-critic, compile, gate-1, planner

**Purpose:** Produce the BriefingScript and atom-level implementation plan.
This phase runs ONCE per WorkGraph, not per atom. It is the "strategic
planning" phase -- fast (2-4 LLM calls) and serial.

**Changes from current graph:**
- The planner node output changes shape: instead of a single Plan with
  mixed atoms, it produces a `SlicePlan` with per-atom entries including
  dependency metadata.
- The planner receives the full WorkGraph DAG and produces a topologically
  sorted execution order.

**New state shape for Phase 1 output:**
```typescript
interface SlicePlan {
  layers: AtomLayer[]
  sharedContext: {
    schemas: Record<string, string>    // Zod schemas relevant to all atoms
    briefingScript: BriefingScript     // From architect
    mentorRules: string[]              // Active MentorScript rules
  }
}

interface AtomLayer {
  layerIndex: number
  atoms: AtomSliceSpec[]
}

interface AtomSliceSpec {
  atomId: string
  atomSpec: RequirementAtom          // From WorkGraph
  dependencies: {
    atomId: string
    edgeType: DependencyType         // blocks, constrains, implements, etc.
    placeholder: string              // e.g. "$atom1_interface"
  }[]
  estimatedComplexity: 'trivial' | 'low' | 'medium' | 'high'
  sliceDepth: 'shallow' | 'standard' | 'deep'  // SASE adaptive (v5.1)
}
```

### 4.3 Phase 2: Per-Atom Parallel Execution

**The core innovation.** Each atom gets its own pipeline instance running in
its own Durable Object (AtomExecutor DO).

#### 4.3.1 AtomExecutor DO

A new lightweight Durable Object class that executes a single atom's
vertical slice:

```typescript
class AtomExecutor extends Agent<CoordinatorEnv> {
  // Runs: code --> code-critic --> test --> verify
  // With per-atom retry loop (max 3 repairs, configurable)
  //
  // Input: AtomSliceSpec + resolved upstream CodeArtifacts
  // Output: AtomResult (CodeArtifact + AtomVerdict + TestReport)
}
```

**Why a separate DO, not parallel nodes in the same graph:**
- CF DOs are single-threaded. The SynthesisCoordinator DO cannot run
  multiple atom pipelines concurrently within itself.
- Each AtomExecutor DO gets its own V8 isolate, enabling true parallelism.
- Each atom's Fiber is independent -- crash recovery is per-atom.
- The coordinator DO orchestrates; the atom DOs execute.

#### 4.3.2 Coordinator as Orchestrator

The SynthesisCoordinator DO changes role from "graph runner" to
"orchestrator." After Phase 1 completes:

```typescript
// Phase 2: dispatch atoms by dependency layer
for (const layer of slicePlan.layers) {
  // All atoms in this layer execute in parallel
  const atomPromises = layer.atoms.map(async (atomSpec) => {
    // Resolve placeholder variables from completed upstream atoms
    const resolvedSpec = resolvePlaceholders(atomSpec, completedAtoms)

    // Dispatch to AtomExecutor DO
    const doId = env.ATOM_EXECUTOR.idFromName(`atom-${workGraphId}-${atomSpec.atomId}`)
    const stub = env.ATOM_EXECUTOR.get(doId)

    const response = await stub.fetch(new Request('https://do/execute-atom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        atomSpec: resolvedSpec,
        sharedContext: slicePlan.sharedContext,
        callbackWorkflowId,  // For the bug fix pattern
      }),
    }))

    return response.json() as AtomResult
  })

  // Wait for all atoms in this layer to complete
  const layerResults = await Promise.all(atomPromises)

  // Store completed atom artifacts for downstream placeholder resolution
  for (const result of layerResults) {
    completedAtoms.set(result.atomId, result)
  }

  // If any atom in this layer failed terminally, abort remaining layers
  if (layerResults.some(r => r.verdict.decision === 'fail')) {
    return buildPartialResult(completedAtoms, layerResults)
  }
}
```

#### 4.3.3 Placeholder Variable Resolution (LLMCompiler pattern)

When Atom_3 depends on Atom_1's exported interface:

1. The planner emits Atom_3's spec with placeholder: `"imports interface
   $atom1_interface from Atom_1"`
2. After Atom_1's slice completes, its CodeArtifact contains the actual
   TypeScript interface definition.
3. Before dispatching Atom_3, the coordinator replaces `$atom1_interface`
   with the concrete interface text from Atom_1's CodeArtifact.
4. Atom_3's Coder receives concrete types, not abstract references.

```typescript
function resolvePlaceholders(
  atomSpec: AtomSliceSpec,
  completedAtoms: Map<string, AtomResult>,
): ResolvedAtomSpec {
  let resolvedSpec = JSON.stringify(atomSpec)

  for (const dep of atomSpec.dependencies) {
    const upstream = completedAtoms.get(dep.atomId)
    if (!upstream) {
      throw new Error(
        `Atom ${atomSpec.atomId} depends on ${dep.atomId} ` +
        `but it has not completed. Dependency graph is broken.`
      )
    }

    // Extract the relevant artifact from upstream
    const replacement = extractDependencyArtifact(upstream, dep.edgeType)
    resolvedSpec = resolvedSpec.replaceAll(dep.placeholder, replacement)
  }

  return JSON.parse(resolvedSpec) as ResolvedAtomSpec
}
```

#### 4.3.4 Context Scoping (DynTaskMAS SACMS pattern)

Each atom slice receives a scoped context window:

| Context element | Source | Purpose |
|---|---|---|
| Atom's own spec | WorkGraph RequirementAtom | What to build |
| Upstream CodeArtifacts | Completed dependency atoms | Concrete interfaces |
| Shared schemas | SlicePlan.sharedContext.schemas | Domain type definitions |
| BriefingScript | Phase 1 architect output | Strategic guidance |
| MentorScript rules | ArangoDB mentorscript_rules | Behavioral constraints |

**NOT included:** Full WorkGraph, other atoms' code, PRD narrative, unrelated
schemas. This scoping keeps each LLM call in the constraint-following
reliability band.

#### 4.3.5 Per-Atom Repair Loop

When an atom's verifier returns `patch`:

1. Only THAT atom's slice retries.
2. The retry gets the verifier's feedback + the code-critic's issues as
   additional context.
3. Other atoms' completed artifacts are unaffected.
4. Per-atom repair budget: 3 retries (configurable, separate from
   WorkGraph-level maxRepairs).
5. If retry limit reached, the atom is flagged `fail` -- the coordinator
   decides whether to abort the WorkGraph or continue with partial results.

```typescript
// Inside AtomExecutor DO
const atomGraph = new StateGraph<AtomState>()
  .addNode('code', coderNode)
  .addNode('code-critic', codeCriticNode)
  .addNode('test', testerNode)
  .addNode('verify', verifierNode)
  .addNode('budget-check', atomBudgetCheck)
  .setEntryPoint('code')
  .addEdge('code', 'code-critic')
  .addEdge('code-critic', 'test')
  .addEdge('test', 'verify')
  .addConditionalEdge('verify', (state) => {
    if (state.verdict?.decision === 'pass') return END
    if (state.verdict?.decision === 'fail') return END
    if (state.atomRepairCount >= state.maxAtomRepairs) return END
    return 'budget-check'  // patch or resample -> retry
  })
  .addConditionalEdge('budget-check', (state) => {
    if (state.atomRepairCount >= state.maxAtomRepairs) return END
    return 'code'  // re-enter coding with repair context
  })
```

#### 4.3.6 Atom-Level vs WorkGraph-Level State

**AtomState** (per-atom, lives in AtomExecutor DO):
```typescript
interface AtomState {
  atomId: string
  atomSpec: ResolvedAtomSpec
  sharedContext: SharedContext

  code: CodeArtifact | null
  critique: CritiqueReport | null
  tests: TestReport | null
  verdict: Verdict | null

  atomRepairCount: number
  maxAtomRepairs: number      // default: 3
  atomTokenUsage: number
  roleHistory: RoleHistoryEntry[]
}
```

**WorkGraphState** (orchestrator-level, lives in SynthesisCoordinator DO):
```typescript
interface WorkGraphState {
  workGraphId: string
  workGraph: Record<string, unknown>

  // Phase 1 outputs
  briefingScript: BriefingScript | null
  semanticReview: SemanticReviewResult | null
  slicePlan: SlicePlan | null
  gate1Report: Gate1Report | null

  // Phase 2 tracking
  completedAtoms: Map<string, AtomResult>
  failedAtoms: Map<string, AtomResult>
  activeAtomDOs: Map<string, string>  // atomId -> DO name

  // Phase 3 outputs
  integrationVerdict: Verdict | null
  mergedArtifacts: CodeArtifact | null

  // Aggregate metrics
  totalTokenUsage: number
  totalRepairCount: number
  workGraphRepairCount: number  // full-WorkGraph retries (rare)
}
```

### 4.4 Phase 3: Integration Verification

After all atom slices complete, a lightweight integration step verifies
cross-atom concerns:

1. **Interface matching:** Do exported interfaces from Atom_1 match the
   imports in Atom_3? (Structural type check, not full compilation.)
2. **Contract verification:** Do typed dependency edges in the WorkGraph
   have corresponding code artifacts that satisfy the contract?
3. **Integration test generation:** A focused LLM call generates tests that
   exercise atom boundaries (not atom internals -- those were tested in
   Phase 2).
4. **Final verdict:** pass if all checks succeed, fail if structural
   incompatibilities found, patch if minor interface mismatches fixable.

If Phase 3 returns `patch`, the coordinator identifies which atom(s) caused
the integration failure and re-dispatches ONLY those atoms with the
integration feedback. This is a WorkGraph-level repair, distinct from
per-atom repairs.

### 4.5 Communication: How Parallel Atom DOs Report Back

**Design choice: Promise.all with stub.fetch (synchronous fan-out).**

The SynthesisCoordinator DO dispatches all atoms in a layer via
`Promise.all(atomPromises)` where each promise is a `stub.fetch()` to an
AtomExecutor DO. This works because:

- The coordinator DO can hold multiple concurrent outbound fetches.
- Each AtomExecutor DO runs independently in its own isolate.
- The coordinator awaits all results before proceeding to the next layer.
- If any atom times out, its AtomExecutor DO alarm fires and returns an
  interrupt verdict.

**Why not Queue-per-atom or storage polling:**
- Queue-per-atom adds unnecessary indirection. The coordinator already has
  DO stub access.
- Storage polling (checking R2 or ArangoDB for atom results) introduces
  latency and complexity.
- Promise.all is the simplest pattern that provides parallelism. The
  coordinator DO's V8 isolate is not blocked -- it's awaiting I/O on
  multiple concurrent fetches.

**Caveat:** If the coordinator DO is evicted during Promise.all, Fiber
recovery fires. The recovery handler checks which atoms completed (via
their DO storage) and resumes from the last completed layer. This is more
complex than the current single-graph Fiber recovery but follows the same
pattern.

### 4.6 Atom Tracking: Completion Ledger

The coordinator maintains a completion ledger in DO storage:

```typescript
interface CompletionLedger {
  layers: {
    layerIndex: number
    atoms: {
      atomId: string
      status: 'pending' | 'running' | 'completed' | 'failed'
      doName: string
      result?: AtomResult
      startedAt?: string
      completedAt?: string
    }[]
    layerStatus: 'pending' | 'running' | 'completed' | 'failed'
  }[]
}
```

Updated after each atom completes. Persisted to DO storage after each layer
completes. On Fiber recovery, the ledger tells the coordinator exactly where
to resume.

---

## 5. Implementation Gradient

### 5.1 v4.1: Bug Fix + Per-Atom Retry Isolation

**Scope:** Smallest change, biggest immediate win. Two commits.

**Commit 1: Fire-and-forget queue consumer (the bug fix)**
- Modify `src/index.ts` queue() handler: dispatch to DO, ack immediately.
- Add `/synthesis-callback` route to fetch() handler.
- Modify coordinator.ts: store callbackWorkflowId, call notifyCompletion()
  on completion and alarm.
- Tests: verify queue consumer acks within 1 second; verify callback
  reaches Workflow.

**Commit 2: Per-atom retry isolation (keep monolithic pipeline)**
- The existing monolithic graph stays. No new DOs, no parallel execution.
- Modify graph.ts verifier conditional edge: when verdict is `patch`, track
  WHICH atoms failed (from the verifier's output).
- Modify planner node on repair: only re-plan the failing atoms. Pass
  through unchanged atoms' code and test artifacts.
- Modify coder node on repair: only re-code atoms flagged by verifier.
- This is the cheapest blast-radius win: the graph is still serial and
  monolithic, but the retry loop is scoped.

**CF platform impact:** Zero new primitives. Same DOs, same Queues, same
Workflows. Only code changes within existing files.

**Research grounding:** Blueprint2Code's repair isolation pattern --
identify the broken module, retry only that module within the existing
pipeline.

### 5.2 v5: Full Vertical Slicing with Parallel Execution

**Scope:** The systemic redesign. Multiple commits across 3-4 sessions.

**Commit 1: AtomExecutor DO**
- New file: `src/coordinator/atom-executor.ts`
- Implements the 4-node atom pipeline (code, code-critic, test, verify)
  with per-atom retry loop.
- Uses the same StateGraph runner (graph-runner.ts) -- no new execution
  engine needed.
- Tests: atom pipeline runs independently with mock agents.

**Commit 2: SlicePlan and Phase 1 refactor**
- Modify planner agent to produce SlicePlan (topological sort, per-atom
  specs, dependency placeholders).
- Phase 1 graph: budget-check, architect, semantic-critic, compile, gate-1,
  planner -- same nodes, new planner output shape.
- Tests: planner produces valid SlicePlan from WorkGraph with dependencies.

**Commit 3: Coordinator orchestration**
- Modify SynthesisCoordinator to implement three-phase execution.
- Phase 2: dispatch atoms by dependency layer using Promise.all.
- Placeholder variable resolution.
- Completion ledger for crash recovery.
- Tests: 3-atom graph with 2 layers executes correctly; atom failure in
  layer 0 aborts remaining layers.

**Commit 4: Phase 3 integration verification**
- New node or standalone function: merge artifacts, verify contracts.
- Integration test generation via focused LLM call.
- Tests: cross-atom interface mismatch detected and reported.

**Commit 5: wrangler.jsonc update**
- Add ATOM_EXECUTOR DO binding.
- Add migration tag for new DO class.
- Deploy and validate.

**CF platform impact:**
- New DO class: AtomExecutor (wrangler.jsonc `durable_objects.bindings`)
- New migration tag (SQLite for AtomExecutor state)
- No new Queues, Workflows, or Containers

**Research grounding:** LLMCompiler's DAG execution + DynTaskMAS's
asynchronous parallel engine + MASAI's sub-agent decomposition.

### 5.3 v5.1: Adaptive Slice Depth (SASE)

**Scope:** Optimization layer. One commit.

**Change:** The planner assigns `sliceDepth` per atom based on complexity:

| Complexity | Slice depth | Pipeline nodes | When |
|---|---|---|---|
| trivial | shallow | code, verify | Schema-only atoms, config atoms |
| low | standard | code, code-critic, verify | Simple CRUD, single-file atoms |
| medium | standard | code, code-critic, test, verify | Multi-file atoms, integration points |
| high | deep | code, code-critic, test, verify + extra repair budget | Complex algorithms, cross-cutting concerns |

The AtomExecutor DO reads `sliceDepth` and configures its pipeline
accordingly:

```typescript
// In AtomExecutor:
const graph = buildAtomGraph({
  includeCodeCritic: sliceDepth !== 'shallow',
  includeTester: sliceDepth !== 'shallow',
  maxRepairs: sliceDepth === 'deep' ? 5 : sliceDepth === 'standard' ? 3 : 1,
})
```

**CF platform impact:** Zero. Same DOs, same bindings. Only logic change
inside AtomExecutor.

**Research grounding:** SASE's "adaptable over universal processes"
principle. Trivial atoms do not need the same validation depth as complex
integration atoms.

---

## 6. CF Platform Mapping

| Concern | CF Primitive | Used in |
|---|---|---|
| WorkGraph-level orchestration | SynthesisCoordinator DO | Phase 1 + Phase 2 dispatch + Phase 3 |
| Per-atom execution | AtomExecutor DO (new) | Phase 2 vertical slices |
| Parallel atom dispatch | Promise.all on stub.fetch() | Phase 2 layer execution |
| Crash recovery (orchestrator) | Fiber + stash() | SynthesisCoordinator |
| Crash recovery (per-atom) | Fiber + stash() | AtomExecutor |
| Wall-clock timeout (orchestrator) | DO Alarm | SynthesisCoordinator |
| Wall-clock timeout (per-atom) | DO Alarm | AtomExecutor |
| Queue decoupling (bug fix) | CF Queue + callback route | Queue consumer -> DO -> Worker |
| Workflow event delivery | workflow.sendEvent() | Callback route -> Workflow |
| Workflow wait | step.waitForEvent() | synthesis-complete event |
| Durable state | DO storage (this.ctx.storage) | Both DOs: GraphState, AtomState, CompletionLedger |
| Permanent persistence | ArangoDB | Artifacts, lineage, episodic memory |
| Code execution | Sandbox Container | Coder/Tester within AtomExecutor |
| Graph execution engine | Custom StateGraph (80 lines) | Both coordinator and atom-level graphs |
| Human approval gate | step.waitForEvent() | Architect approval (unchanged) |

**What does NOT change:**
- The Workflow (pipeline.ts) -- Stages 1-5 are unchanged.
- The Queue bridge pattern -- still used, but consumer no longer blocks.
- The graph-runner.ts StateGraph class -- reused for both WorkGraph-level
  and atom-level graphs.
- The agent implementations (architect-agent, coder-agent, etc.) -- same
  agents, called per-atom instead of per-WorkGraph.
- Gate 1 evaluation (ff-gates service binding) -- still runs once per
  WorkGraph in Phase 1.

---

## 7. Risk Analysis

### 7.1 Risks Introduced

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| VS-1 | Coordinator DO evicted during Promise.all across atom DOs | Medium | High | Completion ledger in DO storage. Fiber recovery resumes from last completed layer. AtomExecutor DOs are idempotent -- re-dispatching a completed atom returns cached result. |
| VS-2 | AtomExecutor DO count exceeds CF DO limits | Low | Medium | CF supports millions of DOs. A 10-atom WorkGraph creates 10 AtomExecutor DOs. Well within limits. |
| VS-3 | Placeholder resolution produces invalid code context | Medium | Medium | Validate resolved specs structurally before dispatching to AtomExecutor. Fail fast with specific error if placeholder unresolved. |
| VS-4 | Integration verification (Phase 3) catches problems too late | Medium | High | Typed dependency edges in WorkGraph serve as pre-compilation contracts. Phase 3 is a structural check, not a full rebuild. If integration fails, only the boundary atoms are re-dispatched, not all atoms. |
| VS-5 | Increased complexity in crash recovery path | High | Medium | The completion ledger pattern is well-established (saga pattern). Each layer's results are checkpointed. Recovery is deterministic: read ledger, skip completed layers, resume from first incomplete. |
| VS-6 | DO-to-DO fetch latency overhead | Low | Low | Intra-zone DO communication is <1ms. The LLM calls within each atom (seconds) dominate. Network overhead is negligible. |
| VS-7 | Non-decomposable atoms (genuinely intertwined) | Low | Medium | Treat as composite atom. The WorkGraph dependency edges should already capture this -- if two atoms have bidirectional dependencies, the planner should merge them into one slice. |
| VS-8 | Callback from DO to Worker fails (bug fix) | Medium | High | Retry via DO alarm (5s). If retry fails, state is in DO storage -- manual recovery route. The Workflow has a 30-minute waitForEvent timeout as backstop. |

### 7.2 Risks Retired

| Risk | Why retired |
|---|---|
| Queue consumer timeout | Bug fix eliminates synchronous blocking |
| Full-WorkGraph retry on single atom failure | Per-atom retry isolation (v4.1) eliminates blast radius |
| Context dilution from multi-atom LLM calls | Per-atom context scoping eliminates cross-atom noise |

---

## 8. Verification Criteria

### 8.1 v4.1 Verification (Bug Fix + Retry Isolation)

| # | Criterion | Evidence |
|---|-----------|---------|
| V1 | Queue consumer acks within 1 second | Timing assertion in integration test |
| V2 | Workflow receives synthesis-complete event on DO completion | End-to-end test: enqueue -> DO completes -> Workflow resumes |
| V3 | Workflow receives synthesis-complete event on DO timeout | End-to-end test: enqueue -> DO alarm fires -> Workflow resumes with interrupt verdict |
| V4 | Callback retry succeeds after transient failure | Test: first callback returns 500, alarm fires, second callback succeeds |
| V5 | Per-atom retry: failing atom retried, passing atoms preserved | Test: 3-atom WorkGraph, atom 2 fails verification, only atom 2 re-enters coder node |
| V6 | Existing dry-run synthesis still passes | Regression: POST /trigger-synthesis with dryRun: true, verdict: pass |

### 8.2 v5 Verification (Full Vertical Slicing)

| # | Criterion | Evidence |
|---|-----------|---------|
| V7 | 3-atom WorkGraph with 2 independent atoms: both execute in parallel | Timing: total time < 2x single-atom time (not 3x) |
| V8 | Dependent atom receives resolved placeholder (concrete interface) | Atom_3's coder input contains actual TypeScript interface from Atom_1 |
| V9 | AtomExecutor DO retry is isolated to failing atom | Atom_2 fails, retries 3x, other atoms unaffected |
| V10 | Phase 3 integration catches interface mismatch | Atom_1 exports interface A, Atom_3 imports interface B: Phase 3 fails with specific error |
| V11 | Coordinator Fiber recovery resumes from completion ledger | Simulate DO eviction after layer 0 completes: layer 1 atoms re-dispatch correctly |
| V12 | Per-atom alarm fires independently | Set 30s atom timeout, atom takes 60s: atom returns interrupt, other atoms continue |

### 8.3 v5.1 Verification (Adaptive Depth)

| # | Criterion | Evidence |
|---|-----------|---------|
| V13 | Trivial atom skips code-critic and tester | AtomExecutor roleHistory contains only: code, verify |
| V14 | High-complexity atom gets 5 repair attempts | AtomExecutor with high atom retries 5x before failing |
| V15 | Planner assigns correct complexity based on atom category | Schema atom -> trivial, integration atom -> high |

---

## 9. Decision Record

### 9.1 Alternatives Considered

**Alternative A: LangGraph with parallel nodes.**
Rejected. ADR-004 establishes that LangGraph is redundant on CF. Adding
LangGraph's parallel execution would require re-introducing the dependency
tree (50+ packages) and losing platform-native durability. The custom
StateGraph + multiple DOs achieves the same result with zero new dependencies.

**Alternative B: Queue-per-atom with storage polling.**
Each atom gets its own Queue message. Atom DOs write results to ArangoDB.
Coordinator polls ArangoDB for completion.
Rejected. Adds unnecessary latency (polling interval) and complexity
(partial result assembly from storage). Promise.all on stub.fetch is simpler
and lower latency.

**Alternative C: Single DO with async subgraphs.**
Run all atom pipelines concurrently within the SynthesisCoordinator DO
using Promise.all on graph.run().
Rejected. DOs are single-threaded. Concurrent graph.run() calls would
interleave node executions unpredictably within the same state. Separate DOs
provide true isolation.

**Alternative D: CF Containers per atom (heavyweight).**
Spin up a Container per atom with full filesystem.
Rejected for now. Containers have cold-start cost (seconds) that dominates
for simple atoms. The AtomExecutor DO dispatches to Sandbox Container only
when the atom's coder/tester needs real filesystem access. V8-only atoms
(architect, critic, verifier) stay in the DO.

### 9.2 Key Design Decisions

| Decision | Rationale |
|---|---|
| Promise.all for parallel dispatch, not Queues | Simplicity. DO-to-DO fetch is <1ms. Queue adds indirection without benefit. |
| Separate AtomExecutor DO class, not reusing SynthesisCoordinator | Isolation. Each atom needs its own state, alarm, and Fiber. Reusing the coordinator would require multiplexing state. |
| Coordinator as orchestrator, not peer | The coordinator has the DAG. Atoms do not know about each other. This prevents circular dependencies in the communication graph. |
| Callback pattern for bug fix, not WebSocket or SSE | CF Workers do not support long-lived connections from DOs. fetch() callback is the only reliable cross-boundary notification. |
| Completion ledger for crash recovery, not re-running all atoms | Idempotency at the layer level. Completed atoms are cached in their DOs. Re-dispatching returns cached results. Only incomplete atoms re-execute. |

---

## 10. References

- **MASAI** -- Arora et al. (2024). arXiv:2406.11638
- **LLMCompiler** -- Kim et al. (ICML 2024). arXiv:2312.04511
- **DynTaskMAS** -- Yu et al. (2025). ICAPS 2025. arXiv:2503.07675
- **SASE** -- Hassan et al. (2025). arXiv:2509.06216
- **AgentMesh** -- Khanzadeh (2025). arXiv:2507.19902
- **Blueprint2Code** -- Mao et al. (2025). Frontiers in AI.
- **ADR-004** -- Custom StateGraph Over LangGraph (2026-04-27)
- **factory-ontology.ttl** -- Function Factory Closed-World Model v1.0.0
