# Self-Correcting Software Synthesis via Closed-Loop Signal Feedback

**Wesley Maddox**

Function Factory Project, 2026

---

## Abstract

Multi-agent architectures for automated software synthesis have advanced rapidly, with systems such as MASAI, LLMCompiler, DynTaskMAS, and Blueprint2Code demonstrating that decomposition into specialized sub-agents can achieve competitive performance on established benchmarks. However, all existing architectures share a structural limitation: they are open-loop. When synthesis fails---whether due to compilation errors, test failures, or verification rejection---the system halts and awaits human intervention. We present the Function Factory, a closed-loop software synthesis system in which synthesis failures are classified into a typed signal taxonomy and automatically re-injected into the compilation pipeline as new inputs. The system employs three independent loop-prevention mechanisms (depth counter, content-hash deduplication, and temporal cooldown) to guarantee termination, and an Orientation Ontology that transforms repeated failure patterns into curated knowledge accessible to all downstream agents. We describe the architecture in detail---including atom-level vertical slicing, a seven-class Output Reliability Layer, and a formal learning subsystem---and report on production runs demonstrating autonomous code synthesis with self-generated feedback signals. The contribution is architectural: we identify the specific engineering requirements for closing the feedback loop in multi-agent synthesis and provide an implemented reference system.

---

## 1. Introduction

The application of large language models (LLMs) to automated software engineering has progressed from single-model code completion to sophisticated multi-agent systems that decompose, plan, implement, test, and verify code changes. MASAI (Arora et al., 2024) demonstrated that modular sub-agents with defined information flows outperform monolithic reasoning chains. LLMCompiler (Kim et al., 2024) showed that DAG-based parallel execution can reduce latency by up to 3.7x while improving accuracy. DynTaskMAS (Yu et al., 2025) extended these ideas with asynchronous parallel execution and semantic-aware context management. SASE (Hassan et al., 2025) provided a process-level framework for structuring human-agent collaboration. AgentMesh (Khanzadeh, 2025) and Blueprint2Code (Mao et al., 2025) validated multi-stage pipelines with planning, coding, testing, and review phases.

Despite these advances, all existing architectures share a limitation that has received insufficient attention: they are open-loop systems. The information flow is unidirectional: intent enters the system, passes through decomposition and synthesis stages, and a verdict emerges. When that verdict is negative---when synthesis fails, tests do not pass, or the verifier rejects the output---the system stops. The failure is logged, perhaps reported to a human operator, and the pipeline terminates. There is no mechanism by which the failure itself becomes input to the next cycle of synthesis.

This limitation is not incidental. Closing the loop in a multi-agent synthesis system requires solving several interrelated problems: (a) failures must be classified into typed categories that carry enough information to guide re-synthesis, (b) the system must generate structured signals from failure data that are compatible with the pipeline's input format, (c) the loop must be provably bounded to prevent infinite re-execution, and (d) governance rules must distinguish between failures that warrant automatic retry and failures that require human judgment.

We present the Function Factory, a system that addresses all four requirements. The Factory is a seven-stage intent compilation pipeline deployed on Cloudflare Workers, backed by an ArangoDB graph database for lineage tracking. Its distinguishing architectural contribution is a feedback loop in which synthesis results---whether pass or fail---generate typed signals that re-enter the pipeline as first-class inputs. The system has been operational in production, generating 23+ self-generated feedback signals and completing autonomous synthesis runs with 0.95 confidence scores.

---

## 2. Related Work

We survey six multi-agent software synthesis architectures and identify where each system's information flow terminates.

### 2.1 MASAI (Arora et al., 2024)

MASAI decomposes software engineering tasks into sub-problems and delegates each to a specialized sub-agent (Test Template Generator, Issue Reproducer, Fault Localizer, Patch Generator, Patch Verifier). Each sub-agent has a defined input/output specification and can employ a different problem-solving strategy. MASAI achieved 28.33% resolution on SWE-bench Lite at under $2 per issue, demonstrating that modular decomposition is cost-competitive with monolithic approaches.

MASAI's information flow is, however, single-shot. The sub-agents execute in a defined order, each receiving the output of its predecessor. If the Patch Verifier rejects a patch, the system does not re-invoke the Fault Localizer with new information derived from the failed patch. The failure is terminal. The sub-agent decomposition is excellent; the feedback architecture is absent.

### 2.2 LLMCompiler (Kim et al., 2024)

LLMCompiler draws from classical compiler theory to parallelize LLM function calls. A Function Calling Planner generates a DAG of tasks with inter-dependencies. A Task Fetching Unit dispatches ready tasks, replacing placeholder variables with outputs from completed upstream tasks. An Executor runs tasks in parallel. The system achieves up to 3.7x latency reduction and 6.7x cost savings.

LLMCompiler's DAG execution model is directly applicable to parallel synthesis (and the Function Factory adopts it for atom-level dispatch). However, LLMCompiler operates within a single execution cycle. There is no mechanism for a failed task to generate a new DAG entry or to modify the execution plan for a subsequent run. The parallelism is within-run; there is no cross-run feedback.

### 2.3 DynTaskMAS (Yu et al., 2025)

DynTaskMAS extends DAG-based multi-agent execution with four components: a Dynamic Task Graph Generator for recursive decomposition, an Asynchronous Parallel Execution Engine demonstrating near-linear throughput scaling, a Semantic-Aware Context Management System for hierarchical context sharing, and an Adaptive Workflow Manager for runtime adjustment. The system demonstrated 21-33% execution time reduction across task complexities.

The Adaptive Workflow Manager provides dynamic adjustment within a single execution, but DynTaskMAS does not formalize cross-execution learning. The SACMS provides context scoping (critical for avoiding context dilution in parallel agents), but context does not accumulate across runs. Each execution starts from the same baseline.

### 2.4 SASE (Hassan et al., 2025)

SASE provides a conceptual framework for structuring agentic software engineering, proposing a dual-modality approach: "SE for Humans" and "SE for Agents." Key principles include adaptable over universal processes, onboardability over brilliance, and incremental trust calibration. SASE validates the atom as a natural trust boundary and emphasizes that agent trust should be earned per-task, not blanket-granted.

SASE is a process framework rather than an implemented system, and does not specify a feedback mechanism. Its contribution is conceptual: it identifies the need for structured agent processes but does not close the loop between synthesis failure and re-synthesis.

### 2.5 AgentMesh (Khanzadeh, 2025)

AgentMesh implements a multi-agent pipeline (Planner, Coder, Debugger, Reviewer) with shared state and acknowledges that "agents could operate in parallel with proper synchronization via the shared state." The architecture explicitly notes the possibility of feedback loops but does not implement them. Error propagation---where failures in upstream agents cascade through the pipeline---is identified as the primary failure mode of sequential multi-agent systems.

### 2.6 Blueprint2Code (Mao et al., 2025)

Blueprint2Code introduces a two-phase approach: blueprint planning (generating a structural plan before code) and repair (iterating on failed implementations). The repair mechanism operates within a single execution run: if code generation fails validation, the system re-invokes the code generator with error context. This is the closest existing system to closed-loop synthesis, but the loop is bounded to a single run. A failure in Run N does not generate a signal that starts Run N+1 with accumulated knowledge from the failure.

### 2.7 Summary

All six systems implement some form of decomposition and specialization. None implements cross-run feedback where synthesis failures become typed inputs to subsequent pipeline executions. The gap is not in capability but in architecture: no system treats failure as a first-class signal type that re-enters the pipeline.

---

## 3. Architecture

The Function Factory is deployed as a set of Cloudflare Workers and Durable Objects, backed by ArangoDB Oasis for persistent state and lineage tracking. The system processes intents through a seven-stage compilation pipeline, executes synthesis via atom-level vertical slicing, and closes the loop through typed feedback signals.

### 3.1 Intent Compilation Pipeline

The pipeline transforms external or internal signals into executable code through seven stages:

1. **Signal Ingestion** (`ingest-signal`): Raw signals enter the system with a type, source, and payload. Signals are deduplicated via content hash to prevent identical signals from triggering redundant pipeline runs.

2. **Pressure Synthesis** (`synthesize-pressure`): The signal is interpreted as a forcing function on the system---a Pressure. The LLM extracts the organizational pressure implied by the signal and produces a structured Pressure artifact.

3. **Capability Mapping** (`map-capability`): The Pressure is mapped to one or more Business Capabilities that must exist or be enhanced to respond to the pressure.

4. **Function Proposal** (`propose-function`): Each capability is decomposed into concrete Function proposals---specifications of what code must be written, why, and with what acceptance criteria.

5. **Semantic Review** (`semantic-review`): A Critic agent evaluates whether the Function proposal is aligned with the original signal. This catches "semantic miscast"---proposals that drift from the original intent during the compression of stages 2-4.

6. **PRD Compilation** (`compile`): The proposal is compiled through eight sub-passes into a WorkGraph---a DAG of implementation atoms with typed dependencies, acceptance criteria, and verification rules.

7. **Synthesis Execution**: The WorkGraph is dispatched for atom-level execution (Section 3.2), producing code artifacts, test reports, and verification verdicts.

Each stage persists its output to ArangoDB and records lineage edges connecting the output to its inputs. The full lineage chain---Signal to Pressure to Capability to Proposal to WorkGraph to CodeArtifact---is traversable via graph queries.[^1]

[^1]: Pipeline implementation: `workers/ff-pipeline/src/pipeline.ts`

### 3.2 Vertical Slicing with Atom-Level Parallelism

Following LLMCompiler's DAG execution pattern, the Factory decomposes WorkGraphs into dependency layers using Kahn's algorithm for topological sorting.[^2] Each layer contains atoms with no mutual dependencies; atoms within a layer execute concurrently.

Each atom receives its own Durable Object instance (AtomExecutor), solving the coordinator eviction problem inherent in Cloudflare's execution model.[^3] The AtomExecutor runs a four-node pipeline per atom:

1. **Coder**: Generates code files from the atom specification and upstream artifacts
2. **Critic**: Reviews the generated code against mentor rules and quality criteria
3. **Tester**: Produces and executes tests against the code artifact
4. **Verifier**: Issues a pass/fail/patch verdict with a confidence score

Each AtomExecutor sets a 900-second alarm as a wall-clock deadline. If the atom does not complete within this window, the alarm fires, records an interrupt result, and publishes it to the results queue. This prevents zombie atoms from consuming resources indefinitely.

Coordination is managed through a completion ledger stored in ArangoDB.[^4] The ledger tracks per-atom completion state using atomic AQL updates to prevent race conditions when concurrent atoms complete simultaneously. When an atom completes, the ledger identifies newly-ready atoms (those whose upstream dependencies have all resolved) and dispatches them. When all atoms complete, the ledger transitions to the `complete` phase and triggers Phase 3 (integration verification).

Context scoping follows DynTaskMAS's Semantic-Aware Context Management pattern: each atom receives only its own specification, the shared WorkGraph context, and the concrete outputs of its upstream dependencies. This prevents the context dilution that occurs when all atoms are processed in a single LLM call.

[^2]: Layer dispatch: `workers/ff-pipeline/src/coordinator/layer-dispatch.ts`
[^3]: AtomExecutor Durable Object: `workers/ff-pipeline/src/coordinator/atom-executor-do.ts`
[^4]: Completion ledger: `workers/ff-pipeline/src/coordinator/completion-ledger.ts`

### 3.3 Output Reliability Layer

LLM outputs are inherently unreliable. The Factory's Output Reliability Layer (ORL) classifies unreliability into seven failure classes and processes all agent outputs through a six-stage pipeline.[^5]

**Failure taxonomy:**

| Class | Description | Example |
|-------|-------------|---------|
| F1 | Prose instead of JSON | Model ignores format instructions and produces narrative text |
| F2 | Truncated JSON | Output exceeds token limit mid-object |
| F3 | Wrong field names | Model uses `reasoning` instead of `rationale` |
| F4 | Wrong field types | String `"true"` instead of boolean `true` |
| F5 | JSON in markdown fences | Output wrapped in ````json` code blocks |
| F6 | Tool calls as text | Model writes tool invocation as prose |
| F7 | Null/undefined response | Model returns empty output |

**Processing pipeline:**

1. **Guard** (F7): Reject null/empty responses immediately
2. **Parse** (F1, F2, F5): Five-tier JSON extraction---direct parse, fence stripping, brace extraction, bracket extraction, truncation recovery
3. **Tool Call Detection** (F6): Identify tool invocations embedded in text
4. **Validate** (F3): Check required fields against declarative schema
5. **Coerce** (F4): Type coercion with field alias resolution
6. **Repair**: Re-invoke the LLM with error context and schema description

Each schema is declared as a typed `OutputSchema<T>` object specifying required fields, field types, aliases (mapping common LLM name variations to canonical names), enum constraints, defaults, and optional post-coercion hooks. The ORL records telemetry for every invocation---success/failure, failure class, repair attempts, coercions applied---enabling the learning layer to detect systemic reliability patterns.

[^5]: Output Reliability Layer: `workers/ff-pipeline/src/agents/output-reliability.ts`

### 3.4 The Feedback Loop

This is the central contribution. After synthesis completes (whether successfully or not), the pipeline enqueues the result to a feedback queue. The feedback stage examines the synthesis outcome and generates typed signals that re-enter the pipeline as new inputs.[^6]

**Signal taxonomy (six types):**

| Signal Type | Trigger Condition | Auto-Approve |
|-------------|-------------------|--------------|
| `synthesis:atom-failed` | A critical atom's verdict is `fail` | Yes |
| `synthesis:gate1-failed` | Coverage Gate 1 did not pass | No |
| `synthesis:verdict-fail` | General synthesis failure (monolithic path) | No |
| `synthesis:low-confidence` | Synthesis passed but confidence < 0.8 | No |
| `synthesis:orl-degradation` | ORL repair count >= 2 in a single run | Yes |
| `synthesis:pr-candidate` | Synthesis passed with confidence >= 0.8 | No |

The auto-approve flag determines whether the re-injected signal skips the human approval gate. Atom failures and ORL degradation are considered safe for automatic retry: the failure is localized, the blast radius is bounded, and the retry addresses the same scope. Gate failures, low-confidence passes, and PR candidates require human judgment because they may indicate structural problems that retry alone cannot resolve.

**Three-layer loop prevention:**

The feedback loop must be provably bounded. Three independent circuit breakers guarantee termination:

**Layer 1: Depth counter.** Each feedback signal carries a `feedbackDepth` field in its raw payload, initialized to 0 for external signals and incremented on each feedback cycle. The maximum depth is 3. When `feedbackDepth >= MAX_FEEDBACK_DEPTH`, no feedback signals are generated, and the loop terminates regardless of synthesis outcome.

**Layer 2: Content-hash deduplication.** The signal ingestion stage (`ingest-signal`) computes a content hash over the signal's type, source, and payload. If an identical signal already exists in the database, ingestion is rejected. This prevents the same failure from generating the same re-entry signal repeatedly, even if the depth counter has not been exhausted.

**Layer 3: Temporal cooldown.** A 30-minute cooldown window prevents rapid re-firing of signals for the same WorkGraph and signal subtype. Before generating a feedback signal, the system queries ArangoDB for recent signals matching the same `workGraphId` and `subtype`. If a matching signal was created within the cooldown window, the candidate signal is suppressed. This prevents thrashing when a deterministic failure generates identical signals in rapid succession.

These three layers operate independently. Any one of them is sufficient to prevent unbounded recursion; together they provide defense in depth against different classes of loop pathology.

[^6]: Feedback loop: `workers/ff-pipeline/src/stages/generate-feedback.ts`

### 3.5 Orientation Agents: The Learning Layer

The feedback loop provides immediate self-correction: a failed atom retries with the same context. The Orientation Ontology provides compound self-correction: repeated failures are analyzed, patterns are extracted, and knowledge accumulates across runs.[^7]

The Orientation Ontology defines a seven-layer semantic stack:

1. **Telemetry Layer**: Raw observations from factory execution (ORL metrics, trace events, validation failures)
2. **Signal Layer**: Typed interpretations of telemetry (what matters, not just what happened)
3. **Orientation Layer**: Assessments of what signals mean for the factory's behavior
4. **Meta-Artifact Layer**: Proposed changes to the factory itself (prompt patches, contract amendments, routing policy changes)
5. **Governance Layer**: Authorization boundaries for self-modification
6. **Mutation Layer**: Actual changes applied to the factory
7. **Memory Layer**: Durable knowledge extracted from the cycle

The MemoryCuratorAgent is the first implemented Orientation Agent.[^8] It operates asynchronously after feedback signal processing, pre-fetching context from four ArangoDB collections in parallel (ORL telemetry, semantic memory, episodic memory, and recent feedback signals). It then invokes an LLM to consolidate scattered observations into ranked, cross-referenced knowledge: curated lessons with confidence scores and decay status, pattern library entries linking related failures, and governance recommendations when patterns indicate systemic issues.

The curation output is persisted to ArangoDB collections (`memory_curated`, `pattern_library`, `orientation_assessments`) via UPSERT operations, ensuring that evidence accumulates on existing patterns rather than duplicating entries. Lessons that lack recent evidence decay over time (active to decaying at 14 days, decaying to archived at 30 days), preventing stale knowledge from polluting agent context.

[^7]: Orientation Ontology: `specs/reference/ORIENTATION-ONTOLOGY.md`
[^8]: MemoryCuratorAgent: `workers/ff-pipeline/src/agents/memory-curator-agent.ts`

### 3.6 Atom Criticality Classification

Not all atoms are equally important. The Factory classifies atoms by criticality to determine the threshold for WorkGraph success:

- **Critical atoms** (implementation atoms): All must pass for the synthesis to be considered successful. A single critical atom failure generates a `synthesis:atom-failed` feedback signal.
- **Non-critical atoms** (configuration, test scaffolding): A 70% pass threshold is acceptable. These atoms contribute to completeness but do not block the overall verdict.

This classification prevents a non-essential test fixture atom from blocking synthesis of core implementation code, while ensuring that no implementation atom is silently skipped.

---

## 4. The Closed-Loop Contribution

### 4.1 Why Open-Loop Persists

The persistence of open-loop architectures in multi-agent synthesis is not due to oversight. It reflects a deep assumption in the mental model: the pipeline is a function from intent to code, and if the function fails, the input was wrong or the function is broken. In either case, the appropriate response is human intervention.

Closing the loop requires rejecting this assumption. Instead, the pipeline is treated as a process that may require multiple iterations, and failure is treated as information that can guide the next iteration. This shift requires four engineering capabilities that are absent from existing architectures:

1. **Typed failure classification**: The system must distinguish between failure modes that warrant different responses. An atom that failed because the LLM produced prose instead of JSON (F1) needs a different re-entry than an atom that failed because the specification was ambiguous.

2. **Signal generation from structured failure data**: The feedback mechanism must produce signals that are compatible with the pipeline's input format. A synthesis failure must be converted into a signal that carries the failure context (which atom failed, why, what was attempted) in a structure the pipeline can process.

3. **Provable loop termination**: An unbounded feedback loop is worse than no feedback loop. The system must guarantee that it will eventually stop, even in the presence of deterministic failures that reproduce on every retry.

4. **Governance over automatic retries**: Not all failures should be retried automatically. The system must encode a policy distinguishing between safe retries (bounded blast radius, same scope) and unsafe retries (structural problems requiring architectural judgment).

### 4.2 The Signal Taxonomy

The six feedback signal types map failure modes to appropriate responses:

**Atom-level failures** (`synthesis:atom-failed`) are the simplest case. The atom's specification is clear, the failure is localized, and the retry addresses the same scope. These are auto-approved because the blast radius is bounded to one atom's four-node pipeline.

**ORL degradation** (`synthesis:orl-degradation`) indicates that the Output Reliability Layer required multiple repair cycles to extract valid output from an agent. This is a model-reliability signal, not a specification-quality signal. Auto-approval is appropriate because the underlying intent is unchanged; the retry may succeed due to LLM output stochasticity.

**Gate failures** (`synthesis:gate1-failed`) indicate structural problems: the compiled WorkGraph does not meet coverage requirements. These require human review because the fix may require changes to the specification, not just re-execution of the same specification.

**Low-confidence passes** (`synthesis:low-confidence`) are the most nuanced case. The synthesis technically succeeded, but the verifier's confidence score is below threshold. This may indicate a borderline specification, an edge case in the LLM's reasoning, or a genuine quality concern. Human judgment is required to determine whether to accept, reject, or revise.

**PR candidates** (`synthesis:pr-candidate`) represent the success path. Synthesis passed with high confidence, and the system generates a signal to trigger PR creation via the GitHub API.[^9]

[^9]: PR generation: `workers/ff-pipeline/src/stages/generate-pr.ts`

### 4.3 Loop Prevention as a Safety Mechanism

The three-layer loop prevention system is designed around the principle that independent mechanisms should fail independently. Each layer addresses a different class of loop pathology:

**The depth counter** addresses the simplest case: a failure that generates a feedback signal that fails in the same way that generates another feedback signal. The hard limit of 3 ensures that even a fully deterministic failure cycle terminates after at most 3 additional pipeline runs. This is a conservative choice; empirically, if an atom fails three consecutive times with the same specification, the specification is the problem, not the execution.

**Content-hash deduplication** addresses the case where the same signal is generated from different causal paths. If two different atoms fail in the same way and generate identical feedback signals, the second signal is suppressed at ingestion. This prevents fan-out amplification where N failing atoms each generate a feedback signal that processes all N atoms again.

**Temporal cooldown** addresses rapid thrashing. Even if depth and content-hash checks pass, a 30-minute cooldown per WorkGraph-subtype pair prevents the system from consuming resources on a failure that is unlikely to resolve within minutes. The cooldown window is implemented as an AQL query against the signal collection, checking for recent signals with matching source, subtype, and WorkGraph reference.

### 4.4 From Retry to Learning

The feedback loop's immediate response is retry: re-execute the failed atom with the same specification, relying on LLM output stochasticity for a different result. This is analogous to the "resample" strategy in single-agent systems.

The compound response is learning. The `extractLessons` function in the feedback stage analyzes synthesis results for recurring patterns: F1 failures indicating context windows too large, timeout failures indicating atom scope too large, F7 null responses indicating model overload, and partial synthesis indicating stochastic failures.[^6] These patterns are written to the `memory_semantic` collection as lessons, using UPSERT operations that accumulate evidence counts on existing patterns.

The MemoryCuratorAgent then operates on this accumulated evidence, consolidating raw lessons into curated knowledge with confidence scores, severity classifications, affected-agent mappings, and governance recommendations. This curated knowledge is available as context for subsequent pipeline runs, enabling agents to avoid known failure patterns.

The full learning cycle is formalized in the Orientation Ontology as a chain of typed transformations:

```
TelemetryObservation -> Signal -> OrientationAssessment ->
MetaArtifact -> GovernanceGate -> FactoryMutation -> FactoryVersion
```

Each step in this chain is a distinct artifact type with defined schema, lineage, and governance constraints. The Ontology enforces an invariant: no factory self-mutation without a typed signal, a traceable assessment, a Meta-Artifact, a validation plan, and a rollback condition.

---

## 5. Empirical Results

The Function Factory has been operational in production on Cloudflare Workers with ArangoDB Oasis as the persistent store. We report results from the bootstrap phase, in which the Factory operates on its own codebase.

### 5.1 Autonomous Synthesis Runs

The system completed 6 autonomous synthesis runs processing WorkGraphs with 4-7 atoms each. Passing runs achieved a confidence score of 0.95 from the Verifier agent. Each atom was executed in its own Durable Object with a 900-second wall-clock deadline, and context was scoped to the atom's specification plus upstream artifacts.

### 5.2 Feedback Signal Generation

The system generated 23+ feedback signals from the `factory:feedback-loop` source across production runs. Signal distribution by type reflects the expected pattern during bootstrap: atom failures dominate (auto-approved retries), with periodic gate failures and ORL degradation signals.

### 5.3 Output Reliability

ORL telemetry accumulated per agent call, with the five-tier extraction pipeline handling F1 through F5 failures without repair invocation in the majority of cases. The field alias system proved essential: LLMs consistently produce synonymous field names (e.g., `reasoning` for `rationale`, `verdict` for `decision`), and the alias resolution layer eliminates a class of failures that would otherwise require repair cycles.

### 5.4 Model Selection

Agent models were selected via Context Engineering Framework (CEF) analysis after empirical testing. The production configuration uses Workers AI `kimi-k2.6` for agent roles, selected for instruction-following fidelity and agent-first design. Models tested and rejected include `deepseek-v4-pro` (exhibited BL6 training inertia---generating Python boilerplate regardless of TypeScript instructions), `qwen-coder-32b`, `deepseek-r1-32b`, and `llama-3.3-70b`. The ORL's behavioral law taxonomy (BL1-BL7) was developed from these empirical observations.

### 5.5 PR Generation

Synthesis artifacts from passing runs are converted into draft GitHub PRs via the GitHub REST API. The PR generation module creates a branch from main, writes files from all passing atoms (handling create, modify, and delete operations), and creates a labeled draft PR with full lineage metadata, atom result summaries, and conflict detection warnings.

---

## 6. Discussion

### 6.1 Within-Run Repair vs. Cross-Run Feedback

Blueprint2Code and AgentMesh implement repair loops within a single execution: if code generation fails, the system re-invokes the generator with error context. The Factory's feedback loop operates at a different granularity. Within-run repair exists at the ORL level (the repair stage re-invokes the LLM with schema error context) and at the atom level (the Verifier can issue a `patch` verdict triggering re-coding). Cross-run feedback exists at the pipeline level: a completed pipeline run generates signals that start new pipeline runs.

The distinction matters because cross-run feedback carries accumulated knowledge. Run N+1 does not merely retry Run N's failed atom; it starts from a pipeline input (the feedback signal) that encodes what failed and why. The signal's `sourceRefs` field traces back through the full lineage chain, and the lesson extraction mechanism ensures that patterns from Run N's failure are available in the semantic memory for Run N+1's agents.

### 6.2 The Orientation Ontology as Learning Architecture

Most multi-agent synthesis systems have no formal learning mechanism. Agent prompts are static; agent behavior is determined entirely by the current input and the fixed system prompt. The Factory's Orientation Ontology provides a formal framework for self-evolution through ten Orientation Agent types, each consuming typed observations and producing typed Meta-Artifacts.

The MemoryCuratorAgent demonstrates the first layer of this architecture: converting raw telemetry and scattered lessons into ranked, consolidated knowledge with decay semantics. The full Ontology specifies additional agent types---Drift Diagnosis Agent, Contract Health Agent, Model Routing Agent, Policy Friction Agent---that have been designed but not yet implemented. The Ontology itself is a contribution: it provides a vocabulary and formal structure for discussing agent learning that is absent from the existing literature.

### 6.3 LLM Output Reliability as a Systems Problem

The ORL's seven failure classes and behavioral laws reframe LLM unreliability as a systems engineering problem rather than a model selection problem. The observation is that all LLMs, regardless of provider or scale, produce outputs that violate their format instructions some percentage of the time. Rather than treating this as a model deficiency to be solved by choosing a better model, the Factory treats it as a systems constraint to be managed through defensive extraction, type coercion, alias resolution, and repair invocation.

This reframing has practical implications. The ORL telemetry enables the system to detect when a particular model or schema combination exhibits elevated failure rates, and to route around the problem (via the Model Routing Agent, when implemented) rather than simply retrying with the same model.

### 6.4 Limitations

The Factory currently operates on its own codebase (bootstrap phase). Generalization to arbitrary repositories requires codebase comprehension capabilities that are planned but not yet implemented. The feedback loop's depth limit of 3 is a conservative engineering choice; unbounded self-correction risks divergence, where each retry moves further from the original intent. The Orientation Ontology's learning layer currently implements one of ten planned Orientation Agent types. The system has been validated in production but not on standardized benchmarks such as SWE-bench, which would enable direct comparison with MASAI and other systems.

The auto-approve mechanism for atom failures assumes that atom-level retries are safe. This assumption holds when atoms are well-scoped (1-5 files, bounded blast radius) but could be violated by atoms with broad side effects. The criticality classification provides partial mitigation, but a more nuanced safety analysis of auto-approval boundaries is warranted.

---

## 7. Conclusion

We have presented the Function Factory, a multi-agent software synthesis system that closes the feedback loop between synthesis failure and re-synthesis. The system's contribution is not any single technique---vertical slicing, output reliability, or learning agents individually appear in existing literature---but their composition into a system that autonomously generates, classifies, and re-processes its own failure signals.

The key architectural elements are:

1. **Atom-level vertical slicing** with per-atom Durable Objects, dependency-layer parallelism, and scoped context, following LLMCompiler's DAG execution model.

2. **A typed Output Reliability Layer** that classifies LLM output failures into seven categories and processes all agent outputs through a declarative schema-driven pipeline.

3. **A six-type feedback signal taxonomy** that maps synthesis outcomes to appropriate re-entry actions, with governance distinguishing automatic retries from human-gated decisions.

4. **Three-layer loop prevention** providing independent circuit breakers against unbounded recursion: depth counter, content-hash deduplication, and temporal cooldown.

5. **An Orientation Ontology** formalizing the learning cycle from telemetry observation through signal interpretation, assessment, Meta-Artifact generation, governance gate, mutation, and versioning.

Together, these elements compose into a system that not only produces code but improves its own production process through accumulated knowledge. The fundamental insight is that treating synthesis failures as typed signals---rather than terminal states---transforms an open-loop pipeline into a self-correcting system. The engineering requirements for this transformation (typed failure classification, signal generation, loop prevention, governance) are specific and implementable, and we have demonstrated their feasibility in a production system.

---

## References

Arora, D., et al. (2024). "MASAI: Modular Architecture for Software-engineering AI Agents." arXiv:2406.11638.

Hassan, F., et al. (2025). "Agentic Software Engineering: Foundational Pillars and a Research Roadmap." arXiv:2509.06216.

Khanzadeh, M. (2025). "AgentMesh: A Cooperative Multi-Agent Generative AI Framework for Software Development Automation." arXiv:2507.19902.

Kim, S., et al. (2024). "An LLM Compiler for Parallel Function Calling." Proceedings of the 41st International Conference on Machine Learning (ICML 2024). arXiv:2312.04511.

Liu, Z., et al. (2025). "SEW: Self-Evolving Agentic Workflows for Automated Code Generation." arXiv:2505.18646.

Mao, X., et al. (2025). "Blueprint2Code: A multi-agent pipeline for reliable code generation via blueprint planning and repair." Frontiers in Artificial Intelligence.

Yu, J., et al. (2025). "DynTaskMAS: A Dynamic Task Graph-driven Framework for Asynchronous and Parallel LLM-based MAS." ICAPS 2025. arXiv:2503.07675.

---

## Implementation References

The Function Factory is implemented in TypeScript on Cloudflare Workers with ArangoDB Oasis. Source code is available at https://github.com/Wescome/function-factory. Key implementation files referenced in this paper:

- Pipeline orchestration: `workers/ff-pipeline/src/pipeline.ts`
- Feedback loop: `workers/ff-pipeline/src/stages/generate-feedback.ts`
- Output Reliability Layer: `workers/ff-pipeline/src/agents/output-reliability.ts`
- AtomExecutor Durable Object: `workers/ff-pipeline/src/coordinator/atom-executor-do.ts`
- Completion ledger: `workers/ff-pipeline/src/coordinator/completion-ledger.ts`
- Layer dispatch: `workers/ff-pipeline/src/coordinator/layer-dispatch.ts`
- MemoryCuratorAgent: `workers/ff-pipeline/src/agents/memory-curator-agent.ts`
- PR generation: `workers/ff-pipeline/src/stages/generate-pr.ts`
- Orientation Ontology: `specs/reference/ORIENTATION-ONTOLOGY.md`
