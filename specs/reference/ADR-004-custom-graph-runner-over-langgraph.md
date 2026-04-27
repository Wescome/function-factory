# ADR-004: Custom StateGraph Over LangGraph.js

## Status

Accepted — implemented since Phase 4 (2026-04-25)

## Date

2026-04-27

## Lineage

DECISIONS.md (hybrid topology, CF Workflow + DO architecture),
ADR-003 (gdk-agent as default executor), Phase 4 coordinator implementation,
Phase A (all 6 roles → gdk-agent agentLoop sessions)

---

## 1. Decision

Use a custom 80-line `StateGraph` runner (`graph-runner.ts`) instead of
`@langchain/langgraph` for the Stage 6 synthesis graph. LangGraph's
checkpoint, streaming, interrupt, and persistence machinery is redundant
because Cloudflare's platform primitives (Workflows, Fibers, Alarms,
Durable Object storage) already provide these capabilities at the
infrastructure level.

---

## 2. The Feature Mapping

LangGraph.js provides six core capabilities. Each one maps to a CF
primitive that the Factory already uses:

### 2.1 Checkpointing

**LangGraph:** `MemorySaver` or custom `BaseCheckpointSaver`. After each
node executes, the graph state is serialized and persisted. On crash
recovery, the graph resumes from the last checkpoint.

**CF Equivalent:** Two layers, each handling different failure domains:

| Layer | Primitive | What it checkpoints | Survives |
|-------|-----------|-------------------|----------|
| Workflow | `step.do()` | Each pipeline stage (Stages 1–5, Gate 1) | Worker restart, deploy, DO eviction |
| Fiber | `fiberCtx.stash()` | Graph state after each node (Stage 6) | DO eviction mid-synthesis |

```typescript
// Workflow layer — each step.do() is an automatic checkpoint
const signal = await step.do('ingest-signal', async () => { ... })
const pressure = await step.do('synthesize-pressure', async () => { ... })

// Fiber layer — explicit checkpoint after each graph node
const persistState = async (state: GraphState) => {
  await this.ctx.storage.put('graphState', state)
  fiberCtx.stash({ workGraphId, state })  // survives DO eviction
}
```

**Why LangGraph's version is redundant:** CF Workflows already checkpoint
every `step.do()` call to durable storage. If the Worker restarts, the
Workflow resumes from the last completed step. Inside the DO, Fibers
checkpoint the graph state to SQLite — if the DO is evicted mid-synthesis,
`onFiberRecovered` fires on restart and the graph can resume or mark the
run as interrupted. Adding LangGraph's MemorySaver on top creates a
*third* persistence layer with no additional durability guarantee.

### 2.2 Streaming

**LangGraph:** `streamEvents()` yields token-level and node-level events
as the graph executes. Used for real-time UI updates.

**CF Equivalent:** Two mechanisms:

| Mechanism | Scope | Consumer |
|-----------|-------|----------|
| `workflow.sendEvent()` | Cross-boundary (Workflow ↔ DO) | Pipeline Workflow |
| `onNodeStart` / `onNodeEnd` callbacks | Intra-graph | Coordinator DO logging |

```typescript
// Cross-boundary: Queue consumer → DO → sendEvent back to Workflow
await workflow.sendEvent({
  type: 'synthesis-complete',
  payload: { verdict, tokenUsage, repairCount },
})

// Intra-graph: node lifecycle callbacks
const finalState = await graph.run(initialState, {
  onNodeStart: (name, state) => {
    console.log(`[Stage 6] ${name} starting (repair ${state.repairCount})`)
  },
  maxSteps: 50,
})
```

**Why LangGraph's version is redundant:** The Factory has no real-time UI
that consumes token-level streaming. The Workflow is the consumer, and it
receives synthesis results via `sendEvent()` — a durable, exactly-once
delivery mechanism. LangGraph's `streamEvents()` uses in-memory async
iterators that don't survive Worker restarts.

### 2.3 Human-in-the-Loop Interrupt

**LangGraph:** `interrupt()` pauses graph execution and waits for human
input before resuming. State is checkpointed at the interrupt point.

**CF Equivalent:** `step.waitForEvent()` in Workflows, with durable
persistence and configurable timeout.

```typescript
// Architect approval gate — pauses up to 7 days
const approval = await step.waitForEvent<{
  decision: string; reason?: string; by?: string
}>('architect-approval', {
  type: 'architect-approval',
  timeout: '7 days',
})

// Synthesis completion — pauses up to 30 minutes
const synthEvent = await step.waitForEvent<{
  verdict: { decision: string; confidence: number; reason: string }
}>('synthesis-complete', {
  type: 'synthesis-complete',
  timeout: '30 minutes',
})
```

**Why LangGraph's version is redundant:** `step.waitForEvent()` is
*durable* — it survives Worker restarts, deploys, even DO evictions.
The Workflow stays paused in Cloudflare's infrastructure at zero compute
cost. LangGraph's `interrupt()` requires an external runner to hold the
graph state in memory or in a checkpointer while waiting. In a serverless
environment, that means paying for a long-running process or building
custom resume-from-checkpoint logic — which is exactly what CF Workflows
already provide.

### 2.4 Wall-Clock Timeout

**LangGraph:** Custom timeout logic or external timer. No built-in
wall-clock timeout that fires independently of the execution thread.

**CF Equivalent:** DO Alarms — platform-managed timers that fire even
when the V8 isolate is suspended on I/O.

```typescript
// Set wall-clock alarm scaled to WorkGraph complexity
const atoms = (workGraph.atoms as unknown[])?.length ?? 0
const timeoutMs = Math.max(180_000, 180_000 + atoms * 30_000)
await this.ctx.storage.setAlarm(Date.now() + timeoutMs)

// Alarm fires independently — even if fetch() is suspended
override async alarm(): Promise<void> {
  const completed = await this.ctx.storage.get<boolean>('__completed')
  if (completed) return
  // Mark state as interrupted
  await this.ctx.storage.put('graphState', {
    ...state,
    verdict: { decision: 'interrupt', confidence: 1.0,
      reason: 'DO alarm: synthesis exceeded wall-clock deadline' },
  })
}
```

**Why this matters:** `setTimeout` does NOT tick during I/O suspension in
DOs. `AbortSignal.timeout()` works for fetch calls but not for
coordinating multi-step synthesis. DO Alarms are the only reliable
wall-clock timer in the CF runtime.

### 2.5 Crash Recovery

**LangGraph:** Resume from last checkpoint in the checkpointer. Requires
the application to detect the crash and restart the graph with the
saved thread ID.

**CF Equivalent:** Fibers provide automatic crash recovery with zero
application-level restart logic.

```typescript
// Wrap synthesis in a Fiber — crash recovery is automatic
return this.runFiber(`synth-${workGraphId}`, async (fiberCtx) => {
  // ... graph execution ...
  fiberCtx.stash({ workGraphId, state })  // checkpoint
})

// If DO is evicted, this fires automatically on restart
override async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
  const snapshot = ctx.snapshot as { workGraphId?: string; state?: GraphState }
  // Mark as interrupted so next call returns immediately
  await this.ctx.storage.put('graphState', {
    ...snapshot.state,
    verdict: { decision: 'interrupt', confidence: 1.0,
      reason: `Fiber recovered after DO eviction (fiber=${ctx.id})` },
  })
}
```

**Why LangGraph's version is redundant:** Fibers detect crash
automatically (via SQLite journal in the DO), fire the recovery hook,
and give the application the last stashed state. No external health
check, no retry queue, no manual restart.

### 2.6 Persistence / State Management

**LangGraph:** Thread-based state management. Each run gets a thread ID,
and state is serialized to the checkpointer at each step.

**CF Equivalent:** DO storage (`this.ctx.storage`) + ArangoDB for
cross-run persistence.

| Storage | Scope | Durability | Use |
|---------|-------|-----------|-----|
| `this.ctx.storage` | Single synthesis run | DO lifetime | Graph state, alarm flags, completion |
| `fiberCtx.stash()` | Crash recovery | Survives DO eviction | State snapshot for recovery |
| ArangoDB | Cross-run | Permanent | Artifacts, lineage, episodic memory |

**Why LangGraph's version is redundant:** The three-tier storage model
covers every persistence need. `this.ctx.storage` is the hot path (fast,
co-located with the DO). `stash()` is the crash recovery path. ArangoDB
is the permanent record. LangGraph's checkpointer would be a fourth
layer adding latency with no additional guarantee.

---

## 3. What the Custom Runner Provides

`graph-runner.ts` — 80 lines, zero dependencies:

```typescript
class StateGraph<S> {
  addNode(name: string, fn: (state: S) => Promise<Partial<S>>): this
  addEdge(from: string, to: string): this
  addConditionalEdge(from: string, router: (state: S) => string): this
  setEntryPoint(name: string): this
  run(initialState: S, opts?: { onNodeStart?, onNodeEnd?, maxSteps? }): Promise<S>
}
```

This is the **only** part of LangGraph the Factory actually uses: a
directed graph with nodes, edges, conditional routing, and state
accumulation. Everything else — checkpointing, streaming, interrupts,
crash recovery, timeout — is handled by CF platform primitives.

---

## 4. What We Explicitly Do NOT Use From LangGraph

| LangGraph Feature | Why Not | CF Alternative |
|------------------|---------|----------------|
| `MemorySaver` / `PostgresSaver` | Redundant with DO storage + Fibers | `this.ctx.storage` + `stash()` |
| `streamEvents()` | No real-time UI consumer | `sendEvent()` + node callbacks |
| `interrupt()` | Not durable in serverless | `step.waitForEvent()` (7-day durability) |
| `@langchain/core` dep tree | 50+ transitive deps, doesn't run in CF Workers | Zero deps |
| Thread-based state | Single-run DO owns its state | `this.ctx.storage.put('graphState', ...)` |
| `createReactAgent()` | Opinionated agent shape | gdk-agent `agentLoop()` with custom tools |
| Zod v4 requirement | Peer dep conflict with existing Zod v3 | TypeBox (via gdk-ai) |

---

## 5. When to Reconsider

Revisit this decision if:

1. **Multi-tenant graph execution** — if multiple independent graphs need
   to run concurrently with isolated state, LangGraph's thread model
   becomes attractive. Currently each DO handles one synthesis at a time.

2. **Graph debugging UI** — if we build a visual debugger that needs
   LangGraph Studio compatibility, adopting the LangGraph protocol would
   enable it. Currently debugging uses node callbacks + ArangoDB episodic
   memory.

3. **Complex branching** — if the graph topology evolves beyond linear +
   repair-loop (e.g., parallel node execution, dynamic subgraphs),
   LangGraph's more sophisticated execution engine may be worth the
   dependency cost. Currently the 9-node topology is linear with one
   conditional repair loop.

4. **CF primitives become insufficient** — if Workflows, Fibers, or DO
   storage hit scaling limits that LangGraph's checkpointer would solve.
   No evidence of this yet.

---

## 6. Consequences

### Benefits

- **Zero external dependencies** for the graph runner
- **No peer dependency conflicts** (LangGraph requires Zod v4; Factory uses v3)
- **Runs natively in CF Workers V8** — no Node.js API polyfills needed
- **80 lines** vs ~15,000 lines in @langchain/langgraph
- **Platform-native durability** — every checkpoint, timeout, and interrupt
  uses the mechanism Cloudflare optimized for its own runtime

### Tradeoffs

- **No LangGraph Studio** compatibility for visual debugging
- **No built-in parallel node execution** (would need to add if required)
- **Manual implementation** of any new graph patterns (subgraphs, map-reduce)
- **Not portable** — tightly coupled to CF platform primitives

### What Is NOT Changed

- The 9-node graph topology (unchanged)
- The graph API shape (same as LangGraph: addNode/addEdge/run)
- The state accumulation pattern (each node returns Partial<S>)
- The conditional routing pattern (addConditionalEdge with router function)

---

## 7. Reference

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| StateGraph runner | `workers/ff-pipeline/src/coordinator/graph-runner.ts` | 80 | Directed graph execution |
| Graph topology | `workers/ff-pipeline/src/coordinator/graph.ts` | ~350 | 9-node synthesis graph |
| CF Workflow | `workers/ff-pipeline/src/pipeline.ts` | ~265 | Stages 1–5, gates, event-driven handoff |
| Coordinator DO | `workers/ff-pipeline/src/coordinator/coordinator.ts` | ~370 | Fibers, alarms, agent instantiation |
| Graph state | `workers/ff-pipeline/src/coordinator/state.ts` | ~85 | GraphState type definition |
