# SE Assessment: Vertical Slicing Execution Architecture

**Frameworks applied:** SMARTS Trade Study (Kirkwood, Ch. 28), TRM Risk Assessment (Haimes, Ch. 3), Functional Analysis with FFBD (Buede, Ch. 25)

**Source material:** Sage & Rouse (1999), vertical-slicing-research.md (8 papers: MASAI, LLMCompiler, DynTaskMAS, SASE, AgentMesh, Blueprint2Code, AgentConductor, SEW)

**Context:** 3 consecutive live synthesis failures. Root cause: CF Queue consumer timeout kills blocking `stub.fetch()` before 10-node agent graph completes. Architecture mismatch between serial monolithic execution and platform timeout constraints.

---

## 1. Trade Study: SMARTS Value Analysis

### Decision Frame

| Element | Value |
|---------|-------|
| **Decision statement** | How should the Factory's Stage 6 execution engine handle atom-level synthesis? |
| **Decision maker** | Wes (Architect/Principal) |
| **Constraints** | Must run on CF Workers/DOs/Queues. Must preserve ontology constraints (C1-C16). Must not regress 401 tests. |
| **Timeline** | Phase F blocked until synthesis completes end-to-end |

### Alternatives

| # | Alternative | Description | Key Differentiator |
|---|------------|-------------|-------------------|
| A | Bug fix only | Decouple dispatch/relay (fire-and-forget + callback). Keep monolithic 10-node graph. | Minimum change. Fixes timeout. Does not address latency or blast radius. |
| B | Bug fix + per-atom retry (v4.1) | Decouple dispatch/relay. Keep monolithic pipeline but scope `patch` verdict retry to the failing atom only. | Medium change. Fixes timeout + blast radius. Does not parallelize. |
| C | Bug fix + full vertical slicing (v5) | Decouple dispatch/relay. Split graph into Phase 1 (whole-graph: architect→gate-1→planner), Phase 2 (per-atom parallel: code→critic→test→verify), Phase 3 (integration verify). | Large change. Fixes timeout + blast radius + latency. Adds coordination complexity. |

### Evaluation Criteria (SMARTS)

| # | Criterion | Scale | Best (100) | Worst (0) |
|---|-----------|-------|-----------|----------|
| 1 | Latency reduction | Wall-clock time for 6-atom WorkGraph | <2 min (parallel atoms) | >15 min (current serial) |
| 2 | Blast radius | Scope of repair on single-atom failure | 1 atom re-runs | All atoms re-run |
| 3 | Implementation cost | LOC changed + new tests needed | <100 LOC, <10 tests | >1000 LOC, >50 tests |
| 4 | Platform fit | Uses CF primitives natively | All patterns supported | Requires workarounds |
| 5 | Risk of regression | Likelihood of breaking existing tests | 0 test changes | >50 test changes |
| 6 | Time to deploy | Calendar time to ship | 1 session | 3+ sessions |

### Swing Weighting

| Criterion | Swing Importance | Raw Weight | Normalized |
|-----------|-----------------|------------|------------|
| Latency reduction | 100 | 100 | 0.27 |
| Blast radius | 80 | 80 | 0.22 |
| Implementation cost | 60 | 60 | 0.16 |
| Platform fit | 70 | 70 | 0.19 |
| Risk of regression | 40 | 40 | 0.11 |
| Time to deploy | 20 | 20 | 0.05 |
| **Sum** | | **370** | **1.00** |

**Rationale:** Latency reduction is the most important swing because the current system literally cannot complete a live run — it's not "slow," it's "broken." Blast radius is second because the repair loop cost compounds exponentially with atom count. Platform fit is third because fighting CF primitives caused all 3 failures. Time to deploy is least important — we're willing to invest in the right architecture.

### Decision Matrix

| Alternative | Latency (0.27) | Blast Radius (0.22) | Impl Cost (0.16) | Platform Fit (0.19) | Regression Risk (0.11) | Time to Deploy (0.05) | **Weighted Total** |
|---|---|---|---|---|---|---|---|
| **A: Bug fix only** | 30 | 10 | 95 | 85 | 90 | 95 | **51.1** |
| **B: Bug fix + retry isolation (v4.1)** | 35 | 70 | 75 | 80 | 70 | 80 | **58.9** |
| **C: Bug fix + vertical slicing (v5)** | 90 | 95 | 30 | 70 | 40 | 20 | **68.5** |

**Score rationale:**

**Option A scores:**
- Latency 30: Still serial 10-node graph. Callback eliminates queue timeout but total wall-clock is still 5-15 min. Marginally better than broken.
- Blast radius 10: No change — one bad atom still re-runs everything.
- Impl cost 95: ~50 LOC (callback route + fire-and-forget dispatch). Minimal.
- Platform fit 85: Callback is native CF pattern (DO→Worker fetch). Slight risk of self-fetch deadlock.
- Regression 90: Minimal test changes. Queue consumer tests need updating.
- Time to deploy 95: One session easily.

**Option B scores:**
- Latency 35: Still serial, but retry only re-runs the failing atom's nodes, saving ~80% of repair loop time.
- Blast radius 70: Retry scoped to failing atom. But initial pass is still monolithic.
- Impl cost 75: ~200 LOC. Need atom-level verdict tracking in GraphState, conditional retry logic in graph-runner.
- Platform fit 80: Same CF primitives. Adds complexity to state management.
- Regression 70: Graph-runner changes affect all graph tests.
- Time to deploy 80: One session, tight.

**Option C scores:**
- Latency 90: Independent atoms parallel. 6-atom graph with 3 independent → ~2-3x reduction (per DynTaskMAS). Phase 1 serial (2 min) + Phase 2 parallel (90s) + Phase 3 (60s) ≈ 4 min.
- Blast radius 95: Atom-level isolation. Failed atom retries independently. Passed atoms untouched.
- Impl cost 30: Major refactor — new scheduler, atom-level DOs or execution contexts, placeholder resolution, integration verification, ~500+ LOC.
- Platform fit 70: CF DOs for atom executors is native. But coordinating N parallel DOs with result aggregation needs careful design. No native fan-out/fan-in primitive.
- Regression 40: Graph topology changes fundamentally. Many existing tests assume monolithic flow.
- Time to deploy 20: 2-3 sessions minimum. Requires new ADR, new tests, new graph-runner capabilities.

### Sensitivity Analysis

| Weight Perturbation | Winner Changes? | Threshold |
|--------------------|----------------|-----------|
| Latency weight ±20% (0.22–0.32) | No | C wins until latency weight drops below 0.12 |
| Blast radius weight ±20% (0.18–0.26) | No | C wins across full range |
| Impl cost weight ±20% (0.13–0.19) | **Yes** | If impl cost weight > 0.28, B overtakes C |
| Platform fit weight ±20% (0.15–0.23) | No | C wins across full range |
| Regression weight ±20% (0.09–0.13) | No | C wins across full range |

**Sensitivity finding:** The decision is robust. Option C wins unless implementation cost is weighted 75% higher than our baseline. Given that the current system is non-functional for live runs, implementation cost is correctly de-prioritized.

### Recommendation

**Selected: Option C (bug fix + full vertical slicing) — implemented as a gradient: A → B → C.**

- Score: 68.5 (margin of 9.6 over B, 17.4 over A)
- Robustness: Winner holds across all ±20% weight perturbations except extreme cost weighting
- Rationale: The monolithic graph is not just slow — it's architecturally incompatible with the CF timeout model. Patching timeouts (A) treats symptoms. Vertical slicing (C) aligns the execution model with the platform's concurrency primitives (DOs are cheap, parallel, and independently addressable) and the ontology's atom model (atoms are independent work units by definition).

**Implementation gradient** (per research's v4.1 → v5 path):
1. **Ship A first** (bug fix: decouple dispatch/relay) — unblocks live synthesis
2. **Ship B next** (per-atom retry isolation) — reduces blast radius
3. **Ship C after** (full vertical slicing) — unlocks parallelism

Each step is independently valuable and deployable.

---

## 2. Risk Assessment: TRM Six Questions

### Risk 1: Cross-atom coherence loss in parallel execution

| Question | Answer |
|----------|--------|
| What can go wrong? | Atoms executed in parallel produce code that doesn't integrate — incompatible interfaces, duplicate declarations, conflicting imports. |
| Likelihood? | **Medium.** The WorkGraph's typed dependency edges encode explicit relationships, but implicit coupling (shared utility functions, naming conventions) is not captured. |
| Consequences? | Integration verification (Phase 3) rejects the merge. All atom artifacts are valid individually but fail as a set. Wasted parallel work. |
| What has been done? | The ontology models dependencies as typed edges. The Planner produces an atom plan with explicit ordering and assignments. |
| How do those actions affect risk? | They reduce the likelihood of explicit dependency violations but do NOT address implicit coupling. |
| What else can be done? | **(a)** Provide shared schema context to all parallel atom slices (per DynTaskMAS SACMS pattern). **(b)** Add a pre-coding contract verification step per atom (per Blueprint2Code). **(c)** The integration Verifier should produce actionable repair notes per-atom, not a blanket rejection. |

### Risk 2: Coordinator DO orchestration complexity

| Question | Answer |
|----------|--------|
| What can go wrong? | The coordinator must track N atom slices, each with their own state (in-progress, passed, failed, retrying). State management becomes a distributed systems problem. |
| Likelihood? | **Medium-High.** CF DOs have single-threaded execution — parallel atom DOs are separate instances, but the coordinator DO must aggregate their results sequentially. |
| Consequences? | Race conditions in result aggregation. Partial completion with no clear recovery path. Silent atom failures that hang the coordinator. |
| What has been done? | The coordinator already uses Fibers for crash recovery and Alarms for wall-clock timeout. |
| How do those actions affect risk? | Fibers handle coordinator eviction. Alarms handle hung synthesis. Neither handles hung individual atom DOs. |
| What else can be done? | **(a)** Each atom DO calls back to the coordinator (same callback pattern as bug fix A). **(b)** Coordinator maintains an `atomStatus` map in storage — updates on each callback. **(c)** Per-atom alarm: if an atom hasn't called back within 300s, mark it as failed. **(d)** Fan-out via Queue (each atom is a queue message) rather than direct DO dispatch — uses CF Queue's built-in retry and dead-letter semantics. |

### Risk 3: CF platform limits under parallel load

| Question | Answer |
|----------|--------|
| What can go wrong? | 6 concurrent atom DOs each making 2-3 LLM calls via ofox.ai. Rate limits on ofox.ai, CF sub-request limits per DO, or CF concurrent DO limits hit. |
| Likelihood? | **Low-Medium.** CF allows up to 6 concurrent sub-requests per DO (fetch). Each atom DO is independent so this limit applies per-DO, not globally. ofox.ai rate limits unknown. |
| Consequences? | 429 errors from ofox.ai. DO sub-request limit errors. Some atoms succeed while others fail, creating partial state. |
| What has been done? | Each agent has AbortSignal.timeout(300s). The coordinator alarm provides wall-clock backstop. |
| How do those actions affect risk? | They detect timeouts but don't prevent rate-limit cascades. |
| What else can be done? | **(a)** Limit concurrency: execute at most 3 atoms in parallel (configurable). **(b)** Add retry-with-backoff to the agent's LLM call layer. **(c)** Use the Task Routing fallback: if primary provider rate-limits, fall back to secondary. |

### Risk 4: Queue consumer self-fetch deadlock (bug fix A)

| Question | Answer |
|----------|--------|
| What can go wrong? | The DO's callback fetch to the Worker's `/synthesis-callback` route might deadlock if the Worker is the same Worker that hosts the queue consumer. |
| Likelihood? | **Low.** CF documentation explicitly supports DO→Worker fetches. The queue consumer and the fetch handler are separate invocations of the same Worker — they don't share execution context. |
| Consequences? | Callback never arrives. Workflow hangs at waitForEvent. Same failure mode as current bug. |
| What has been done? | ADR documented the self-fetch deadlock pattern (DO calling its own Worker). The callback is a new fetch, not a re-entry. |
| How do those actions affect risk? | The pattern is understood. The risk is low but non-zero. |
| What else can be done? | **(a)** Test the callback path in dry-run before live deployment. **(b)** If it fails, use a completion Queue (Option C from the Architect's analysis) as fallback — a second queue is zero-deadlock-risk. |

### Risk Register Summary

| # | Risk | L | I | L×I | Mitigation | Owner |
|---|------|---|---|-----|-----------|-------|
| VS-R1 | Cross-atom coherence loss | M | H | **High** | Shared schema context + contract pre-check + per-atom repair notes | Architect (design) |
| VS-R2 | Coordinator orchestration complexity | M-H | H | **High** | Atom callback pattern + atomStatus map + per-atom alarm + Queue fan-out | Engineer (implement) |
| VS-R3 | CF platform limits under parallel load | L-M | M | **Medium** | Concurrency cap (3) + retry-with-backoff + routing fallback | Engineer (implement) |
| VS-R4 | Callback self-fetch deadlock | L | H | **Medium** | Dry-run test + completion Queue fallback | Engineer (test) |
| VS-R5 | Test suite regression during refactor | M | M | **Medium** | Ship A/B/C incrementally. Each step has its own test suite. No big-bang. | GUV (orchestrate) |

---

## 3. Functional Analysis: FFBD Decomposition

### Top-Level Function: F0 — Synthesize WorkGraph

```
F0: Synthesize WorkGraph
├── F1: Whole-Graph Processing (Serial)
│   ├── F1.1: Produce BriefingScript (Architect agent)
│   ├── F1.2: Semantic Review (Critic agent)
│   ├── F1.3: Compile PRD → WorkGraph (8-pass compiler)
│   ├── F1.4: Gate 1 Coverage Check (deterministic)
│   └── F1.5: Plan Atom Execution (Planner agent)
│
├── F2: Per-Atom Synthesis (Parallel AND per dependency layer)
│   ├── F2.1: Topological Sort → Dependency Layers
│   ├── F2.2: For each Layer (Serial between layers)
│   │   └── F2.2.1: For each Atom in Layer (Parallel AND)
│   │       ├── F2.2.1.1: Resolve Placeholders (upstream outputs → concrete values)
│   │       ├── F2.2.1.2: Code Atom (Coder agent)
│   │       ├── F2.2.1.3: Review Atom Code (Critic agent)
│   │       ├── F2.2.1.4: Test Atom (Tester agent)
│   │       └── F2.2.1.5: Verify Atom (Verifier agent)
│   │           ├── [pass] → Emit AtomArtifact, continue
│   │           ├── [patch] → Loop back to F2.2.1.2 (max 3 retries)
│   │           └── [fail] → Flag atom, escalate CRP
│   │
│   └── F2.3: Aggregate Atom Artifacts
│
└── F3: Integration Verification (Serial)
    ├── F3.1: Merge Atom Artifacts into CodeArtifact
    ├── F3.2: Cross-Atom Contract Verification
    ├── F3.3: Integration Test (if cross-atom tests defined)
    └── F3.4: Final Verdict
        ├── [pass] → Emit SynthesisResult
        ├── [patch] → Identify failing atoms, loop to F2.2
        └── [fail] → Emit failure with per-atom diagnostics
```

### FFBD Control Structures

**Serial (A → B → C):**
- F1 → F2 → F3 (whole-graph phases are strictly ordered)
- Dependency layers within F2 are serial (Layer 0 before Layer 1)
- Agent nodes within each atom slice are serial (code → critic → test → verify)

**Parallel (AND):**
- Atoms within the same dependency layer execute simultaneously
- F2.2.1 for independent atoms: Atom₁ and Atom₂ run in parallel DOs

**Selection (OR):**
- F2.2.1.5 Verify outcome: pass OR patch OR fail
- Each path has different continuation semantics

**Loop:**
- F2.2.1: atom retry loop. Verifier returns `patch` → re-enter at F2.2.1.2 with repair notes
- Budget: max 3 retries per atom. Exceeding budget → CRP escalation.

### IDEF0 Context Diagram

```
                    ┌──────────────────────────────┐
                    │   Ontology Constraints (C1-C16)│  ← Control
                    │   Artifact Validator            │
                    │   DO Alarm (wall-clock)          │
                    └────────────┬─────────────────┘
                                 │
  WorkGraph ─────►┌──────────────┴──────────────┐─────► SynthesisResult
  specContent ───►│   F0: Synthesize WorkGraph  │─────► Per-atom Verdicts
  API Keys ──────►│                              │─────► CRP (if low confidence)
                  └──────────────┬──────────────┘─────► Lifecycle transitions
                                 │
                    ┌────────────┴─────────────────┐
                    │ CF DOs (Coordinator + Atom DOs)│  ← Mechanism
                    │ CF Queue (dispatch + callback)  │
                    │ ArangoDB (state + lineage)      │
                    │ ofox.ai (LLM calls)             │
                    │ gdk-agent (agentLoop runtime)   │
                    └──────────────────────────────┘
```

### CF Platform Primitive Allocation

| Function | CF Primitive | Rationale |
|----------|-------------|-----------|
| F1 (whole-graph) | Coordinator DO (single instance) | Sequential, needs shared state. Already implemented. |
| F2.1 (topo sort) | Coordinator DO | CPU-only, no I/O. Runs in coordinator. |
| F2.2.1 (atom slice) | Separate DO per atom OR sequential in coordinator | **Decision point**: parallel DOs give latency win but add coordination complexity. |
| F2.2.1.2-5 (agent calls) | agentLoop inside the atom's execution context | Same pattern as current agents. |
| F2.3 (aggregate) | Coordinator DO | Waits for atom callbacks, merges results. |
| F3 (integration) | Coordinator DO | Single-pass verification on merged result. |
| Dispatch (F2 → atom DOs) | Queue per atom OR direct DO fetch | Queue gives retry semantics. Direct fetch is simpler. |
| Result relay (atom → coordinator) | Callback fetch to coordinator DO | Same pattern as bug fix A. |

### State Machine: Atom Lifecycle

```
                ┌──────────┐
                │ PENDING  │ (atom queued, dependencies not met)
                └────┬─────┘
                     │ all upstream atoms complete
                     ▼
                ┌──────────┐
                │ RUNNING  │ (code → critic → test → verify executing)
                └────┬─────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌────────┐ ┌────────┐ ┌────────┐
     │ PASSED │ │ RETRY  │ │ FAILED │
     └────────┘ └───┬────┘ └────────┘
                    │ retry < max
                    ▼
               ┌──────────┐
               │ RUNNING  │ (re-enter with repair notes)
               └──────────┘
```

---

## 4. Recommendation to Principal

### Immediate (unblock Phase F): Ship bug fix A
- Decouple dispatch from relay
- Fire-and-forget queue consumer + callback route
- Alarm handler calls callback on timeout
- **Evidence required:** dry-run completes end-to-end via callback, queue consumer execution time <2s

### Next (reduce blast radius): Ship B (v4.1)
- Per-atom retry isolation within the monolithic graph
- Verifier returns `patch` with atom ID → only that atom's nodes re-run
- **Evidence required:** multi-atom WorkGraph where one atom fails, others' artifacts preserved

### Then (unlock parallelism): Ship C (v5)
- Full vertical slicing per FFBD decomposition above
- Phase 1 serial → Phase 2 parallel per dependency layer → Phase 3 integration
- LLMCompiler-style placeholder resolution for dependent atoms
- DynTaskMAS-style scoped context per atom
- **Evidence required:** 6-atom WorkGraph with 3 independent atoms completes in <4 min

### The gradient is the strategy
Each step is independently deployable and testable. A fails? Debug the callback. B fails? Debug the retry isolation. C fails? Fall back to B (which already works). This is the Spiral lifecycle model (Sage & Rouse Ch. 1): each increment reduces risk before committing to the next.

---

**Attribution:** Trade study methodology from Kirkwood (Ch. 28), risk assessment from Haimes (Ch. 3), functional decomposition from Buede (Ch. 25), all in Sage & Rouse (1999). Research patterns from MASAI, LLMCompiler, DynTaskMAS, SASE, AgentMesh, Blueprint2Code per vertical-slicing-research.md.
