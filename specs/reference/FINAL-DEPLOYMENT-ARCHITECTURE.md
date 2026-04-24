# Function Factory — Full Deployment Architecture

**Author:** Architecture proposal for Wislet J. Celestin / Koales.ai
**Date:** 2026-04-24
**Status:** Draft — requires architect review before DECISIONS.md entry
**Lineage:** DEFINITIVE-ARCHITECTURE.md, ConOps v2026-04-18, DogFood session,
ADR-001/002 (execution fabric), Moltworker research, CF Workflows GA,
task-routing routing config, pi-ai/pi-agent-core substrate.

---

## 0. Design Constraint

One compute platform: Cloudflare. Two execution modes: pi-ai internal loop
(structured reasoning) and Container delegation (real code execution). 
ArangoDB Oasis as sole storage substrate. No Railway. No Kubernetes.
Solo-developer operable.

---

## 1. The Composition

The Factory has two fundamentally different kinds of work:

**Structured reasoning** — synthesize a Pressure from a Signal, map a
Capability, compile a PRD, critique code output, verify test results, make
a pass/patch/fail decision. The input and output are typed JSON. The agent
doesn't need a filesystem, git, or shell. It needs a model, a prompt, tool
calling, and structured output parsing. pi-ai's agent loop handles this.

**Real code execution** — clone a repo, create a branch, write files, run
tests, iterate on failures, produce artifacts. The agent needs full system
access: filesystem, git, npm, shell commands. This is what OpenHands,
Aider, and Claude Code do. Cloudflare Containers handle this, governed by
ADR-002's execution fabric.

The pipeline orchestration (CF Workflows) doesn't care which mode a step
uses. It dispatches work and collects results. The LangGraph coordinator
(Stage 6) decides which mode each role uses:

```
CF Workflow: FactoryPipeline
  │
  ├─ Stages 1-5 ── pi-ai internal loop
  │                 (structured reasoning, typed output)
  │                 includes semantic review (Critic-at-authoring)
  │                 before compilation — catches miscast PRDs
  │
  ├─ Stage 6 ───── LangGraph in Coordinator DO
  │   │
  │   ├─ Planner ── pi-ai    (produces plan as JSON)
  │   ├─ Coder ──── Container (ADR-002: real repo, real tests)
  │   ├─ Critic ─── pi-ai    (reads artifacts, emits verdict)
  │   ├─ Tester ─── Container (runs test suite, reports results)
  │   ├─ Verifier ─ pi-ai    (pass/patch/resample/interrupt/fail)
  │   │
  │   └─ Repair loop: Verifier → patch → Coder (new container job)
  │
  ├─ Gates 1-3 ─── pi-ai / deterministic (structured validation)
  │
  └─ Stage 7 ───── DO alarms (continuous monitoring)
```

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     COMPUTE: Cloudflare                              │
│                                                                      │
│  Workers ────── Edge ingress, API routing, Gate 1, spec queries      │
│                                                                      │
│  Workflows ──── Pipeline orchestration (Stages 1→7)                  │
│                 Durable steps, waitForEvent, auto-retry               │
│                                                                      │
│  Durable Objects                                                     │
│     Coordinator DO ── Stage 6 LangGraph + lease/heartbeat            │
│     Assurance DO ──── Gate 3 continuous monitoring                    │
│     Dream DO ──────── Memory consolidation                           │
│                                                                      │
│  Containers ──── Agent execution (Coder, Tester roles)               │
│                  OpenHands / Aider / Claude Code                     │
│                  ADR-002 governed: lease, heartbeat, policy           │
│                                                                      │
│  Queues ──────── Signal ingestion, container job dispatch             │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     STORAGE: ArangoDB Oasis                          │
│                                                                      │
│  Document ── specs, memory tiers, gate status,                       │
│              job ledger (function_runs), execution artifacts          │
│  Graph ────── lineage, assurance, dependencies                       │
│  Search ───── full-text + vector (semantic memory)                   │
└──────────────────────────────────────────────────────────────────────┘
```

### One storage substrate

ArangoDB stores both Factory-domain data (specs, memory, lineage, gates)
and execution-domain data (job ledger, artifacts, lease state). One driver,
one query language, one backup, one set of credentials. The Coordinator DO
reads WorkGraphs and writes FunctionRuns in the same transaction boundary.

---

## 3. Execution Mode A: pi-ai Internal Loop

Used for roles that produce **structured output** from **structured input**.
No filesystem, no git, no shell. The agent is a conversation loop with tool
calling and JSON output.

**Where it runs:** Inside Workflow steps (Stages 1-5, Gates) or inside the
Coordinator DO (Stage 6 Planner, Critic, Verifier roles).

**Stack:**
```
task-routing resolve(taskKind)
       → { provider, model }
              │
pi-ai getModel(provider, model)
       → complete() / stream()
              │
              ├─ tool calling (TypeBox schemas, auto-validation)
              ├─ streaming with progressive JSON parsing
              ├─ thinking/reasoning support
              ├─ cross-provider context handoffs
              ├─ token + cost tracking
              └─ agent loop (tool use → result → next turn → repeat)
```

**Example: Stage 2 Pressure Synthesis (Workflow step)**

```typescript
const pressure = await step.do('synthesize-pressure', async () => {
  const { provider, model } = resolve('planning')  // task-routing
  const m = getModel(provider, model)               // pi-ai
  const result = await complete(m, {
    messages: [
      { role: 'user', content: JSON.stringify(signal), timestamp: Date.now() }
    ],
  }, {
    tools: [pressureEmitTool],  // TypeBox-validated structured output
    sessionId: `pipeline-${runId}`,
  })
  return PressureSchema.parse(extractToolResult(result))
})
```

**Example: Stage 6 Critic Role (inside Coordinator DO)**

```typescript
// Critic reads Coder artifacts from ArangoDB, produces critique via pi-ai
private async runCritic(state: GraphState): Promise<Partial<GraphState>> {
  const { provider, model } = resolve('critic')
  const m = getModel(provider, model)

  // Artifacts from Coder's container execution
  const codeArtifacts = await this.fetchArtifacts(state.coderRunId)

  const result = await complete(m, {
    messages: [{
      role: 'user',
      content: buildCritiquePrompt(state.workGraph, codeArtifacts),
      timestamp: Date.now(),
    }],
  }, {
    tools: [critiqueEmitTool],
  })

  return { critique: CritiqueSchema.parse(extractToolResult(result)) }
}
```

---

## 4. Execution Mode B: Container Delegation (ADR-002)

Used for roles that need **real system access**: filesystem, git, shell,
npm, test runners. The agent is an autonomous coding tool running in an
isolated container.

**Where it runs:** Cloudflare Containers, launched by the Coordinator DO,
governed by ADR-002's lease/heartbeat/policy model.

**Stack:**
```
Coordinator DO
       │
       ├─ Creates FunctionJob (ArangoDB function_runs)
       ├─ Launches Container
       │
       └─ Container lifecycle:
              ├─ clone repo
              ├─ create branch
              ├─ run executor (OpenHands / Aider / Claude Code)
              ├─ heartbeat every 20s → Coordinator DO
              ├─ collect artifacts
              ├─ upload to ArangoDB (execution_artifacts)
              └─ finalize (function_runs status update)
```

**The FunctionJob contract** (from ADR-002, adapted for Stage 6):

```typescript
type FunctionJob = {
  jobId: string
  functionRunId: string     // maps to pipeline Workflow instance
  coordinatorObjectId: string

  executor: 'openhands' | 'aider' | 'claude_code'
  mode: 'propose' | 'patch' | 'publish'

  // What to build — derived from WorkGraph
  objective: {
    workGraphId: string
    role: 'coder' | 'tester'
    plan: Plan              // from Planner role output
    repairNotes?: string    // from Verifier on patch cycle
  }

  repo: { url: string, ref: string, branch: string }

  // ADR-002 policies
  fileScope: FileScopeRule
  commandPolicy: CommandPolicy
  networkPolicy: NetworkPolicy
  sideEffectPolicy: SideEffectPolicy
  limits: ResourceLimits

  executionTarget: {
    platform: 'cloudflare'
    containerImage: string
  }
}
```

**Executor selection** follows ADR-002 §11, driven by the Planner's output:

| Signal from Planner | Executor | Rationale |
|---|---|---|
| Multi-file, repo-wide changes | OpenHands | Best at autonomous multi-step |
| Narrow file edits, test-driven | Aider | Bounded scope, predictable |
| Complex reasoning, ambiguity | Claude Code | High-agency understanding |

The Coordinator DO selects the executor based on the Planner's output and
the WorkGraph's complexity classification.

---

## 5. The Coordinator DO — Both Modes Composed

The Coordinator DO is the bridge. It runs LangGraph.js for the five-role
topology, dispatching each role to the appropriate execution mode:

```typescript
export class SynthesisCoordinator extends DurableObject<Env> {

  async synthesize(workGraph: WorkGraph): Promise<SynthesisResult> {
    const graph = this.buildGraph()
    const compiled = graph.compile({ checkpointer: new MemorySaver() })
    return compiled.invoke({ workGraph, repairCount: 0 }, config)
  }

  private buildGraph() {
    const graph = new StateGraph(SynthesisState)

    // pi-ai roles (structured reasoning, in-process)
    graph.addNode('planner',  this.piAiRole('planner'))
    graph.addNode('critic',   this.piAiRole('critic'))
    graph.addNode('verifier', this.piAiRole('verifier'))

    // Container roles (real execution, ADR-002)
    graph.addNode('coder',  this.containerRole('coder'))
    graph.addNode('tester', this.containerRole('tester'))

    // Budget gate
    graph.addNode('budget-check', this.budgetCheck)

    // Flow
    graph.setEntryPoint('budget-check')
    graph.addEdge('budget-check', 'planner')
    graph.addEdge('planner', 'coder')
    graph.addEdge('coder', 'critic')
    graph.addEdge('critic', 'tester')
    graph.addEdge('tester', 'verifier')

    // Repair loop
    graph.addConditionalEdges('verifier', (state) => {
      switch (state.verdict.decision) {
        case 'pass':      return '__end__'
        case 'patch':     return 'budget-check'
        case 'resample':  return 'budget-check'
        case 'interrupt': return '__end__'
        case 'fail':      return '__end__'
      }
    })

    return graph
  }

  // ── pi-ai role: structured reasoning ──
  private piAiRole(role: RoleName) {
    return async (state: GraphState): Promise<Partial<GraphState>> => {
      const { provider, model } = resolve(role)  // task-routing
      const m = getModel(provider, model)         // pi-ai

      const result = await complete(m, {
        messages: buildRoleMessages(role, state),
      }, {
        tools: ROLE_TOOLS[role],
        sessionId: `synth-${state.workGraph.id}-${role}`,
      })

      const output = ROLE_CONTRACTS[role].parse(extractToolResult(result))
      await this.persistState(state, role, output)
      return { [ROLE_CONTRACTS[role].channel]: output }
    }
  }

  // ── Container role: real execution (ADR-002) ──
  private containerRole(role: 'coder' | 'tester') {
    return async (state: GraphState): Promise<Partial<GraphState>> => {
      // 1. Select executor based on Planner output
      const executor = this.selectExecutor(state.plan)

      // 2. Build FunctionJob
      const job: FunctionJob = {
        jobId: crypto.randomUUID(),
        functionRunId: state.workGraph.id,
        coordinatorObjectId: this.ctx.id.toString(),
        executor,
        mode: 'patch',
        objective: {
          workGraphId: state.workGraph.id,
          role,
          plan: state.plan,
          repairNotes: state.verdict?.decision === 'patch'
            ? state.verdict.notes : undefined,
        },
        repo: state.workGraph.repo,
        fileScope: state.workGraph.fileScope,
        commandPolicy: state.workGraph.commandPolicy,
        networkPolicy: { default: 'deny' },
        sideEffectPolicy: { allowCommit: true, allowPR: false },
        limits: { maxDurationSec: 300, maxTokens: 150_000 },
        executionTarget: {
          platform: 'cloudflare',
          containerImage: EXECUTOR_IMAGES[executor],
        },
      }

      // 3. Write to ArangoDB ledger
      await writeToArango(this.env, 'function_runs', {
        _key: job.jobId,
        functionRunId: job.functionRunId,
        executor: job.executor,
        mode: job.mode,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })

      // 4. Launch container
      const container = await this.env.CONTAINER.start(job)

      // 5. Monitor via heartbeat (ADR-002 §10)
      const result = await this.monitorExecution(container, job)

      // 6. Fetch artifacts from ArangoDB
      const artifacts = await this.fetchArtifacts(job.jobId)

      // 7. Validate (ADR-002 §13)
      const validation = await this.validateExecution(artifacts, job)
      if (!validation.passed) {
        return { verdict: { decision: 'fail', reason: validation.reason } }
      }

      // 8. Finalize in ArangoDB
      await this.finalizeRun(job, 'succeeded')

      await this.persistState(state, role, artifacts)
      return { [role === 'coder' ? 'code' : 'tests']: artifacts }
    }
  }

  // ── Lease/heartbeat (ADR-002 §9-10) ──
  private async monitorExecution(
    container: ContainerHandle,
    job: FunctionJob,
  ): Promise<ExecutionResult> {
    const leaseMs = 60_000
    const heartbeatMs = 20_000

    await this.acquireLease(job.jobId, leaseMs)

    return new Promise((resolve, reject) => {
      const heartbeatInterval = setInterval(async () => {
        const alive = await container.heartbeat()
        if (alive) {
          await this.renewLease(job.jobId, leaseMs)
        } else {
          clearInterval(heartbeatInterval)
          reject(new Error('Container heartbeat lost'))
        }
      }, heartbeatMs)

      container.onComplete((result) => {
        clearInterval(heartbeatInterval)
        resolve(result)
      })
    })
  }
}
```

### 5.2 Assurance DO — Gate 3 + Incident Propagation

One DO instance per Function under monitoring. Two responsibilities:
alarm-driven Gate 3, and incident propagation through the dependency graph.

**Trigger:** `registerFunction()` called by the Workflow's Stage 7 step
after Gate 2 passes. Sets the first alarm. Re-arms after every check.

**Gate 3 checks (on each alarm):**
- Detector freshness — are the invariant detectors still producing data?
- Evidence source liveness — are the sources they read from still alive?
- Audit pipeline integrity — is the coverage report pipeline intact?

**On failure:** transitions the Function to `assurance-regressed` in
ArangoDB, propagates the incident through `assurance_edges` to find
downstream Functions, degrades their trust scores.

```typescript
export class AssuranceGraph extends DurableObject<Env> {

  async registerFunction(functionId: string, workGraph: WorkGraph) {
    await this.ctx.storage.put('config', {
      functionId,
      invariants: workGraph.invariants,
      detectors: workGraph.detectors,
    })
    await this.ctx.storage.setAlarm(Date.now() + GATE_3_INTERVAL_MS)
  }

  async alarm() {
    const config = await this.ctx.storage.get<MonitoringConfig>('config')
    const health = await this.checkDetectorFreshness(config)
    const liveness = await this.checkEvidenceSourceLiveness(config)
    const integrity = await this.checkAuditPipelineIntegrity(config)

    // Write Gate 3 report to ArangoDB
    await writeToArango(this.env, 'specs_coverage_reports', {
      type: 'gate-3',
      functionId: config.functionId,
      health, liveness, integrity,
      passed: health.ok && liveness.ok && integrity.ok,
      timestamp: new Date().toISOString(),
    })

    if (!health.ok || !liveness.ok || !integrity.ok) {
      await this.transitionToAssuranceRegressed(config.functionId)
      await this.propagateIncident(config.functionId)
    }

    // Re-arm
    await this.ctx.storage.setAlarm(Date.now() + GATE_3_INTERVAL_MS)
  }

  private async propagateIncident(functionId: string) {
    const affected = await queryArango(this.env, `
      FOR v IN 1..5 OUTBOUND @start assurance_edges
        FILTER v.type == 'function'
        RETURN v._key
    `, { start: `specs_functions/${functionId}` })

    for (const fnId of affected) {
      await updateArango(this.env, 'trust_scores', fnId, {
        score: 0, // degraded — requires re-evaluation
        lastIncident: new Date().toISOString(),
      })
    }
  }
}
```

### 5.3 Dream DO — Memory Consolidation + Crystallization Trigger

Singleton DO. Two jobs, both alarm-driven, both off the critical path.

**Job 1: Memory consolidation (the "dream cycle")**

Reads `memory_episodic` from ArangoDB, scores entries by
`pain_score × importance × recurrence`, promotes high-scoring patterns
to `memory_semantic` (LESSONS), prunes stale `memory_working` entries,
archives old episodic entries to a snapshot document. Does not delete
episodic entries — the raw trace is truth; semantic memory is
interpretation.

**Trigger:** Alarm, recurring (e.g., daily or every N pipeline runs).

**Data flow:**
```
memory_episodic (read)
       │
       ├─ score entries
       ├─ detect recurrence (same skill + same failure > threshold)
       ├─ promote: write to memory_semantic (LESSONS / DECISIONS)
       ├─ prune: clear stale memory_working entries
       └─ archive: snapshot document in memory_episodic (timestamped)
```

**Job 2: Crystallization check**

After Gate 3 passes on a Function for the first time, the Assurance DO
notifies the Dream DO. The Dream DO checks whether the execution path
contains a novel pattern worth crystallizing — a new invariant template,
a new compiler-pass heuristic, a reusable code pattern. If it finds one,
it proposes (not auto-commits) a new artifact that enters the Critic
review flow via a new pipeline run.

This is the GenericAgent-informed pattern from DECISIONS.md: "successful
Gate 3 passage triggers a crystallization check; if the execution path
contains a novel pattern not already captured by an existing invariant or
template, a new artifact is proposed."

**Trigger:** Event from Assurance DO on first successful Gate 3 for a
Function, OR alarm-driven periodic scan of recent Gate 3 passes.

**Data flow:**
```
Gate 3 PASS event (from Assurance DO)
       │
       ├─ read execution artifacts for this Function
       ├─ read existing invariants + templates (specs_invariants)
       ├─ pi-ai call: "does this execution contain a novel pattern?"
       │
       ├─ if novel → propose artifact (writes to specs/ as 'proposed')
       │              → enters Critic review via new pipeline trigger
       └─ if not   → no-op, log to memory_episodic
```

**Why a DO, not a Cron Worker:** The Dream DO holds state between runs —
which entries it has already scored, which Functions it has already checked
for crystallization, the timestamp of the last consolidation. A stateless
Cron Worker would re-scan everything on every run. The DO's SQLite tracks
the high-water mark.

```typescript
export class DreamEngine extends DurableObject<Env> {

  async alarm() {
    const lastRun = await this.ctx.storage.get<string>('lastConsolidation')

    // Job 1: Memory consolidation
    await this.consolidateMemory(lastRun)

    // Job 2: Crystallization check on recent Gate 3 passes
    await this.checkForCrystallization(lastRun)

    await this.ctx.storage.put('lastConsolidation', new Date().toISOString())
    await this.ctx.storage.setAlarm(Date.now() + DREAM_INTERVAL_MS)
  }

  private async consolidateMemory(since?: string) {
    // Read recent episodic entries from ArangoDB
    const entries = await queryArango(this.env, `
      FOR e IN memory_episodic
        FILTER e.timestamp > @since
        SORT e.timestamp ASC
        RETURN e
    `, { since: since ?? '1970-01-01T00:00:00Z' })

    // Score and detect recurrence
    const scored = entries.map(e => ({
      ...e,
      score: (e.pain_score ?? 5) * (e.importance ?? 5),
    }))

    const recurrent = this.detectRecurrence(scored)

    // Promote high-scoring recurrent patterns to semantic memory
    for (const pattern of recurrent) {
      if (pattern.score >= PROMOTION_THRESHOLD) {
        await writeToArango(this.env, 'memory_semantic', {
          type: 'lesson',
          content: pattern.reflection,
          sourceEntries: pattern.entryIds,
          promotedAt: new Date().toISOString(),
        })
      }
    }

    // Prune stale working memory
    await queryArango(this.env, `
      FOR w IN memory_working
        FILTER w.updatedAt < DATE_SUBTRACT(DATE_NOW(), @staleDays, "day")
        REMOVE w IN memory_working
    `, { staleDays: STALE_WORKSPACE_DAYS })
  }

  private async checkForCrystallization(since?: string) {
    // Find Functions that passed Gate 3 since last run
    const recentPasses = await queryArango(this.env, `
      FOR cr IN specs_coverage_reports
        FILTER cr.type == 'gate-3'
        FILTER cr.passed == true
        FILTER cr.timestamp > @since
        RETURN DISTINCT cr.functionId
    `, { since: since ?? '1970-01-01T00:00:00Z' })

    // Already-checked Functions (tracked in DO SQLite)
    const checked = await this.ctx.storage.get<string[]>('crystallized') ?? []

    for (const fnId of recentPasses) {
      if (checked.includes(fnId)) continue

      // Fetch execution artifacts
      const artifacts = await queryArango(this.env, `
        FOR a IN execution_artifacts
          FILTER a.functionRunId == @fnId
          RETURN a
      `, { fnId })

      // Fetch existing invariants for novelty comparison
      const existing = await queryArango(this.env, `
        FOR inv IN specs_invariants RETURN inv
      `)

      // pi-ai call: is there a novel pattern?
      const { provider, model: modelId } = resolve('synthesis')
      const m = getModel(provider, modelId)
      const result = await complete(m, {
        messages: [{
          role: 'user',
          content: buildCrystallizationPrompt(artifacts, existing),
          timestamp: Date.now(),
        }],
      }, { tools: [crystallizationTool] })

      const proposal = CrystallizationSchema.parse(extractToolResult(result))

      if (proposal.novel) {
        // Propose new artifact — enters Critic review flow
        await writeToArango(this.env, 'specs_invariants', {
          ...proposal.artifact,
          status: 'proposed',
          source_refs: [{ type: 'crystallization', functionId: fnId }],
          proposedAt: new Date().toISOString(),
        })
      }

      checked.push(fnId)
      await this.ctx.storage.put('crystallized', checked)
    }
  }
}
```

---

## 6. CF Workflows — Pipeline Skeleton

The Workflow doesn't know about execution modes. It calls stages, collects
results, evaluates gates, and waits for architect approval. Each step is
independently retryable.

```typescript
export class FactoryPipeline extends WorkflowEntrypoint<Env, PipelineParams> {
  async run(event: WorkflowEvent<PipelineParams>, step: WorkflowStep) {

    // ── Stages 1-4: pi-ai internal loop ──
    const signal   = await step.do('ingest-signal', () => ingestSignal(event))
    const pressure = await step.do('synthesize-pressure', () => synthesizePressure(signal, this.env))
    const cap      = await step.do('map-capability', () => mapCapability(pressure, this.env))
    const proposal = await step.do('propose-function', () => proposeFunction(cap, this.env))

    // ── Architect approval ──
    const approval = await step.waitForEvent('architect-approval', { timeout: '7 days' })
    if (approval.type !== 'approved') return { status: 'rejected' }

    // ── Semantic review (Critic-at-authoring, pre-compile) ──
    const semanticReview = await step.do('semantic-review', async () => {
      const { provider, model: modelId } = resolve('critic')
      const m = getModel(provider, modelId)
      const result = await complete(m, {
        messages: [{
          role: 'user',
          content: buildSemanticReviewPrompt(proposal.prd, proposal.prd.sourceRefs),
          timestamp: Date.now(),
        }],
      }, { tools: [semanticReviewTool] })
      return SemanticReviewSchema.parse(extractToolResult(result))
    })
    if (semanticReview.alignment === 'miscast') {
      return { status: 'semantic-miscast', report: semanticReview }
    }

    // ── Stage 5: 8-pass compilation (pi-ai) ──
    let compState = { prd: proposal.prd }
    for (const pass of COMPILER_PASSES) {
      compState = await step.do(`compile-${pass.name}`, () => pass.execute(compState, this.env))
    }

    // ── Gate 1 (deterministic, edge) ──
    const gate1 = await step.do('gate-1', () => this.env.GATES.evaluateGate1(compState.workGraph))
    if (!gate1.passed) return { status: 'gate-1-failed', report: gate1.report }

    // ── Stage 6: synthesis (LangGraph + Containers) ──
    const synthesis = await step.do('stage-6', async () => {
      const id = this.env.COORDINATOR.idFromName(proposal.id)
      const coord = this.env.COORDINATOR.get(id)
      return coord.synthesize(compState.workGraph)
    })
    if (synthesis.verdict.decision === 'fail') return { status: 'synthesis-failed' }

    // ── Gate 2 (pi-ai, simulation coverage) ──
    const gate2 = await step.do('gate-2', () => evaluateGate2(synthesis, compState.workGraph, this.env))
    if (!gate2.passed) return { status: 'gate-2-failed', report: gate2.report }

    // ── Persist to ArangoDB ──
    await step.do('persist', () => writeToArango(this.env, { signal, pressure, cap, proposal, semanticReview, compState, synthesis, gate1, gate2 }))

    // ── Stage 7: register for monitoring ──
    await step.do('register-monitoring', async () => {
      const id = this.env.ASSURANCE.idFromName(proposal.id)
      const assurance = this.env.ASSURANCE.get(id)
      await assurance.registerFunction(synthesis.functionId, compState.workGraph)
    })

    return { status: 'complete', functionId: synthesis.functionId }
  }
}
```

---

## 7. Workers — Edge Plane

```
gateway-worker ── API router, Cloudflare Access auth
                  POST /pipeline     → trigger Workflow
                  POST /signal       → Queue
                  GET  /specs/:id    → query-worker
                  GET  /health       → query-worker
                  POST /gate/1       → gates-worker
                  POST /approve/:id  → Workflow sendEvent
                  GET  /run/:id      → query-worker (job status)

gates-worker   ── Gate 1 (deterministic Zod, <10ms)

query-worker   ── ArangoDB read path (specs, lineage, health)

webhook-worker ── GitHub CI, external signals → Queue
```

---

## 8. Storage — ArangoDB Oasis

One substrate. Factory truth and execution truth in the same database.

```
Document collections:
  specs_pressures, specs_capabilities, specs_functions,
  specs_prds, specs_workgraphs, specs_invariants,
  specs_coverage_reports (append-only)

  gate_status, trust_scores, invariant_health

  memory_episodic, memory_semantic, memory_working, memory_personal

  function_runs          ── job ledger (lease, status, attempt count)
  execution_artifacts    ── patches, test reports, logs, commit metadata

Graph edges:
  lineage_edges, assurance_edges, dependency_edges
```

The `function_runs` collection replaces D1. Atomic lease claim via AQL:

```aql
FOR run IN function_runs
  FILTER run._key == @id
  FILTER run.leaseExpiresAt == null OR run.leaseExpiresAt < DATE_NOW()
  UPDATE run WITH {
    leaseOwner: @worker,
    leaseExpiresAt: DATE_ADD(DATE_NOW(), 60, "second"),
    status: "claimed"
  } IN function_runs
  RETURN NEW
```

The `execution_artifacts` collection replaces R2. Artifacts are text
(unified diffs, JSON reports, logs) — documents, not binary blobs:

```json
{
  "_key": "{sha256}",
  "functionRunId": "...",
  "type": "patch | test_report | logs | commit_metadata",
  "content": "...",
  "createdAt": "..."
}
```

---

## 9. Model Substrate

**pi-ai** (`@mariozechner/pi-ai`) owns the model layer: streaming, tool
calling (TypeBox schemas, auto-validation), agent loop, cross-provider
handoffs, thinking/reasoning, token + cost tracking, session management.

**task-routing** (`@factory/task-routing`) owns routing config:
`resolve(taskKind)` → `{ provider, model }` for pi-ai's `getModel()`. No
provider abstractions. No retry logic. Just a typed config lookup.

**Container executors** (OpenHands, Aider, Claude Code) own their own model
access. They run inside containers with their own API keys and their own
model selection. The Factory doesn't mediate their model calls — it provides
the objective and collects the artifacts.

---

## 10. What Runs Where

| Factory concern              | CF primitive    | Execution mode        |
|------------------------------|-----------------|------------------------|
| API routing, auth            | Worker          | —                      |
| Stages 1-5 (reasoning)      | Workflow steps  | pi-ai internal loop    |
| Semantic review (pre-compile)| Workflow step   | pi-ai internal loop    |
| Architect approval           | Workflow event  | —                      |
| Gate 1 (compile coverage)    | Worker          | Deterministic          |
| Stage 6 Planner              | DO (LangGraph)  | pi-ai internal loop    |
| Stage 6 Coder                | DO → Container  | ADR-002 delegation     |
| Stage 6 Critic               | DO (LangGraph)  | pi-ai internal loop    |
| Stage 6 Tester               | DO → Container  | ADR-002 delegation     |
| Stage 6 Verifier             | DO (LangGraph)  | pi-ai internal loop    |
| Gate 2 (simulation)          | Workflow step   | pi-ai internal loop    |
| Gate 3 (continuous)          | DO alarm        | pi-ai internal loop    |
| Memory consolidation         | DO alarm        | ArangoDB queries       |
| Crystallization check        | DO alarm/event  | pi-ai internal loop    |
| Job ledger + artifacts       | ArangoDB        | —                      |
| Spec queries                 | Worker          | —                      |

---

## 11. What Replaces What

| Prior proposed component        | Now                                      |
|---------------------------------|------------------------------------------|
| Railway compute                 | CF Workers + Workflows + DOs + Containers|
| LangGraph.js (full pipeline)    | CF Workflows (outer) + LangGraph (Stage 6)|
| LangGraph.js checkpointer      | DO SQLite (no custom adapter)            |
| K8s Jobs (ADR-001)              | CF Containers (ADR-002)                  |
| Postgres ledger (ADR-001)       | ArangoDB (function_runs collection)      |
| S3 artifacts (ADR-001)          | ArangoDB (execution_artifacts collection) |
| pi-ai                           | **Same — unchanged**                     |
| pi-agent-core                   | **Same — unchanged**                     |
| task-routing                    | **Routing config only** (229 LOC)        |
| ArangoDB Oasis                  | **Same — unchanged**                     |
| GitHub Actions CI               | **Same — unchanged**                     |
| AGENTS.md harness loading       | **Same — unchanged**                     |

---

## 12. Security Model (ADR-002 §14, applied)

Container executions enforce:

- No root containers
- No Docker socket access
- Network deny-by-default
- Short-lived GitHub tokens (scoped to repo + branch)
- File scope enforcement (only allowed paths modified)
- Command allowlist (only approved commands)
- Side-effect policy per mode (propose/patch/publish)
- Artifacts are the only output channel
- Secrets redacted from logs

pi-ai executions (in-process) have a simpler security posture:

- No filesystem, git, or shell access
- Write-domain enforcement at the type level (LangGraph channels)
- Tool schemas restrict what each role can produce
- No credential exposure (pi-ai keys in Worker secrets)

---

## 13. Cost Model

### At 50 Functions/month (Steady-State)

| Line item                        | Cost         | Notes                          |
|----------------------------------|--------------|--------------------------------|
| **LLM inference (dominant)**     | ~$95/mo      | pi-ai calls (Haiku default)    |
| **Container compute**            | ~$15/mo      | ~100 container runs × ~5min    |
| CF Workers Paid plan             | $5/mo        | base fee                       |
| CF Workers + DO + Queues         | ~$4/mo       | CPU + requests                 |
| ArangoDB Oasis (starter)         | ~$50/mo      | managed                        |
| **Total**                        | **~$169/mo** |                                |

Container compute is new vs. the pi-ai-only architecture (~$15/mo at 50
Functions). The tradeoff: code that actually compiles, tests that actually
run, PRs that actually open.

### At bootstrap (1-5 Functions/month)

| Line item                        | Cost         |
|----------------------------------|--------------|
| LLM inference                    | ~$10/mo      |
| Container compute                | ~$2/mo       |
| CF Workers Paid                  | $5/mo        |
| CF usage                         | ~$1/mo       |
| ArangoDB (Docker local)          | $0           |
| **Total**                        | **~$18/mo**  |

---

## 14. Migration Path

| Phase | What                              | Value alone                              |
|-------|-----------------------------------|------------------------------------------|
| 0     | Current state                     | Bootstrap continues                      |
| 1     | ArangoDB (local Docker)           | Structured memory, graph queries         |
| 2     | Edge Workers + Gate 1             | API surface, spec queries                |
| 3     | Workflows (Stages 1-5)           | Automated pipeline, approval gates       |
| 4     | Coordinator DO + LangGraph        | Stage 6 topology, pi-ai roles live       |
| 5     | Container execution (ADR-002)     | Coder + Tester delegate to real agents   |
| 6     | Assurance DO + Dream DO + Gate 3   | Monitoring, consolidation, crystallization |

Phase 4 works without Phase 5 — all five roles run via pi-ai (the current
"in-Factory role execution" binding mode). Phase 5 upgrades Coder and
Tester to container delegation. Each phase is independently deployable.
Job ledger and artifact collections are created in Phase 1 (ArangoDB setup)
and populated starting in Phase 5.

---

## 15. Final Principle (adapted from ADR-002 §18)

```
Workers decide.
Workflows orchestrate.
Durable Objects coordinate.
Containers execute.
pi-ai reasons.
LangGraph composes.
Queues decouple.
ArangoDB records truth.
```
