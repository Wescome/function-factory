# SE Review: DESIGN-CONDUCTOR-DO

> Systems Engineering Review per Sage & Rouse (1999)
> Supplemented by Bahill & Dean (Requirements Verification), TRM (Risk Assessment),
> Levis (Architecture Fitness), and Trade Study methodology.
>
> Reviewer: Architect Agent (Systems Engineer role)
> Date: 2026-04-29
> Inputs:
>   - DESIGN-CONDUCTOR-DO.md (v1.0)
>   - coordinator.ts (SynthesisCoordinator -- reference implementation)
>   - graph-runner.ts (existing StateGraph engine)
>   - graph.ts (buildSynthesisGraph -- topology construction)
>   - state.ts (GraphState -- current typed state)
>   - DESIGN-GOVERNOR-AGENT.md (upstream consumer)
>   - SE-GAP-ANALYSIS-TIAGO-GOVERNOR.md (architectural context)

---

## Executive Summary

The ConductorDO design is architecturally sound in intent but premature in
timing and over-scoped in abstraction. The SynthesisCoordinator works in
production. It has exactly one consumer (the FactoryPipeline Workflow).
The GovernorAgent design -- the only identified future consumer of a
generalized orchestrator -- is itself unimplemented.

The design solves a real problem (adding new workflow types without new DO
classes) but solves it before the problem manifests. The first non-synthesis
workflow (GovernorAgent Phase 3 diagnostic delegation) is at least two
implementation phases away. Building the generalized engine now means
paying the abstraction cost (debugging opacity, adapter complexity,
condition evaluator surface area) before any non-synthesis topology
exercises the code.

**Recommendation: Option C (Thin Orchestration Layer).** Extract the
reusable pieces from SynthesisCoordinator into shared utilities without
replacing the working implementation. Build ConductorDO only when the
second concrete workflow type is ready for implementation.

---

## 1. Requirements Verification (Bahill & Dean Ch. 4)

### 1.1 WorkSpec Schema (Section 4)

| Field | Necessary? | Verifiable? | Unambiguous? | Complete? | Consistent? | Traceable? | Achievable? |
|-------|-----------|------------|-------------|----------|------------|-----------|------------|
| `id` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `label` | Marginal -- only for telemetry | Yes | Yes | Yes | Yes | No traceability upstream | Yes |
| `type` | **ISSUE** | Yes | **No** -- "custom" is a catch-all that defeats type-safety | No -- what does "analysis" topology look like? Only "synthesis" has a concrete preset | Yes | Partial | Yes |
| `intent` | Marginal -- included in agent prompts but how? | Yes | **No** -- "Included in agent context prompts" but the mechanism is unspecified | No | Yes | No | Yes |
| `topology` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `context` | Yes | **No** -- `Record<string, unknown>` is unverifiable at compile time | **No** -- runtime type contract between topology node inputs and context keys is implicit | No | Yes | No | Yes |
| `governance` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `sourceRefs` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `resultQueue` | Yes | Yes | Yes | Yes | Yes | No | Yes |
| `workflowId` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

**Critical findings:**

1. **`context: Record<string, unknown>` is the central type-safety hole.** The
   existing SynthesisCoordinator has a typed `GraphState` with 25+ named
   fields. Errors like "I passed `workgraph` but the node expects `workGraph`"
   are caught at compile time. With `ConductorState.outputs`, this becomes a
   runtime debugging problem. The design acknowledges this (Risk 1) but
   under-estimates the impact. Every node's `inputs` array is a string-based
   contract with no schema enforcement. This is not a naming convention
   problem -- it is a category error: replacing compile-time type safety
   with runtime string matching.

2. **`WorkSpecType` includes types with no preset topology.** "refactor",
   "analysis", and "custom" have no defined presets. If `topology` is null
   and `type` is "refactor", `resolvePresetTopology` returns null and the
   entire execution silently fails. The failure path returns an empty
   `ConductorResult` with status "failed" and no error message explaining
   that the preset does not exist. This violates fail-fast principles.

3. **`intent` is underspecified.** "Included in agent context prompts" --
   where? The `AgentCapability.execute()` interface takes `AgentExecutionOpts`
   which has `contextPrompt?: string`. But `intent` is a WorkSpec-level
   field and `contextPrompt` is a node-level field (`TopologyNode.contextPromptFragment`).
   These are different things. How does `intent` reach agents? The design
   does not say.

### 1.2 GraphTopology Schema (Section 5)

| Requirement | Assessment |
|-------------|-----------|
| Nodes represent agent invocations | **Incomplete.** Pseudo-agents (budget-check, compile, gate-1) are registered as agents but are not agent invocations. They are deterministic functions masquerading as agents. The registry conflates two categories. |
| Edges represent dependencies | Yes |
| Parallel groups are consistent with edges | Yes, validated |
| Conditional edges support safe evaluation | Yes, well-designed |
| Topology is validated before execution | Yes, comprehensive |

**Critical finding: pseudo-agents break the abstraction.**

The SynthesisCoordinator has `budget-check`, `compile`, and `gate-1` as
inline node functions in `graph.ts`. They are pure functions that examine
state and return partial state updates. They do not call LLMs. They do
not consume tokens. They do not have retry semantics.

The ConductorDO design registers these as `AgentCapability` implementations:
```typescript
registry.register({
  role: 'budget-check',
  create: () => new BudgetCheckNode(),
})
```

This forces three pure functions into the agent abstraction:
- They must implement `AgentCapability.execute()` and return `AgentResult`
  with `tokenUsage: 0` and `durationMs: ~0`.
- They participate in retry logic (`maxRetriesPerNode`) despite being
  deterministic (retrying a deterministic function produces the same result).
- They appear in `nodeHistory` telemetry alongside real agent invocations,
  polluting cost and duration metrics.
- They need `AgentFactoryDeps` (ArangoClient, HotConfig, AgentContext)
  despite using none of them.

The existing `StateGraph` handles this cleanly: nodes are functions, not
agents. Some nodes call LLMs, some do not. The graph does not care.

### 1.3 AgentRegistry (Section 6)

| Requirement | Assessment |
|-------------|-----------|
| Decouple agent resolution from topology | Yes |
| Support runtime discovery | No -- registry is populated at worker startup and is immutable |
| Prevent duplicate registration | Yes |
| Fail fast on missing agent | Yes |

**Finding: the adapter pattern adds complexity without solving a stated problem.**

The design proposes adapters (e.g., `ArchitectAgentAdapter`) to wrap
existing agents in the `AgentCapability` interface. The
`ArchitectAgentAdapter` is 20 lines of boilerplate that:
1. Extracts `input.workGraph` from the generic `Record<string, unknown>`
2. Calls `ArchitectAgent.produceBriefingScript()`
3. Wraps the result in `AgentResult`

This is the same work that `graph.ts` line 77-89 does today, but with
an additional indirection layer. The existing code directly calls
`deps.architectAgent.produceBriefingScript(input)` with typed input.
The adapter receives `Record<string, unknown>` and must unsafely cast.

Each adapter is a hand-written type bridge from untyped to typed,
doing at runtime what the compiler does at compile time today.

### 1.4 ConductorState (Section 7)

| Requirement | Assessment |
|-------------|-----------|
| Track accumulated node outputs | Yes |
| Track execution metadata | Yes |
| Serializable to DO storage | **Issue** -- `Set<string>` requires ser/deser helpers |
| Generic across workflow types | Yes |
| Debuggable | **Degraded** -- named fields replaced with generic map |

**Finding: `Set<string>` in a serializable state is a design smell.**

The design uses `Set<string>` for `completedNodes`, `activeNodes`, and
`failedNodes`, then documents that serialization requires conversion
helpers. This is an unnecessary complexity source. Arrays with uniqueness
maintained by the engine would serialize naturally and avoid the
serialize/deserialize ceremony.

### 1.5 Execution Engine (Section 8)

| Requirement | Assessment |
|-------------|-----------|
| Layer-based execution | Yes |
| Parallel group execution | Yes |
| Per-node retry with backoff | **Issue** -- backoff comment says "setTimeout in DOs is unreliable" and suggests "busy-wait or accept that backoff may be shorter than specified." This is not a retry strategy. |
| Conditional edge evaluation | Yes |
| Budget enforcement | Yes |
| Timeout enforcement | Yes (alarm) |
| State checkpointing | Yes |

**Critical finding: the backoff implementation is a known non-solution.**

The design's own comment on retry backoff (Appendix B, line in `executeNode`):
```
// Note: setTimeout in DOs is unreliable (frozen during I/O suspension).
// Use a simple busy-wait or accept that backoff may be shorter than
// specified.
```

This acknowledges the CF platform constraint (DOs freeze setTimeout during
I/O) but proposes no solution. A busy-wait in a V8 isolate blocks the
event loop. "Accept shorter backoff" means no backoff. The existing
SynthesisCoordinator does not need backoff because it does not retry
individual nodes -- the verifier routes back to budget-check for the
entire graph. The ConductorDO introduces per-node retry as a requirement
but cannot implement it on the platform.

### 1.6 Missing Requirements

1. **No dryRun support in WorkSpec.** The SynthesisCoordinator accepts
   `dryRun: boolean` and uses a dry-run model bridge. The WorkSpec has
   no `dryRun` field. The design comment says "WorkSpec-level dryRun
   would be in governance" -- but it is not in `GovernanceConfig`. This
   means behavioral equivalence testing (Phase 1 acceptance criteria)
   requires adding a field not in the current schema.

2. **No repair loop.** The SynthesisCoordinator's verifier can return
   `patch` or `resample`, which routes back to `budget-check` via
   conditional edge, creating a repair loop. The synthesis preset
   topology (Section 10.1) is Phase 1 only (architect through planner)
   and has no verifier, so this is not a problem for the preset. But
   the design claims to be a generalized orchestrator. A topology with
   a repair loop requires cycles in the graph. Section 5.1 says
   "Run cycle detection on the directed graph" as a validation error.
   The risk section (15, Risk 2) acknowledges this: "topology validation
   detects cycles and warns (but does not block, because repair loops
   are intentional cycles with termination conditions)." This
   contradicts the validation table which lists cycle detection as an
   error (`TOPOLOGY_CYCLE`). The design is internally inconsistent
   on whether cycles are allowed.

3. **No CRP auto-generation.** The SynthesisCoordinator generates
   Confidence Review Proposals (CRPs) when verdict confidence is below
   0.7 (coordinator.ts lines 654-678). The ConductorDO design mentions
   "CRP auto-generation" in Appendix A ("Post-execution hook in queue
   consumer -- Moved out of DO") but the queue consumer code in Section
   18.3 does not include CRP generation. This is a regression in
   capability.

4. **No Phase 2 atom dispatch equivalent.** The design acknowledges
   this: "Phase 2 (atom dispatch) does NOT move into the ConductorDO."
   But the queue consumer code for handling synthesis results (Section
   18.3) forwards to the existing Workflow via `sendEvent`, which
   expects a `SynthesisResult` format, not a `ConductorResult`. The
   format bridge is not designed.

---

## 2. Risk Assessment (TRM Six Questions)

### Risk A: Premature Generalization

**What can go wrong?** The ConductorDO is built before any non-synthesis
workflow exists. The abstractions are designed against hypothetical
topologies (review, diagnostic, evaluation) that have never been
exercised. When real non-synthesis workflows arrive, they may require
capabilities the abstraction did not anticipate, forcing either:
(a) modifications to the generic engine, or (b) workarounds that defeat
the purpose of generalization.

**Likelihood:** HIGH. This is the most common failure mode of generic
frameworks: the second real use case invalidates assumptions made from
the first use case.

**Consequences:** MEDIUM-HIGH. The team is left maintaining two systems
(ConductorDO for synthesis, something else for the workflow that does
not fit) or refactoring the ConductorDO under production pressure.

**What's been done?** The design includes preset topologies for review,
diagnostic, and evaluation workflows. These serve as thought experiments
but have no consumers and no tests against real inputs.

**How effective?** LOW. Preset topologies for hypothetical workflows
validate that the schema can express the topology, not that the
execution engine handles the workflow correctly. The hard bugs are in
input/output type mismatches, retry semantics, and conditional edge
evaluation -- none of which are tested by schema validation alone.

**What else?** Build the second workflow first (as a concrete
implementation) and extract shared patterns afterward. This is the
"rule of three" for abstraction: one instance teaches you the problem,
two instances teach you the pattern, three instances justify the
framework.

### Risk B: Debugging Regression

**What can go wrong?** A synthesis run fails. Today, the developer reads
`GraphState.plan`, `GraphState.code`, `GraphState.critique`, etc. --
all typed fields with IDE autocomplete and compile-time access. With
ConductorDO, the developer reads `ConductorState.outputs.plan` which
is `unknown`, requiring unsafe casts to inspect.

**Likelihood:** CERTAIN. Every synthesis debugging session uses typed
state access.

**Consequences:** MEDIUM. Debugging time increases. Errors that would
be compile-time become runtime. The telemetry shows `nodeHistory` with
agent roles and durations, but the actual data requires knowing output
key names and expected shapes.

**What's been done?** Preset topologies use the same output key names as
GraphState fields. NodeHistory provides per-node telemetry.

**How effective?** PARTIAL. Naming continuity helps but does not restore
type safety. The compiler cannot tell you that `outputs.plan` is a
`Plan` type -- you must know this from the topology definition.

**What else?** Consider typed WorkSpec variants (e.g.,
`SynthesisWorkSpec extends WorkSpec` with typed `context` and typed
terminal outputs). This preserves the generic engine while adding
type safety for known workflow types.

### Risk C: Adapter Correctness

**What can go wrong?** An adapter incorrectly maps between the generic
`Record<string, unknown>` interface and the agent's typed interface.
For example, `ArchitectAgentAdapter` extracts `input.workGraph` -- but
the synthesis topology node declares `inputs: ['workGraph', 'specContent']`.
If the upstream node stores its output under a different key, the
adapter receives undefined. This is a silent failure that produces
wrong agent behavior.

**Likelihood:** MEDIUM-HIGH during initial implementation. The existing
code has typed interfaces (`PlannerInput`, `CoderInput`, `TesterInput`)
that enforce input contracts at compile time. Adapters replace compile-
time enforcement with runtime key-matching.

**Consequences:** HIGH. Wrong inputs produce wrong outputs. In
synthesis, this means wrong plans, wrong code, wrong tests, wrong
verdicts. The failure is not "crash" -- it is "plausible but incorrect
output" which is harder to detect.

**What's been done?** Phase 1 acceptance criteria include behavioral
equivalence testing. Adapters are thin (10-20 lines).

**How effective?** MEDIUM. Behavioral equivalence testing catches
adapter bugs during initial implementation but not during future
evolution. When someone modifies an agent's interface, they must also
update the adapter -- but the compiler will not remind them because
the adapter's input type is `Record<string, unknown>`.

**What else?** If building ConductorDO, define typed adapter input
schemas as Zod objects co-located with each agent. The adapter validates
input at runtime against the schema before calling the agent. This
adds a few lines per adapter but catches input-shape errors early.

### Risk D: Migration Period Complexity

**What can go wrong?** During Phase 1, both SynthesisCoordinator and
ConductorDO are deployed. The SynthesisCoordinator runs in "shadow mode."
Both DO classes are exported, both consume Worker memory, both are
registered in wrangler.jsonc. Queue consumers must route to both.
Telemetry shows results from both, requiring disambiguation.

**Likelihood:** CERTAIN (this is the stated migration plan).

**Consequences:** MEDIUM. Operational complexity doubles during
migration. If behavioral equivalence testing reveals differences,
debugging requires comparing two different execution engines with
different state representations.

**What's been done?** Migration is described as additive. Shadow mode
preserves the existing path.

**How effective?** ADEQUATE for safety (existing code still works).
POOR for simplicity (two systems doing the same thing).

**What else?** If Option C (thin orchestration layer) is chosen,
migration period is eliminated because SynthesisCoordinator is not
replaced.

### Risk E: Condition Evaluator as Attack/Complexity Surface

**What can go wrong?** The condition evaluator parses string expressions
against state. While the evaluator is safe (no eval, no code execution),
it introduces a mini-language that must be learned, documented, and
debugged. Condition strings like
`"semanticReview.alignment !== 'miscast'"` are not type-checked, not
IDE-supported, and not refactoring-safe.

**Likelihood:** LOW for security (safe parser). MEDIUM for correctness
(typos in condition strings produce false evaluations that terminate
execution silently).

**Consequences:** MEDIUM. A typo in a condition string
(`"semanticReivew.alignment"` instead of `"semanticReview.alignment"`)
causes the condition to evaluate to `undefined !== 'miscast'` = `true`,
which would proceed when it should have blocked. This is a silent
correctness bug.

**What's been done?** Topology validation checks condition syntax but
cannot validate that the path references a real output key (because
outputs are populated at runtime).

**How effective?** PARTIAL. Syntax validation catches parse errors but
not semantic errors (wrong key names, wrong value comparisons).

**What else?** The existing graph-runner.ts uses function-based
conditional routing (`addConditionalEdge(from, routerFn)`). Functions
are type-checked, IDE-supported, and refactoring-safe. The condition
string approach is strictly worse for all properties except
serializability. If topologies need to be serialized (e.g., stored in
ArangoDB), the string approach makes sense. If topologies are defined
in TypeScript code (which all preset topologies are), functions are
superior.

---

## 3. Architecture Fitness (Levis Ch. 12)

### 3.1 Separation Between Topology Spec and Execution Engine

**Assessment: Clean in theory, leaky in practice.**

The design separates topology definition (`GraphTopology`) from execution
(`ConductorEngine`). This is the right architectural pattern. However:

- The topology references agent roles by string. The engine resolves
  strings to factories. The connection between a topology node's
  `agentRole: 'architect'` and the `ArchitectAgentAdapter` class is
  maintained by convention, not by type system.
- Node input/output names are strings. The connection between a node's
  `output: 'briefingScript'` and a downstream node's
  `inputs: ['briefingScript']` is maintained by naming convention, not
  by type system.
- Condition expressions reference output key names by string. See Risk E.

The existing graph.ts uses the type system for all three: agent
references are function closures (typed), state fields are TypeScript
interface members (typed), and conditional routing is function-based
(typed). The ConductorDO trades type safety for serializability.

**Verdict: The separation is clean but the cost is high. This trade-off
is only justified if topologies must be serialized and transmitted
(e.g., GovernorAgent Phase 3 constructing topologies dynamically). For
preset topologies defined in TypeScript, the trade-off loses value.**

### 3.2 Does WorkSpec Capture Everything SynthesisCoordinator Does?

**No. Several SynthesisCoordinator capabilities are not mapped.**

| Capability | SynthesisCoordinator | WorkSpec/ConductorDO | Gap |
|-----------|---------------------|---------------------|-----|
| Dry-run mode | `dryRun: boolean` parameter | Not in WorkSpec schema | **MISSING** |
| Repair loop (verifier -> budget-check -> planner -> coder -> ...) | Conditional edge from verifier to budget-check | Synthesis preset has no verifier. Cycle detection would flag this. Design is internally inconsistent on cycles. | **INCONSISTENT** |
| Phase 2 atom dispatch | Inline in coordinator.ts (topologicalSort, createLedger, SYNTHESIS_QUEUE) | "External: queue consumer reads ConductorResult.plan" | **FORMAT BRIDGE MISSING** |
| CRP auto-generation on low confidence | Inline in persistSynthesisResult | "Post-execution hook in queue consumer" but not in the queue consumer code | **MISSING** |
| Sandbox deps (3-tier fallback) | buildSandboxDeps() with SANDBOX binding detection | "Agent adapters handle sandbox" -- but AgentCapability has no sandbox interface | **UNSPECIFIED** |
| Mentor rules fetch | fetchMentorRules() called by critic and buildRoleMessage | Not mentioned in ConductorDO design | **MISSING** |
| Execution artifacts persistence (code, tests, synthesis_summary) | persistSynthesisResult writes 3 execution_artifacts | ConductorDO.persistTelemetry writes orl_telemetry + memory_episodic only | **REGRESSION** |
| WorkflowId propagation for Phase 2 dispatch | Stored in DO storage, read during Phase 2 | In WorkSpec.workflowId but queue consumer format bridge is undefined | **PARTIAL** |
| Budget-check first-pass vs repair routing | `if (!state.briefingScript) return 'architect'` -- distinguishes first pass from repair | Synthesis preset has no repair loop, so N/A for preset | **NOT APPLICABLE (but see cycle issue)** |

The SynthesisCoordinator does 7 things beyond "run a graph of agents."
The ConductorDO design accounts for 3 of them (crash recovery, timeout,
queue notification). The other 4 (dry-run, CRP generation, execution
artifact persistence, mentor rules) are either missing or deferred to
unspecified queue consumer hooks.

### 3.3 Is the Agent Registry the Right Abstraction?

**It is over-engineering for the current state, appropriate for the
stated future.**

Today, the Factory has 6 agents + 3 pseudo-agents, all defined in the
same TypeScript package (`workers/ff-pipeline/src/agents/`). They are
imported directly. There is no plugin system, no dynamic loading, no
multi-package agent discovery.

The registry adds value when:
- Agents come from different packages or services (not today)
- Agents are discovered at runtime (not today)
- The same role can be served by multiple implementations (not today)
- Tests need to substitute mock agents (achievable today with
  `GraphDeps` dependency injection, which already does this)

The existing `GraphDeps` interface in `graph.ts` is already a dependency
injection mechanism. Each agent is injected as an interface:
```typescript
architectAgent?: { produceBriefingScript: (...) => Promise<BriefingScript> }
plannerAgent?: { producePlan: (...) => Promise<Plan> }
```

This is typed, testable, and does not require a registry. The registry
replaces typed DI with string-keyed DI, which is strictly weaker for
type safety and no better for testability.

**Verdict: The registry is justified only if agents will be discovered
dynamically (Phase 3+ of the evolution path). For Phase 1, it adds
complexity without benefit.**

---

## 4. Trade Study: Generalize vs Specialize

### Option A: Build ConductorDO (Full Generalization)

As designed in DESIGN-CONDUCTOR-DO.md.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Implementation effort | HIGH (2-3 days stated, likely 4-6 with adapter debugging and behavioral equivalence) | 9 adapters, engine, registry, validator, evaluator, presets, tests |
| Debugging complexity | DEGRADED | Typed -> untyped state. Function-based routing -> string conditions. |
| Extensibility | HIGH | New workflows = new topology + agents. No new DO classes. |
| Migration risk | MEDIUM-HIGH | Parallel deployment period. Format bridges needed. Shadow mode complexity. |
| Time to value | NEGATIVE for 2-3 months | Replaces working code with equivalent code. First non-synthesis value arrives with GovernorAgent Phase 3. |

### Option B: Keep SynthesisCoordinator + Add Specialized DOs

Keep `SynthesisCoordinator` unchanged. When GovernorAgent Phase 3 needs
diagnostic orchestration, build `DiagnosticCoordinator` as a new DO with
its own typed state and topology.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Implementation effort | LOW (for now), MEDIUM (per new DO type) | No work now. Each future DO is ~200 lines if it follows the established pattern. |
| Debugging complexity | BEST | Typed state per workflow type. IDE support. Compile-time safety. |
| Extensibility | LOW | Each new workflow = new DO class. Linear cost growth. |
| Migration risk | ZERO | No changes to working code. |
| Time to value | BEST (for now) | No wasted effort on unused abstraction. |

This option becomes expensive at N > 3 workflow types if they share
substantial infrastructure (crash recovery, timeout, telemetry). At
N = 2 (synthesis + diagnostic), the cost is lower than building the
generic engine.

### Option C: Thin Orchestration Layer (Recommended)

Extract shared infrastructure from SynthesisCoordinator into reusable
utilities. SynthesisCoordinator imports these utilities. Future DOs also
import them. No generic engine. No registry. No adapters.

Extract:
1. **Fiber/alarm patterns** -- `withFiber(name, fn)` and
   `withAlarmTimeout(ms)` as utility functions.
2. **Telemetry writing** -- `persistOrlTelemetry(db, schema, stats)` and
   `persistEpisodicMemory(db, entry)`.
3. **Queue publishing** -- `publishToQueue(queue, payload)` with error
   handling.
4. **Condition evaluation** -- if needed for future topologies (probably
   not needed yet; keep function-based routing).
5. **CRP generation** -- `maybeCreateCRP(db, verdict, context)`.

Do NOT extract:
- Agent instantiation (keep direct, typed injection)
- State management (keep typed per-DO)
- Graph topology (keep function-based `StateGraph` per workflow)
- Agent registry (not needed until dynamic discovery is required)

| Criterion | Score | Notes |
|-----------|-------|-------|
| Implementation effort | LOW (2-4 hours) | Extract 5 utility functions. No new abstractions. |
| Debugging complexity | BEST | Typed state preserved. Function-based routing preserved. IDE support preserved. |
| Extensibility | MEDIUM | New workflow = new DO class + shared utilities. More code per workflow than Option A, less than Option B (shared utilities eliminate boilerplate). |
| Migration risk | ZERO | SynthesisCoordinator unchanged. Utilities are additive. |
| Time to value | BEST | Shared utilities are immediately useful. No wasted work on unused generic engine. |

**Option C becomes Option A when justified.** When the third workflow
type is built and the pattern is proven, the shared utilities naturally
grow into the ConductorDO engine. But the abstraction is driven by
concrete requirements, not hypothetical ones.

### Trade Study Verdict

```
                    Effort  Debug  Extend  Risk  TimeToValue  TOTAL
Option A (full)       2       2      5      2       1          12
Option B (per-DO)     5       5      2      5       5          22
Option C (extract)    5       5      4      5       5          24
```

(5 = best, 1 = worst)

**Option C wins.** It preserves every advantage of the current system
while making the shared infrastructure reusable. It does not foreclose
Option A -- when the second or third workflow type proves the pattern,
the utilities can be composed into a generic engine with empirical
evidence about what the engine needs.

---

## 5. Specific Design Issues

### 5.1 Cycles vs DAG Inconsistency

Section 5.1 lists "No cycles" as a topology validation error:
`TOPOLOGY_CYCLE: cycle detected involving nodes [A, B, C]`.

Section 15 (Risk 2) says: "topology validation detects cycles and warns
(but does not block, because repair loops are intentional cycles with
termination conditions)."

These statements contradict. The design must pick one:
- Cycles are errors (pure DAG) -- then repair loops cannot be expressed
  as topologies, and the SynthesisCoordinator's verifier->budget-check
  repair loop has no ConductorDO equivalent.
- Cycles are allowed with termination guards -- then cycle detection
  should be a warning with required `governance.maxSteps` enforcement,
  not an error.

The existing SynthesisCoordinator allows cycles (verifier routes back
to budget-check). If ConductorDO disallows cycles, it cannot replicate
this behavior. If it allows them, the validation table is wrong.

### 5.2 Parallel Execution Correctness

The parallel execution code (Section 8.3) uses `Promise.allSettled` and
then merges results:

```typescript
for (let i = 0; i < results.length; i++) {
  const result = results[i]
  const nodeId = nodeIds[i]
  if (result.status === 'fulfilled') {
    updatedState = mergeNodeResult(updatedState, nodeId, result.value)
  } else {
    updatedState = recordNodeFailure(updatedState, nodeId, result.reason)
  }
}
```

This sequential merge after parallel execution has a subtle correctness
issue: `mergeNodeResult` creates a new state with spread operator. If
two parallel nodes write to the same state fields (e.g., both increment
`tokenUsage`), the second merge overwrites the first's increment. The
design should use atomic aggregation (accumulate token usage in a local
variable, then write once).

The existing SynthesisCoordinator does not have this problem because
it does not run graph nodes in parallel -- parallel execution is
handled by AtomExecutor DOs, each with their own state.

### 5.3 State Checkpoint Frequency

The algorithm (Section 8.1) says "persist state checkpoint to DO storage"
after each layer. But the engine pseudocode (Appendix B) calls
`this.opts.onCheckpoint(state)` inside the serial execution loop but NOT
after parallel execution. If a parallel group of 5 nodes completes but
the DO evicts before the checkpoint, all 5 results are lost.

### 5.4 Entry Point Ambiguity

`GraphTopology.entryPoint` is optional. If not specified, "the first node
with zero in-degree is used." But Section 5.1 validation requires
"Single entry point: Exactly one entry point (explicit or inferred)."

What if there are two nodes with zero in-degree? The evaluation topology
(Section 10.4) has one entry point (`generator`) so this is not a problem
for presets. But for custom topologies, this is an under-specified edge
case.

### 5.5 GovernorAgent Integration Gap

The design describes how GovernorAgent feeds WorkSpecs to ConductorDO
(Section 11). But the GovernorAgent design (DESIGN-GOVERNOR-AGENT.md)
describes the GovernorAgent as a stateless Worker function, not a DO.
The GovernorAgent dispatches pipelines via `env.FACTORY_PIPELINE.create()`.
Adding ConductorDO dispatch requires:
1. A `CONDUCTOR` DO namespace binding in the GovernorAgent's env
2. A routing decision: when does GovernorAgent use FactoryPipeline
   (existing Workflow) vs ConductorDO?
3. ConductorDO instance ID generation (how does the GovernorAgent
   construct the DO stub ID?)

None of this is specified. The GovernorAgent design does not mention
ConductorDO. The ConductorDO design assumes GovernorAgent will dispatch
to it. Neither design specifies the integration contract.

---

## 6. What the Design Gets Right

Despite the above issues, the design demonstrates strong architectural
thinking in several areas:

1. **Crash recovery pattern** is correctly carried forward from
   SynthesisCoordinator. The fiber + alarm + checkpoint pattern is
   proven and the ConductorDO replicates it faithfully.

2. **Event-driven result notification** via queues is correct. The
   queue bridge pattern (DO -> Queue -> Worker) is the canonical CF
   pattern and avoids the DO-to-Worker self-fetch deadlock.

3. **Behavioral equivalence as acceptance criteria** is the right
   migration strategy. Proving identical outputs before switching
   traffic is exactly how production migrations should work.

4. **Ontology classification** (Section 19) is precise. ConductorDO
   is correctly classified as `OrchestrationRuntime` at `L1_Execute`
   autonomy. It does not make decisions. It runs graphs.

5. **The diagnosis of the problem is correct.** SynthesisCoordinator IS
   over-specialized. Adding a second workflow type to it would be messy.
   The question is not whether generalization is needed, but when.

6. **Telemetry design** (Section 13) is well-considered. Per-workflow-
   type ORL schema names (`_conductor_synthesis`, `_conductor_diagnostic`)
   enable type-specific analysis. Episodic memory entries enable
   cross-workflow learning.

7. **The condition evaluator** (Section 8.2) is correctly designed as
   a safe parser with no eval(). The supported operator set is sufficient
   for topology routing decisions.

---

## 7. Recommendations

### R1: Defer ConductorDO until second workflow type is ready for implementation

The GovernorAgent is Phase 1 (cron-only operational triage). Phase 3
(multi-agent diagnostic delegation) is the first GovernorAgent feature
that would use ConductorDO. Phase 3 is at least two implementation
phases away. Building ConductorDO now means maintaining unused generic
infrastructure for months.

**Action:** Implement GovernorAgent Phase 1 and Phase 2 first. When
Phase 3 design begins, revisit ConductorDO with a concrete second
workflow type as input.

### R2: Extract shared utilities from SynthesisCoordinator now (Option C)

The reusable patterns in SynthesisCoordinator are valuable regardless
of ConductorDO:
- Fiber/alarm management utilities
- Telemetry persistence helpers
- Queue publishing with error handling
- CRP generation logic

These can be extracted into `workers/ff-pipeline/src/coordinator/shared/`
without modifying SynthesisCoordinator's behavior.

### R3: If ConductorDO proceeds, resolve the design inconsistencies first

Before implementation:
1. **Decide on cycles:** DAG-only or cycles-with-guards? Update both
   the validation table and the risk section to be consistent.
2. **Add dryRun to WorkSpec or GovernanceConfig.** Cannot achieve
   behavioral equivalence without it.
3. **Specify intent propagation.** How does `WorkSpec.intent` reach
   agents?
4. **Design the Phase 2 format bridge.** ConductorResult.plan must be
   translatable to the format the existing atom dispatch code expects.
5. **Specify CRP generation in the queue consumer.** The Appendix A
   table says "Post-execution hook in queue consumer" but the queue
   consumer code does not include it.
6. **Add typed adapter input schemas.** Each adapter should validate
   its input at runtime against a Zod schema, not unsafely cast from
   `Record<string, unknown>`.

### R4: Separate pseudo-agents from real agents

Budget-check, compile, and gate-1 are deterministic functions, not
agents. They should either:
- Be handled by the engine directly (not through the registry), or
- Be registered in a separate "node" registry distinct from "agent"
  registry

Mixing deterministic functions and LLM agents in the same registry
pollutes telemetry, applies inappropriate retry logic, and violates
the Single Responsibility Principle.

### R5: Consider typed WorkSpec variants for known workflow types

If ConductorDO is built, define:
```typescript
interface SynthesisWorkSpec extends WorkSpec {
  type: 'synthesis'
  context: {
    workGraph: WorkGraphSchema
    specContent: string | null
    tokenUsage: number
    maxTokens: number
    repairCount: number
    maxRepairs: number
  }
}
```

This preserves the generic engine while restoring compile-time type
safety for known workflow types. Custom topologies remain untyped.
Known topologies get full type support.

---

## 8. Verdict

The ConductorDO design is well-reasoned architecture applied at the wrong
time. The diagnosis is correct (SynthesisCoordinator is over-specialized),
the solution shape is sound (parameterized orchestration), and the
execution details are largely well-designed (crash recovery, telemetry,
condition evaluation).

But the design violates a foundational principle from the project's own
DECISIONS.md and AGENTS.md: **"solve actual problems only"** and
**"avoid over-engineering."** The ConductorDO solves a problem that does
not yet exist (need for non-synthesis orchestration) by replacing a system
that works (SynthesisCoordinator) with a system that trades type safety
for flexibility that has no current consumer.

The correct move is Option C: extract the reusable pieces, keep the
working implementation, and revisit generalization when the second
concrete workflow type provides empirical evidence about what the
generic engine actually needs.

---

## Decision Algebra Alignment

```
D = <I, C, P, E, A, X, O, J, T>

I (Intent)     = Evaluate whether ConductorDO generalization is the right
                 architectural move at this time
C (Context)    = DESIGN-CONDUCTOR-DO v1.0, SynthesisCoordinator (working
                 production code), GovernorAgent (unimplemented), gap analysis
P (Policy)     = SE methodology (Sage & Rouse), "solve actual problems only"
                 (AGENTS.md), "quality over speed" (MEMORY.md),
                 "avoid over-engineering" (ArchitectContext.md)
E (Evidence)   = 7 missing/inconsistent requirements, 5 high-likelihood risks,
                 SynthesisCoordinator has 7 capabilities not mapped to
                 ConductorDO, zero current consumers for non-synthesis topologies
A (Authority)  = Architect Agent (SE role), pending Wes's gate
X (Action)     = Recommend Option C (thin extraction), defer ConductorDO
O (Outcome)    = Reusable utilities without replacing working code,
                 ConductorDO deferred to when justified by concrete demand
J (Justification) = Premature generalization trades proven type safety for
                 hypothetical flexibility. The second workflow type should
                 drive the engine design, not precede it.
T (Time)       = 2026-04-29, bootstrap phase, pre-implementation review
```

---

*This review was produced by the Architect Agent in the Systems Engineer
role. All findings reference specific sections of the design document
and specific lines of the existing implementation. No speculative claims.
Every recommendation traces to identified evidence.*
