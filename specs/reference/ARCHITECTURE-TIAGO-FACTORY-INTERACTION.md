# Architecture: TIAGO / Factory Interaction

> How the Governor (Claude Code on Wes's laptop) interacts with the
> autonomous Factory (Cloudflare infrastructure).

---

## 1. The Two Systems

There are exactly two systems. They run in completely different places
and do completely different things.

```
+---------------------------------------------------------------+
|                     Wes's MacBook                              |
|                                                                |
|  +----------------------------------------------------------+ |
|  |  TIAGO  (Claude Code CLI in Terminal)                     | |
|  |                                                           | |
|  |  - Reads/writes local files in ~/Developer/function-factory|
|  |  - Runs git, gh, vitest, bun, wrangler                    | |
|  |  - Deploys code TO Cloudflare via `wrangler deploy`       | |
|  |  - Triggers pipelines via `curl POST`                     | |
|  |  - Reads results via `curl GET`                           | |
|  |  - Creates GitHub PRs via `gh` CLI                        | |
|  |                                                           | |
|  |  TIAGO is the GOVERNOR. Proposes, orchestrates, reviews.  | |
|  |  TIAGO does NOT run inside Cloudflare.                    | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
         |                                          ^
         | curl POST /pipeline                      | curl GET /pipeline/:id
         | curl POST /approve/:id                   | curl GET /specs/...
         | wrangler deploy (pushes code)            | curl GET /health
         v                                          |
+---------------------------------------------------------------+
|                   Cloudflare Edge                              |
|                                                                |
|  +----------------------------------------------------------+ |
|  |  THE FACTORY  (Workers, Workflows, DOs, Queues, AI)       | |
|  |                                                           | |
|  |  - Receives signals via HTTP                              | |
|  |  - Runs multi-stage pipeline AUTONOMOUSLY                 | |
|  |  - Calls LLMs (kimi-k2.6 via Workers AI REST)            | |
|  |  - Stores artifacts in ArangoDB (Oasis cloud)             | |
|  |  - Creates GitHub PRs via GitHub REST API                 | |
|  |  - Generates feedback signals (self-improvement loop)     | |
|  |  - Curates memory (learns from outcomes)                  | |
|  |                                                           | |
|  |  The Factory runs WITHOUT TIAGO after being triggered.    | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
         |
         | ArangoDB HTTP API
         v
+---------------------------------------------------------------+
|              ArangoDB Oasis (Cloud)                            |
|                                                                |
|  specs_signals, specs_pressures, specs_capabilities,          |
|  specs_functions, specs_workgraphs, specs_coverage_reports,   |
|  execution_artifacts, lineage_edges, gate_status,             |
|  memory_episodic, memory_semantic, orl_telemetry,             |
|  mentorscript_rules, hot_config, completion_ledgers           |
+---------------------------------------------------------------+
```

---

## 2. What TIAGO Does (Local Machine)

TIAGO is Claude Code running in Wes's terminal. Everything TIAGO does
happens on Wes's laptop or via outbound HTTP calls.

### Development Actions
- **Writes TypeScript** to the repo (`~/Developer/function-factory/`)
- **Runs tests** via `vitest` or `bun test` (local execution)
- **Deploys** via `wrangler deploy` (pushes bundled JS to Cloudflare)
- **Sets secrets** via `wrangler secret put ARANGO_JWT` etc.
- **Creates PRs** via `gh pr create` (GitHub CLI)

### Factory Interaction (HTTP Only)
- **Triggers a pipeline:** `curl -X POST https://ff-gateway.koales.workers.dev/pipeline -d '{"signal": {...}}'`
- **Approves a pipeline:** `curl -X POST https://ff-gateway.koales.workers.dev/approve/{id} -d '{"decision":"approved"}'`
- **Reads pipeline status:** `curl https://ff-gateway.koales.workers.dev/pipeline/{id}`
- **Reads specs/artifacts:** `curl https://ff-gateway.koales.workers.dev/specs/{collection}/{key}`
- **Reads lineage:** `curl https://ff-gateway.koales.workers.dev/lineage/{collection}/{key}`
- **Checks health:** `curl https://ff-gateway.koales.workers.dev/health`

### What TIAGO Cannot Do
- **See Worker logs.** `wrangler tail` fails because `wrangler.jsonc` has
  a `containers` field that wrangler's parser chokes on.
- **Call Durable Objects directly.** DOs are internal to the Worker; no
  public route.
- **Inspect Queue messages.** Queues are internal CF infrastructure.
- **Step through pipeline execution.** Once triggered, the Factory runs
  autonomously.

---

## 3. What the Factory Does (Cloudflare)

### Cloudflare Components

| Component | Type | Purpose |
|-----------|------|---------|
| `ff-gateway` | Worker | Public HTTP API. Single entry point for all external requests. |
| `ff-pipeline` | Worker | Pipeline execution engine. Hosts the Workflow, DOs, and queue consumers. |
| `ff-gates` | Worker | Gate evaluation (Service Binding, not public). |
| `FactoryPipeline` | Workflow | Multi-stage orchestration with durable state and event-driven pauses. |
| `SynthesisCoordinator` | Durable Object | Phase 1 planning: architect, critic, planner agents. Dispatches atoms. |
| `AtomExecutor` | Durable Object | Per-atom execution: 4-node pipeline (Coder, Critic, Tester, Verifier). |
| `Sandbox` | Durable Object + Container | Code execution sandbox (Dockerfile-based). |
| `synthesis-queue` | Queue | Dispatches synthesis work and atom-execute messages. |
| `synthesis-results` | Queue | DO completion results relayed back to the Workflow. |
| `atom-results` | Queue | Per-atom completion results for ledger tracking. |
| `feedback-signals` | Queue | Post-synthesis feedback, PR generation, memory curation. |

### Service Binding Topology

```
  ff-gateway
    |-- PIPELINE (Workflow binding) --> ff-pipeline::FactoryPipeline
    |-- GATES (Service Binding) ------> ff-gates::GatesService
    |-- QUERY (Service Binding) ------> ff-gateway::QueryService (self)

  ff-pipeline
    |-- GATES (Service Binding) ------> ff-gates::GatesService
    |-- FACTORY_PIPELINE (Workflow) --> ff-pipeline::FactoryPipeline
    |-- COORDINATOR (DO) ------------> SynthesisCoordinator
    |-- ATOM_EXECUTOR (DO) ----------> AtomExecutor
    |-- SANDBOX (DO) ----------------> Sandbox (Container)
    |-- AI (Workers AI) -------------> @cf/meta/llama-3.3-70b-instruct-fp8-fast
    |-- SYNTHESIS_QUEUE (Queue) -----> synthesis-queue
    |-- SYNTHESIS_RESULTS (Queue) ---> synthesis-results
    |-- ATOM_RESULTS (Queue) --------> atom-results
    |-- FEEDBACK_QUEUE (Queue) ------> feedback-signals
```

---

## 4. Full Execution Flow

When TIAGO sends `POST /pipeline`, this is everything that happens:

```
TIAGO (Wes's laptop)
  |
  |  curl -X POST https://ff-gateway.koales.workers.dev/pipeline \
  |    -d '{"signal": {"signalType":"internal","source":"tiago",...}}'
  |
  v
[1] ff-gateway Worker (Cloudflare edge)
  |  Receives HTTP POST /pipeline
  |  Validates: body must have "signal" field
  |  env.PIPELINE.create({ params: { signal, dryRun } })
  |  Returns 201: { instanceId, statusUrl, approveUrl }
  |
  v
[2] FactoryPipeline Workflow (Cloudflare Workflow runtime)
  |  Durable, resumable. Each step.do() is an atomic checkpoint.
  |  If the Worker is evicted, the Workflow resumes from the last checkpoint.
  |
  |-- step.do('ingest-signal')
  |     Write signal to ArangoDB specs_signals collection.
  |     Return signal with _key.
  |
  |-- step.do('synthesize-pressure')
  |     LLM call (Workers AI, llama-70b): signal -> Pressure artifact.
  |     Write to ArangoDB specs_pressures.
  |
  |-- step.do('edge-pressure-signal')
  |     Write lineage edge: Pressure -> Signal.
  |
  |-- step.do('map-capability')
  |     LLM call: Pressure -> Capability artifact.
  |     Write to ArangoDB specs_capabilities.
  |
  |-- step.do('edge-capability-pressure')
  |     Write lineage edge: Capability -> Pressure.
  |
  |-- step.do('propose-function')
  |     LLM call: Capability -> Function proposal + PRD.
  |     Write to ArangoDB specs_functions.
  |
  |-- step.do('edge-proposal-capability')
  |     Write lineage edge: Proposal -> Capability.
  |
  |-- step.do('lifecycle-proposed')
  |     Set function lifecycle state to "proposed".
  |
  |-- step.waitForEvent('architect-approval')           <-- PAUSE
  |     |
  |     |  The Workflow SLEEPS here (up to 7 days).
  |     |  Nothing happens until TIAGO sends:
  |     |
  |     |  curl -X POST .../approve/{id} -d '{"decision":"approved"}'
  |     |
  |     |  OR: if signal.raw.autoApprove === true (feedback retry),
  |     |      the gate is skipped automatically.
  |     |
  |     v
  |
  |-- step.do('semantic-review')
  |     LLM call: Critic reviews the proposal for alignment.
  |     Miscast = advisory warning (logged, not blocking).
  |
  |-- step.do('compile-{pass}') x 8 passes
  |     Eight sequential LLM compilation passes:
  |       structure, invariants, detectors, atoms,
  |       dependencies, test-strategy, acceptance, workgraph
  |     Each pass refines the PRD into a WorkGraph.
  |     Write WorkGraph to ArangoDB specs_workgraphs.
  |
  |-- step.do('lifecycle-designed')
  |     Set function lifecycle state to "designed".
  |
  |-- step.do('gate-1')
  |     Service Binding call to ff-gates Worker.
  |     Deterministic structural check: does the WorkGraph have
  |     lineage, atoms, dependencies, test strategy?
  |     If FAIL: enqueue feedback signal, return early.
  |
  |-- step.do('enqueue-synthesis')
  |     Push message to SYNTHESIS_QUEUE:
  |       { workflowId, workGraphId, workGraph, dryRun }
  |
  |-- step.do('lifecycle-in-progress')
  |     Set function lifecycle state to "in_progress".
  |
  |-- step.waitForEvent('synthesis-complete')            <-- PAUSE
  |     |
  |     |  The Workflow SLEEPS here (up to 30 minutes).
  |     |  Meanwhile, the queue consumer dispatches to the DO...
  |     |
  |     v
  |
  |  [If verdict.decision === 'dispatched':]
  |
  |-- step.waitForEvent('atoms-complete')                <-- PAUSE
  |     |
  |     |  The Workflow SLEEPS again (up to 30 minutes).
  |     |  Meanwhile, individual atoms execute in parallel...
  |     |
  |     v
  |
  |-- step.do('edge-synthesis-workgraph')
  |     Write lineage edge: execution -> WorkGraph.
  |
  |-- step.do('lifecycle-implemented')  [if pass]
  |     Set function lifecycle state to "implemented".
  |
  |-- step.do('enqueue-feedback')
  |     Push final result to FEEDBACK_QUEUE.
  |
  |-- return PipelineResult
       { status, signalId, pressureId, capabilityId,
         proposalId, workGraphId, gate1Report,
         synthesisResult, atomResults }
```

### Synthesis (Phase 1 + 2 + 3): The Queue/DO Dance

The Workflow cannot talk directly to Durable Objects during `step.do()`.
Cloudflare's architecture requires an intermediate hop via Queues.

```
[A] SYNTHESIS_QUEUE consumer (ff-pipeline queue() handler)
    |
    |  Receives message: { workflowId, workGraphId, workGraph }
    |  Creates DO stub: env.COORDINATOR.idFromName('synth-{wgKey}')
    |  Calls DO.fetch('https://do/synthesize', { workGraph })
    |  Acks message immediately (fire-and-forget to DO).
    |
    v
[B] SynthesisCoordinator DO
    |
    |  Phase 1: Serial planning graph (5 nodes)
    |    1. ArchitectAgent    -> BriefingScript (kimi-k2.6 REST API)
    |    2. CriticAgent       -> SemanticReview
    |    3. CoderAgent stub   -> CompileStub
    |    4. Gate 1 stub       -> structural check
    |    5. PlannerAgent      -> Plan with atoms + layers
    |
    |  Phase 2: Dispatch atoms to SYNTHESIS_QUEUE
    |    - Topological sort: atoms into dependency layers
    |    - Create completion ledger in ArangoDB
    |    - Dispatch Layer 0 atoms as 'atom-execute' messages
    |    - Return verdict: { decision: 'dispatched' }
    |    - Coordinator EXITS. Does not wait for atoms.
    |
    |  Publishes to SYNTHESIS_RESULTS queue:
    |    { type: 'phase1-complete', atomCount, layerCount }
    |
    v
[C] SYNTHESIS_QUEUE consumer (handles 'atom-execute' messages)
    |
    |  For each atom-execute message:
    |    Creates DO stub: env.ATOM_EXECUTOR.idFromName('atom-{wgKey}-{atomId}')
    |    Calls DO.fetch('https://do/execute-atom', { atomSpec, sharedContext })
    |
    v
[D] AtomExecutor DO (one per atom, runs independently)
    |
    |  Pre-flight: verify API key exists for resolved model.
    |  Set 900s alarm (wall-clock timeout).
    |
    |  4-node pipeline:
    |    1. CoderAgent    -> code artifact (files + summary)
    |    2. CriticAgent   -> code review (issues, compliance)
    |    3. TesterAgent   -> test report (pass/fail/failures)
    |    4. VerifierAgent  -> final verdict (pass/fail + confidence)
    |
    |  Each agent:
    |    agentLoop() -> kimi-k2.6 via Workers AI REST API
    |    -> processAgentOutput() (ORL: observe-repair-learn)
    |
    |  Stores result in DO storage (idempotency).
    |  Publishes to ATOM_RESULTS queue:
    |    { workGraphId, atomId, result, workflowId }
    |
    v
[E] ATOM_RESULTS queue consumer (ff-pipeline queue() handler)
    |
    |  recordAtomResult() -> ArangoDB atomic UPSERT into completion ledger.
    |  getReadyAtoms() -> check if dependent atoms are now unblocked.
    |    If yes: dispatch next-layer atoms to SYNTHESIS_QUEUE.
    |
    |  isComplete() -> are ALL atoms done?
    |    If yes: Phase 3 verdict.
    |      - Merge code artifacts from all passing atoms.
    |      - Compute pass rate.
    |      - Check critical vs non-critical failures.
    |
    |  Send 'atoms-complete' event to Workflow:
    |    workflow.sendEvent({ type: 'atoms-complete', payload: { verdict, atomResults } })
    |
    v
[F] FactoryPipeline Workflow RESUMES at waitForEvent('atoms-complete')
    |
    v
[G] FEEDBACK_QUEUE consumer
    |
    |  generateFeedbackSignals():
    |    - synthesis:pr-candidate (pass, confidence >= 0.8)
    |    - synthesis:atom-failed (auto-retry)
    |    - synthesis:verdict-fail
    |    - synthesis:low-confidence
    |    - synthesis:orl-degradation
    |    - synthesis:gate1-failed
    |
    |  Loop prevention (3 layers):
    |    L1: feedbackDepth counter, max 3 generations
    |    L2: idempotency hash in ingest-signal
    |    L3: 30-min cooldown per functionId + subtype (AQL query)
    |
    |  extractLessons():
    |    - F1 prose output pattern
    |    - Timeout pattern
    |    - F7 null response pattern
    |    - Partial synthesis pattern
    |    -> UPSERT to memory_semantic collection
    |
    |  For synthesis:pr-candidate signals:
    |    generatePR() via GitHub REST API:
    |      1. GET main branch SHA
    |      2. POST create branch (factory/{proposalId})
    |      3. PUT files from passing atoms
    |      4. POST create draft PR
    |      5. POST apply 'factory-generated' label
    |    Uses Worker's own GITHUB_TOKEN (not TIAGO's).
    |
    |  Enqueue memory-curation message to FEEDBACK_QUEUE.
    |
    v
[H] MemoryCuratorAgent (FEEDBACK_QUEUE consumer, 'memory-curation' type)
    |
    |  curator.curate() -> analyze recent execution data
    |  curator.persist() -> write curated lessons to ArangoDB
    |
    v
[DONE] Pipeline result available via GET /pipeline/{id}
```

---

## 5. The Handoff Boundary

```
TIAGO's world                       Factory's world
(Wes's laptop)                      (Cloudflare)
                                    
 Write code ----+                    
 Run tests      |                    
 Deploy ---------+------> Code lives on Cloudflare
                 |                    
 POST /pipeline --+------> ff-gateway receives signal
                  |          |
 POST /approve/id-+------> Workflow resumes from waitForEvent
                  |          |
                  |        [Everything below is autonomous]
                  |          |
                  |        Stages 1-4: LLM calls, ArangoDB writes
                  |        Gate 1: structural validation
                  |        Synthesis: DO coordination, atom execution
                  |        Feedback: new signals, PR generation
                  |        Memory: lesson extraction, curation
                  |          |
 GET /pipeline/id-+------< Read result AFTER Factory finishes
 GET /specs/...  -+------< Query ArangoDB via gateway
```

**TIAGO's last touch:** `POST /pipeline` or `POST /approve/{id}`.

**Everything after that is autonomous.** The Factory runs its multi-stage
pipeline, calls LLMs, evaluates gates, dispatches atoms, generates PRs,
and curates memory -- all without TIAGO.

**TIAGO reads results AFTER.** The only way TIAGO sees what happened is
by querying the gateway (`GET /pipeline/{id}`, `GET /specs/...`).

**The PR Worker has its own GITHUB_TOKEN.** When the Factory creates a
GitHub PR, it uses `env.GITHUB_TOKEN` (set via `wrangler secret put`).
TIAGO's `gh` CLI and the Factory's GitHub API calls use different tokens
with different permissions.

---

## 6. Why TIAGO Cannot See What Happens Inside

### The Observability Gap

```
+------------------------------------------------------------------+
|  TIAGO can see:                                                   |
|    - Local files, git log, test results                          |
|    - HTTP responses from ff-gateway                              |
|    - ArangoDB data (via gateway /specs/ routes)                  |
|    - GitHub PRs (via gh CLI)                                     |
|                                                                  |
|  TIAGO cannot see:                                               |
|    - Worker console.log() output                                 |
|    - Queue message contents as they flow                         |
|    - Durable Object internal state                               |
|    - Why a queue consumer silently failed                        |
|    - Whether generatePR() was called or threw                    |
|    - Individual agent LLM prompts and responses                  |
+------------------------------------------------------------------+
```

### Why wrangler tail Fails

The file `workers/ff-pipeline/wrangler.jsonc` contains:

```jsonc
"containers": {
  "Sandbox": {
    "image": "./Dockerfile",
    "max_instances": 5
  }
}
```

`wrangler tail` cannot parse the `containers` field. It crashes before
connecting to the log stream. This means TIAGO has no live log access
to the pipeline Worker.

### The Audit Trail Workaround

Because logs are invisible, the pipeline writes diagnostic data to
ArangoDB as a side channel. See `index.ts` line ~448:

```typescript
await db.save('orl_telemetry', {
  schemaName: '_feedback_audit',
  feedbackSignalCount: feedbackSignals.length,
  hasGithubToken: !!env.GITHUB_TOKEN,
  subtypes: feedbackSignals.map(fs => fs.signal.subtype),
  hasAtomResults: !!ctx.result?.atomResults,
  atomResultKeys: ctx.result?.atomResults ? Object.keys(...) : [],
})
```

TIAGO can then query this via:
```
curl https://ff-gateway.koales.workers.dev/specs/orl_telemetry/_feedback_audit
```

This is a workaround, not a solution. The audit writes are best-effort
(`.catch(() => {})`) and only capture what we explicitly instrument.

---

## 7. The Debug Problem (Concrete Example)

### The PR Generation Mystery

**Known fact:** `generatePR()` works. PR #34 was created when called
from a local test context.

**The problem:** When the same function is called inside the
`feedback-signals` queue consumer on Cloudflare, no PR appears.

**Why TIAGO cannot diagnose this:**

```
Queue message arrives at feedback-signals consumer
  |
  v
generateFeedbackSignals() runs
  |  - TIAGO cannot see if any pr-candidate signals were generated
  |  - TIAGO cannot see the feedbackSignals array contents
  |
  v
for loop over feedbackSignals
  |  - TIAGO cannot see which branch of the if-statement was taken
  |  - The condition is:
  |      fs.signal.subtype === 'synthesis:pr-candidate'
  |      && !fs.autoApprove
  |      && env.GITHUB_TOKEN
  |  - TIAGO cannot verify any of these three conditions
  |
  v
generatePR() may or may not be called
  |  - If called, TIAGO cannot see the GitHub API responses
  |  - If it threw, TIAGO cannot see the error message
  |  - The console.error() goes to Worker logs (invisible)
  |
  v
msg.ack() — message is consumed, evidence is gone
```

**The fundamental issue:** TIAGO deployed a system that runs
autonomously but has no way to observe its internal state. The Governor
cannot govern what it cannot see.

---

## 8. What Should Change

### Option A: Fix wrangler tail

Remove or restructure the `containers` field in `wrangler.jsonc` so
`wrangler tail --name ff-pipeline` works again. This gives TIAGO live
streaming access to all `console.log()` and `console.error()` output.

**Pros:** Immediate visibility. No code changes needed.
**Cons:** Real-time only. TIAGO must be watching when the event occurs.

### Option B: Structured Logging to ArangoDB

Expand the audit trail pattern. Write structured diagnostic entries to
ArangoDB at every decision point in the queue consumers.

```typescript
// Example: instrument the PR generation path
await db.save('pipeline_audit', {
  stage: 'feedback-pr-check',
  workGraphId,
  signalCount: feedbackSignals.length,
  prCandidateFound: hasPrCandidate,
  githubTokenPresent: !!env.GITHUB_TOKEN,
  autoApprove: fs.autoApprove,
  prResult: result,  // { success, prUrl, error, filesWritten }
  timestamp: new Date().toISOString(),
})
```

**Pros:** Persistent. TIAGO can query after the fact.
**Cons:** Must instrument every code path. Adds ArangoDB write latency.

### Option C: Debug Endpoint

Add a `/debug/feedback-status` route to ff-pipeline (or ff-gateway) that
returns recent feedback processing results from ArangoDB.

```
GET /debug/feedback-status?workGraphId=WG-xxx

{
  "feedbackSignals": [...],
  "prAttempts": [...],
  "memoryCuration": [...],
  "lastProcessed": "2026-04-29T..."
}
```

**Pros:** On-demand. Does not require live tailing.
**Cons:** Requires both the audit writes (Option B) and a new route.

### Recommendation

**Do all three.** They are complementary:

1. **Fix wrangler tail** for live debugging during development.
2. **Structured audit logging** for post-hoc diagnosis of autonomous runs.
3. **Debug endpoint** for quick Governor queries without raw AQL.

The Factory should be observable WITHOUT needing to tail logs. The
autonomous system must produce enough diagnostic output that the
Governor can understand what happened, when it happened, and why.

---

## Appendix: Key File Paths

| File | Purpose |
|------|---------|
| `workers/ff-gateway/src/index.ts` | Public HTTP API, route dispatch |
| `workers/ff-gateway/src/env.ts` | Gateway environment bindings |
| `workers/ff-gateway/wrangler.jsonc` | Gateway infra config (Workflow + Service bindings) |
| `workers/ff-pipeline/src/index.ts` | Pipeline Worker: fetch handler + 4 queue consumers |
| `workers/ff-pipeline/src/pipeline.ts` | FactoryPipeline Workflow (stages 1-6 + feedback) |
| `workers/ff-pipeline/src/coordinator/coordinator.ts` | SynthesisCoordinator DO (Phase 1 + atom dispatch) |
| `workers/ff-pipeline/src/coordinator/atom-executor-do.ts` | AtomExecutor DO (per-atom 4-node pipeline) |
| `workers/ff-pipeline/src/stages/generate-feedback.ts` | Feedback signal generation + loop prevention |
| `workers/ff-pipeline/src/stages/generate-pr.ts` | GitHub PR creation via REST API |
| `workers/ff-pipeline/wrangler.jsonc` | Pipeline infra config (DOs, Queues, Containers) |
| `workers/ff-gates/src/index.ts` | Gate evaluation (Service Binding) |
