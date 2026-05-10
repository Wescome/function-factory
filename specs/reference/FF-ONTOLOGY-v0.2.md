# Function Factory Ontology

**Version:** 0.2 — Draft
**Date:** 2026-05-07
**Status:** Working document — open for revision
**Predecessor:** *A Formal Ontology of Specification-Execution Systems*, Draft 1.0 (Celestin, 2026)
**External alignment:** Pan et al., "Natural-Language Agent Harnesses" (2026) — terminology adopted where noted

---

## Purpose and Scope

This document defines the categorical structure of the Function Factory: the kinds of entities that exist in the system, the relations between them, and the axioms that constrain them.

It serves three audiences. Maintainers who need to understand why a component exists and what breaks if it changes. Designers who need to know where a new mechanism slots before building it. Evaluators who need to assess whether the system's claims hold.

The ontology is *domain-specific*. It instantiates the domain-general Specification-Execution ontology (Celestin 2026, Draft 1.0) for the particular domain of autonomous software compilation. Where the general ontology says "specification," this ontology says which *kind* of specification and where it lives in the pipeline. Where Pan et al. (2026) provide terminology for agent harness execution, this ontology adopts that terminology for the Factory's runtime layer and marks the adoption explicitly.

The ontology is *realist* in the same sense as its predecessor: it asserts what exists, not how the code implements it. Implementation choices are downstream and constrained by the ontology, not part of it. A companion implementation mapping (§11) records where current code instantiates each category; that mapping is *not* part of the ontology and will drift as the code changes.

### How to Read This Document

Each category is defined with supercategory, definition, identity criteria (synchronic and diachronic), essential properties, and characteristic relations.

Relations are defined with domain, range, and formal properties (functional, total, partial, etc.).

Axioms are stated with rationale and a counterexample showing what they rule out.

### Notation

- **[Pan]** marks terminology adopted from Pan et al. (2026)
- **[SE-Onto]** marks categories inherited from the Specification-Execution ontology
- **[FF]** marks categories specific to this ontology
- *Must*, *must not* — categorical constraints
- *Should* — strong recommendation; violation requires justification
- *May* — permission

---

## Top-Level Categorical Structure

```
Factory Entity
│
├── Artifact (Continuant)
│   ├── Signal Artifact
│   ├── Pressure Artifact
│   ├── Capability Artifact
│   ├── Function Proposal
│   ├── Intent Specification
│   ├── Executable Specification
│   ├── Invariant Specification
│   ├── Verification Report
│   ├── Execution Contract  [Pan]
│   ├── Elucidation Artifact  [SE-Onto]
│   └── Lineage Edge
│
├── Process (Occurrent)
│   ├── Compilation Transformation
│   │   ├── Decomposition (narrative → atomic claims)
│   │   ├── Binding (claims → typed contracts)
│   │   ├── Obligation Extraction (claims → monitored invariants)
│   │   ├── Structural Assembly (bound elements → executable graph)
│   │   └── Completeness Certification (graph → coverage verdict)
│   │
│   ├── Verification Process  [SE-Onto]
│   │   ├── Coherence Verification (structural completeness of a static artifact)
│   │   ├── Fidelity Verification (behavioral correspondence under simulation)
│   │   └── Persistence Verification (continuous assurance of deployed invariants)
│   │
│   ├── Agent Call  [Pan]
│   ├── Instruction Tuning  [DSPy]
│   ├── Pattern Appraisal  [SE-Onto]
│   └── Disposition Event  [SE-Onto]
│
├── Structural Component (Continuant)
│   ├── Runtime Charter  [Pan]
│   ├── Harness Skill  [Pan]
│   ├── Durable State Module  [Pan]
│   ├── Failure Taxonomy  [Pan]
│   ├── Knowing-State Prosthesis  [SE-Onto]
│   └── Assurance Graph
│
└── Agent (Independent Continuant)  [SE-Onto]
    ├── Orchestrator
    ├── Worker
    └── Maintaining Agent
```

---

## The Pipeline Layer: Artifacts and Their Lineage

The Factory's pipeline transforms intent into executable procedure through a sequence of typed artifacts. Each artifact is a specification in the SE-Onto sense: it formalizes some portion of a knowing-state, it is communicable, it is partial, and it is static once created (modifications produce successor artifacts).

The pipeline's contribution is that artifacts are *ordered by representational tier*. Early artifacts carry conceptual-tier content — claims about what is needed, why, and what it means. Late artifacts carry procedural-tier content — state machines, typed contracts, detector specifications that a transformer can maintain across turns. The compiler's purpose is to convert across tiers while preserving lineage.

### Signal Artifact

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact |
| **Definition** | A raw observation from the environment — a market event, a user report, a metric threshold breach, a competitor action — captured in structured form before interpretation. |
| **Tier** | Pre-conceptual (uninterpreted data) |
| **Synchronic identity** | Identified by source, timestamp, and content hash. Two signals with identical content from the same source at the same time are the same signal. |
| **Diachronic identity** | Immutable. A signal does not change; reinterpretation produces a new Pressure Artifact, not a modified signal. |
| **Essential properties** | Timestamped. Source-attributed. Uninterpreted (a signal asserts that something was observed, not what it means). Immutable once captured. |
| **Relations** | `collected_by → Collection Process`, `interpreted_by → Pressure Artifact` (zero or many) |

### Pressure Artifact

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (Specification — conceptual tier) |
| **Definition** | An interpreted claim that a class of need exists, derived from one or more signals. A pressure names what is demanded, not what should be built. |
| **Tier** | Conceptual |
| **Synchronic identity** | Identified by content and version designation. |
| **Diachronic identity** | Static once created. New signals motivate successor pressures, not modifications. |
| **Essential properties** | Source-referenced to signals. Named demand (what is needed). Metric-bearing (how the need would be measured as met or unmet). |
| **Relations** | `derived_from → Signal Artifact` (one or many), `motivates → Capability Artifact` (zero or many), `lineage → Lineage Edge` |

### Capability Artifact

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (Specification — conceptual tier) |
| **Definition** | A claim that a named organizational ability would address one or more pressures, together with acceptance criteria for that ability. A capability describes *what the organization could do*, not *what should be built*. |
| **Tier** | Conceptual (transitioning toward constraint) |
| **Synchronic identity** | Identified by content and version designation. |
| **Essential properties** | Pressure-referenced. Named ability. Acceptance criteria (conditions under which the capability is possessed). |
| **Relations** | `responds_to → Pressure Artifact` (one or many), `decomposed_into → Function Proposal` (one or many), `lineage → Lineage Edge` |

### Function Proposal

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (Specification — constraint tier) |
| **Definition** | A scoped unit of deliverable value — a buildable thing with defined inputs, outputs, and boundaries — proposed as a realization of part of a capability. |
| **Tier** | Constraint (scoped enough to be contracted, not yet procedural) |
| **Essential properties** | Capability-referenced. Bounded scope (inputs, outputs, boundaries defined). Contractable (can be assigned to an agent with a completion condition). |
| **Relations** | `realizes_part_of → Capability Artifact`, `specified_by → Intent Specification` (zero or one), `lineage → Lineage Edge` |

### Intent Specification

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (Specification — conceptual tier, compilation input) |
| **Definition** | A natural-language description of a system that does not yet exist: its interfaces, constraints, behaviors, and invariants. An intent specification is a conceptual world model of the target system. It is the compiler's *input* — the artifact whose tier-conversion the compilation pipeline exists to perform. |
| **Tier** | Conceptual |
| **Essential properties** | Function-referenced. Narrative (describes a system conceptually, not procedurally). Compilable (the compiler can extract atomic claims, typed contracts, and invariant specifications from it). |
| **Relations** | `specifies → Function Proposal`, `compiled_into → Executable Specification` (via Compilation Transformation), `lineage → Lineage Edge` |
| **Note** | An intent specification given directly to an executor is the setup for conceptual-framework failure (SE-Onto §3.1 Revision Note, comprehension gap). The executor will track state-level claims and follow constraint-level conventions but will not reliably reason from the specification's conceptual intent when making judgment calls. This failure mode is the compiler's raison d'être. |

### Executable Specification

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (Specification — procedural tier, compilation output) |
| **Definition** | A procedural world model of the target system: nodes (states), edges (transitions), invariants (state constraints), and lineage (provenance). An executable specification is maintainable by a transformer because it is a state machine, not a philosophy. |
| **Tier** | Procedural |
| **Pan et al. alignment** | An executable specification is a *compiled* Natural-Language Agent Harness. It satisfies the NLAH component checklist: contracts (node input/output specs), roles (node role assignments), stage structure (node topology), adapters and scripts (deterministic hooks), state semantics (artifact paths and persistence rules), failure taxonomy (named recovery paths). Any executable specification that omits a checklist component is incomplete. |
| **Synchronic identity** | Identified by content and version designation. An executable specification is a successor of the intent specification it was compiled from; it is not the same artifact. |
| **Essential properties** | Intent-specification-referenced via lineage. Procedural (every claim tracked as a state, every constraint bound as an edge, every obligation monitored by a detector). Structurally complete (passed Coherence Verification). Node-typed (each node carries an execution contract). |
| **Relations** | `compiled_from → Intent Specification` (functional, total), `contains → Invariant Specification` (one or many), `executed_by → Agent Call` (one or many), `lineage → Lineage Edge` |

### Invariant Specification

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (Specification — procedural tier) |
| **Definition** | A named property that must hold continuously during and after execution, together with a detector specification that describes how to mechanically check whether it holds. |
| **Tier** | Procedural |
| **Essential properties** | Executable-specification-referenced. Named property. Detector spec (a procedure for checking the invariant — not a conceptual aspiration but a mechanical test). Severity level (determines what happens when the invariant is violated). |
| **Relations** | `part_of → Executable Specification`, `monitored_by → Assurance Graph`, `lineage → Lineage Edge` |

### Verification Report

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (procedural tier) |
| **Definition** | The output of a Verification Process: a timestamped, machine-readable verdict on whether an acceptance criterion is satisfied, together with the evidence that supports the verdict. |
| **Essential properties** | Process-referenced (identifies which verification process produced it). Verdict-bearing (pass, fail, or incomplete). Evidence-bearing (carries the specific checks performed and their outcomes, not just a boolean). Timestamped. Immutable. |
| **Relations** | `produced_by → Verification Process`, `evaluates → Artifact or Execution Trace`, `lineage → Lineage Edge` |

### Execution Contract

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact [Pan: adopted directly] |
| **Definition** | The binding terms under which an Agent Call executes: what it must produce, what resources it may consume, what permissions it holds, when it is complete, and where its outputs go. |
| **Pan et al. formalization** | κ in T = (p, F_in, κ): required outputs, budget, permission scope, completion conditions, designated output paths. |
| **Synchronic identity** | Identified by the (Agent Call, Executable Specification node) pair it binds. |
| **Essential properties** | Output-specified. Budget-bounded. Permission-scoped. Completion-conditioned (a mechanical predicate, not a judgment call). Path-designated (outputs go to named locations). |
| **Relations** | `binds → Agent Call` (functional, total), `derived_from → Executable Specification node` |

### Lineage Edge

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact (relational artifact) |
| **Definition** | A typed, directed, immutable record connecting a downstream artifact to one or more upstream artifacts, carrying the identity of the transformation that produced the downstream from the upstream. |
| **Synchronic identity** | Identified by (source artifact, target artifact, transformation type) triple. |
| **Essential properties** | Directed. Typed (which kind of transformation produced it). Immutable. Per-transformation (written at the transformation boundary where it occurs, not batched after the fact). Explicitness-tagged (stated, inferred, or interpolated — recording how directly the downstream content derives from the upstream). |
| **Relations** | `connects → Artifact × Artifact`, `produced_at → Compilation Transformation or Agent Call` |

### Elucidation Artifact

| Property | Value |
|----------|-------|
| **Supercategory** | Artifact [SE-Onto] |
| **Definition** | A record of the decision-space that existed prior to a Disposition Event — the options considered, constraints applied, justifications advanced, and risks accepted. Produced after every non-trivial pipeline decision to preserve the possibility space that the decision foreclosed. |
| **Synchronic identity** | Identified by the Disposition Event it records. |
| **Essential properties** | Post-dispositional. Counterfactual-capturing (records rejected options, not just the selected one). Amendment-enabling (provides evidence base for hypothesis formation when divergence is later detected). |
| **Relations** | `records → Disposition Event`, `informs → Hypothesis` (when divergence is later detected) |

---

## The Process Layer: Transformation, Verification, and Execution

Processes are occurrents — they unfold through time and have temporal parts. The Factory's processes divide into three families: compilation transformations (converting representational tier), verification processes (confirming conversion quality), and execution processes (running the converted artifact).

### Compilation Transformations

A compilation transformation is a single stage of the intent-to-executable compiler: a function from one typed artifact state to another. The compiler's purpose is tier-conversion — taking conceptual content and producing procedural content that a transformer can maintain. Each transformation performs one *kind* of conversion. The kinds are distinguished by what they do to the input, not by their order of execution.

#### Decomposition

| Property | Value |
|----------|-------|
| **Supercategory** | Compilation Transformation |
| **Definition** | A transformation that takes a narrative specification and produces atomic claims — discrete, typed, individually addressable propositions extracted from the narrative. Decomposition breaks a conceptual whole into enumerable parts without yet binding them to each other. |
| **Tier conversion** | Conceptual → conceptual (the atoms are still claims about intent, not yet procedures; but they are now discrete and addressable rather than embedded in narrative) |
| **Essential properties** | Completeness-obligated (every substantive claim in the input must appear as an atom in the output, or the decomposition is lossy). Source-referenced (each atom carries a provenance link to the narrative span it was extracted from). |
| **Relations** | `input → Intent Specification`, `output → Atomic Claim Set`, `emits → Lineage Edge` (per atom) |

#### Binding

| Property | Value |
|----------|-------|
| **Supercategory** | Compilation Transformation |
| **Definition** | A transformation that takes atomic claims and produces typed contracts — formal agreements between producers and consumers with explicit interfaces, data types, and validation conditions. Binding converts implications between claims into explicit structural relationships. |
| **Tier conversion** | Conceptual → constraint |
| **Essential properties** | Relationship-explicating (implicit relationships between atoms become typed edges). Interface-producing (each contract names its parties, its data type, and its validation condition). |
| **Relations** | `input → Atomic Claim Set`, `output → Contract Set`, `emits → Lineage Edge` (per contract) |

#### Obligation Extraction

| Property | Value |
|----------|-------|
| **Supercategory** | Compilation Transformation |
| **Definition** | A transformation that takes atomic claims and produces invariant specifications — properties that must hold continuously, together with mechanical detector specifications for checking them. Obligation extraction converts aspirations ("the system should be fast") into monitoring obligations ("latency measured at endpoint X must remain below threshold Y, checked by detector Z"). |
| **Tier conversion** | Conceptual → procedural |
| **Essential properties** | Aspiration-to-mechanism (every invariant has a detector spec, not just a property name). Severity-assigned (each invariant carries a severity level that determines the system's response on violation). |
| **Relations** | `input → Atomic Claim Set`, `output → Invariant Specification Set`, `emits → Lineage Edge` (per invariant) |

#### Structural Assembly

| Property | Value |
|----------|-------|
| **Supercategory** | Compilation Transformation |
| **Definition** | A transformation that takes bound contracts, extracted invariants, and remaining structural elements and assembles them into a single executable specification — a graph of typed nodes, directed edges, embedded invariants, and lineage provenance. |
| **Tier conversion** | Constraint + procedural → procedural (everything is now a state machine) |
| **Essential properties** | Graph-producing (the output is a directed graph, not a list or a document). Node-typed (each node carries an execution contract). Edge-typed (each edge carries a data type and a trigger condition). Invariant-embedded (invariant specifications are attached to the nodes and edges they govern). |
| **Relations** | `input → Contract Set × Invariant Specification Set × structural elements`, `output → Executable Specification`, `emits → Lineage Edge` (per assembly decision) |

#### Completeness Certification

| Property | Value |
|----------|-------|
| **Supercategory** | Compilation Transformation |
| **Definition** | A transformation that takes a structurally assembled executable specification and produces a coverage verdict: an internal check that every upstream claim is bound, every constraint is edged, and every obligation is monitored. This is the compiler's self-check — distinct from the Coherence Verification process that evaluates the output externally. |
| **Tier conversion** | Procedural → procedural (no tier change; this is a verification within the procedural tier) |
| **Essential properties** | Exhaustive (checks every atom, contract, and invariant, not a sample). Verdict-producing (outputs a pass/fail with evidence, not a narrative assessment). |
| **Relations** | `input → Executable Specification (draft)`, `output → Executable Specification (certified) + internal coverage verdict` |

### Verification Processes

A verification process evaluates whether an acceptance criterion is satisfied and produces a Verification Report. The Factory has three *kinds* of verification, distinguished by what they verify, when they verify it, and what temporal extent they cover.

**Critical constraint:** each verification kind's acceptance criterion must formally derive from the acceptance criterion of the verification kind downstream of it in the pipeline, or from the final acceptance condition of the deployed system. A verification whose acceptance criterion cannot be shown to derive from downstream acceptance carries the risk of *local-acceptance drift* — the failure mode documented empirically in Pan et al. Table 3, where adding a verification module degraded performance because its local criterion diverged from the benchmark's final criterion.

#### Coherence Verification

| Property | Value |
|----------|-------|
| **Supercategory** | Verification Process [SE-Onto: coherence-verification-function] |
| **Definition** | A synchronic verification that evaluates the structural completeness of a static artifact at a point in time. Does every upstream claim have a downstream binding? Is every contract fully typed? Does every invariant have a detector specification? |
| **Temporal extent** | Instantaneous — evaluates a snapshot. |
| **Input** | An Executable Specification (or any artifact whose structural completeness is in question). |
| **Acceptance criterion** | Every claim bound, every constraint edged, every obligation monitored. No orphan atoms, no untyped contracts, no detector-less invariants. |
| **Essential properties** | Fail-closed (default is block, not pass). Exhaustive (checks every element, not a sample). Evidence-producing (the Verification Report carries the specific checks and their outcomes). |
| **Relations** | `evaluates → Artifact`, `produces → Verification Report`, `blocks → downstream process` (on failure) |
| **Derivation obligation** | The acceptance criterion must be derivable from Fidelity Verification's criterion: structural completeness is necessary for behavioral fidelity. |

#### Fidelity Verification

| Property | Value |
|----------|-------|
| **Supercategory** | Verification Process [SE-Onto: fidelity-verification-function] |
| **Definition** | A simulation-bounded verification that evaluates whether the executable specification, when executed or simulated, produces behavior consistent with the intent specification's claims. Does the procedural world model behave as the conceptual world model intended? |
| **Temporal extent** | Bounded — covers a finite execution or simulation horizon. |
| **Input** | An Executable Specification (structurally complete, having passed Coherence Verification) together with the Intent Specification it was compiled from. |
| **Acceptance criterion** | Simulated or executed behavior is consistent with the upstream intent specification's testable claims. The criterion is defined in terms that Persistence Verification can later check continuously. |
| **Essential properties** | Fail-closed. Simulation-grounded (evaluates behavior, not structure). Intent-comparative (checks the procedural artifact against the conceptual artifact it derives from, not against an independent standard). |
| **Relations** | `evaluates → Executable Specification × Intent Specification`, `produces → Verification Report`, `blocks → execution` (on failure) |
| **Derivation obligation** | The acceptance criterion must be derivable from Persistence Verification's criterion: behavioral fidelity under simulation is necessary for continuous assurance under deployment. |
| **Open problem** | The formal derivation from Persistence Verification's criterion to Fidelity Verification's criterion is not yet specified. Without it, Fidelity Verification carries the local-acceptance drift risk. |

#### Persistence Verification

| Property | Value |
|----------|-------|
| **Supercategory** | Verification Process [SE-Onto: safety-verification-function] |
| **Definition** | An unbounded, continuous verification that evaluates whether deployed invariant detectors remain fresh, triggered monitors remain active, and regression surfaces remain covered over the lifetime of the deployed system. |
| **Temporal extent** | Unbounded — runs for as long as the deployed system exists. |
| **Input** | A deployed system together with its Invariant Specifications and detector specifications. |
| **Acceptance criterion** | All invariant detectors are executing, their verdicts are current, no detector has gone stale, no regression surface has been uncovered by a code change or environment shift. This is the terminal acceptance criterion from which the other verification kinds derive. |
| **Essential properties** | Continuous (not a one-time check). Decay-detecting (notices when detectors go stale, not just when they report violations). Regression-aware (notices when changes to the system invalidate existing detector coverage). |
| **Relations** | `evaluates → Deployed System × Invariant Specification Set`, `produces → Verification Report` (periodically), `triggers → remediation` (on failure) |

### Agent Call

| Property | Value |
|----------|-------|
| **Supercategory** | Process [Pan: adopted directly] |
| **Definition** | A model call lifted into a contracted execution: an agent receives a task prompt, input artifacts, and an execution contract, and produces output artifacts, environment modifications, and a normalized response indicating success or failure. |
| **Pan et al. formalization** | AgentCall(T, Ω_in) = (A_t, ΔΩ_t, y_t), where T = (p, F_in, κ). A single model call is a degenerate agent call where κ enforces one-shot answering with no external action. |
| **Synchronic identity** | Identified by (execution contract, start timestamp). |
| **Essential properties** | Contract-bound (every agent call executes under an Execution Contract). Artifact-producing (outputs are typed artifacts, not free text). Traceable (the call produces an execution trace evaluable by a Verification Process). Budget-bounded. |
| **Relations** | `bound_by → Execution Contract`, `executes_node_of → Executable Specification`, `produces → Artifact` (one or many), `traced_by → Execution Trace`, `delegated_by → Orchestrator` (if child call) |

### Instruction Tuning

| Property | Value |
|----------|-------|
| **Supercategory** | Process |
| **Status** | Future — not yet implemented. Slotted here to establish categorical placement. |
| **Definition** | A post-compilation optimization process that improves the natural-language instruction text within executable specification nodes using empirical execution data, without altering the specification's structural contracts. |
| **Mechanism** | Optimization over instruction text using execution traces as training data. The optimizer searches for instruction variants that improve downstream verification outcomes while preserving all structural properties verified by Coherence Verification. |
| **Essential properties** | Structure-preserving (contracts, topology, lineage unchanged). Model-specific (tuned text is optimal for a specific executor model). Verification-bound (optimization metric derives from Persistence Verification outcomes, not from local plausibility). Bootstrapped (requires execution history; unavailable for first runs of a new executable specification). |
| **Relations** | `tunes → Executable Specification node` (many), `trained_on → Execution Trace` (many), `optimized_for → model provider`, `preserves → Execution Contract` (all) |

### Pattern Appraisal and Disposition

Inherited from SE-Onto without modification. Pattern Appraisal produces a Candidate Set; Deliberation operates on the Candidate Set; a Disposition Event collapses the possibility space into a committed action and triggers an Elucidation Artifact.

The Factory-specific obligation: every Disposition Event in the pipeline must produce an Elucidation Artifact (SE-Onto Axiom A9). This applies to compilation design decisions, verification threshold settings, routing table updates, capability prioritization, and any other point where alternatives are foreclosed.

---

## The Structural Layer: Runtime, Harness, and State

These are continuants — they persist through time and provide the substrate on which processes execute. Pan et al.'s terminology is most directly useful here, because their three-part decomposition of the Intelligent Harness Runtime (in-loop LLM + backend + runtime charter) maps cleanly onto the Factory's execution layer.

### Runtime Charter

| Property | Value |
|----------|-------|
| **Supercategory** | Structural Component [Pan: runtime skill] |
| **Definition** | The shared, non-negotiable substrate that makes any Factory harness executable. It defines the semantics of contracts, state persistence, orchestration, agent lifecycle, and verification enforcement. |
| **Essential properties** | Shared (applies to all harness skills within the Factory). Non-negotiable (cannot be ablated without breaking the system — verified empirically by Pan et al. RQ1, where removing the runtime skill materially changed system behavior). Policy-bearing (defines what is permitted and enforced, not what is task-specific). Separable from harness skills (a maintainer can modify task-family logic without touching the charter). |
| **Contents** | Verification enforcement rules (fail-closed semantics, acceptance criterion derivation). Lineage write discipline (per-transformation, not batched). Artifact persistence semantics (path-addressable, compaction-stable). Agent call lifecycle (contract, execution, trace, verdict). Orchestrator minimality (coordinator role, not worker role). Child context semantics (forked context vs. fresh context for delegated calls). |
| **I/We boundary** | The runtime charter is the narrow interface between the compilation layer (I-layer) and the governance layer (We-layer). Governance signals enter the pipeline as signal artifacts; the runtime charter ensures those signals are respected during execution. |
| **Relations** | `constrains → Harness Skill` (all), `enforces → Verification Process` (all), `defines_semantics_of → Durable State Module` |

### Harness Skill

| Property | Value |
|----------|-------|
| **Supercategory** | Structural Component [Pan: harness skill] |
| **Definition** | Task-family-specific control logic: the roles, stage structure, adapter hooks, and failure handling for a particular kind of work. A harness skill describes how to execute *this kind of task*, while the runtime charter describes the shared rules under which *any* task executes. |
| **Essential properties** | Task-family-scoped. Composable (can be combined with other harness skills under the same runtime charter). Explicit (a maintainer can read it and understand the control flow without examining code). Satisfies the NLAH component checklist: contracts, roles, stage structure, adapters/scripts, state semantics, failure taxonomy. |
| **Relations** | `executes_under → Runtime Charter`, `controls → Agent Call` (one or many), `references → Executable Specification` (the compiled specification being executed) |

### Durable State Module

| Property | Value |
|----------|-------|
| **Supercategory** | Structural Component [Pan: file-backed state module] |
| **Definition** | The subsystem that externalizes durable state into path-addressable artifacts, ensuring that state survives context truncation, restart, delegation, and branching. |
| **Essential properties** | **Externalized:** state is written to artifacts, not held only in transient context. **Path-addressable:** later processes reopen the exact object by path. **Compaction-stable:** state survives truncation, restart, and delegation. **Lineage-integrated:** state writes produce lineage edges. **Verification-visible:** verification processes can inspect persisted state as evidence. |
| **Pan et al. empirical grounding** | Strongest positive module in their ablation — consistent, cheap, highest return on investment across both coding and computer-use benchmarks. The empirically most important module. |
| **Relations** | `persists → Artifact` (any), `substrate_for → Agent Call` (provides durable state across calls), `inspected_by → Verification Process` |

### Failure Taxonomy

| Property | Value |
|----------|-------|
| **Supercategory** | Structural Component [Pan: adopted directly] |
| **Definition** | A named, enumerated set of failure modes for a harness skill, where each mode specifies what went wrong and what recovery action the system takes. |
| **Essential properties** | Named (each failure mode has a distinct identifier). Recovery-mapped (each mode maps to a specific action: retry, regenerate, escalate, block). Exhaustive within scope (covers all anticipated failures for its harness skill; unanticipated failures escalate by default). |
| **Relations** | `part_of → Harness Skill`, `drives_recovery_in → Agent Call` |

### Knowing-State Prosthesis

| Property | Value |
|----------|-------|
| **Supercategory** | Structural Component [SE-Onto] |
| **Definition** | A dependent continuant that holds conceptual-tier content on behalf of an agent whose native maintenance of that content is unreliable, in a form that supports retrieval at moments of execution and is continuously maintained by one or more agents distinct from the executing agent. |
| **Factory instantiations** | The introspective harness (binary probe questions crystallized from protocol content, evaluated in isolated calls, fail-closed logic). The runtime charter itself, insofar as it enforces discipline that executing agents cannot sustain across turns. Verification processes, insofar as they supply acceptance criteria that agents cannot reliably derive from conceptual specifications. |
| **Four implementation invariants** | Externalization. Retrieval enforcement. Continuous maintenance. Fail-closed coupling. |
| **Relations** | `serves → Agent`, `targets → Knowing-State`, `maintained_by → Maintaining Agent` |

### Assurance Graph

| Property | Value |
|----------|-------|
| **Supercategory** | Structural Component |
| **Definition** | A persistent graph of typed dependencies between deployed functions, their invariant detectors, and their upstream lineage, used for incident propagation: when one component fails, the graph identifies all downstream components whose assurance is affected. |
| **Synchronic identity** | Singleton per Factory deployment. |
| **Essential properties** | Dependency-typed (edges carry the kind of dependency). Propagation-capable (a failure at any node triggers traversal to identify affected nodes). Continuously updated (new deployments add nodes and edges; retirements remove them). |
| **Relations** | `contains → Invariant Specification` (as nodes), `connects → deployed function` (as dependency edges), `evaluated_by → Persistence Verification` |

---

## The Agent Layer

Agents are independent continuants that execute processes. The Factory has three agent roles, distinguished by their relationship to substantive work.

### Orchestrator

| Property | Value |
|----------|-------|
| **Supercategory** | Agent |
| **Definition** | The coordinating agent for a pipeline run. Reads the executable specification or harness skill, delegates agent calls to workers, collects results, and enforces the runtime charter. |
| **Essential properties** | Thin (does not perform substantive task work — empirically, the vast majority of compute belongs in workers, not the coordinator). Contract-enforcing (ensures each delegated agent call satisfies its execution contract). State-managing (maintains the durable state module for the run). |
| **Pan et al. alignment** | The "in-loop LLM" component of their Intelligent Harness Runtime. |
| **Relations** | `delegates → Agent Call`, `enforces → Runtime Charter`, `manages → Durable State Module` |

### Worker

| Property | Value |
|----------|-------|
| **Supercategory** | Agent |
| **Definition** | An agent that executes a single agent call under an execution contract. Receives a task prompt, input artifacts, and contract; produces output artifacts and a verdict. |
| **Essential properties** | Contract-bound. Scoped (operates only within its designated permissions and output paths). Traceable (produces an execution trace). |
| **Relations** | `executes → Agent Call`, `bound_by → Execution Contract`, `produces → Artifact` |

### Maintaining Agent

| Property | Value |
|----------|-------|
| **Supercategory** | Agent |
| **Definition** | An agent (human or automated) responsible for the continuous maintenance of a knowing-state prosthesis, a failure taxonomy, or a verification acceptance criterion. |
| **Essential properties** | Maintenance-responsible (the prosthesis decays without this agent's ongoing work). Knowing-state-bearing (the maintaining agent bears the conceptual content that the executing agent cannot sustain). |
| **Note** | Maintenance work is not overhead. It is the primary cognitive activity of the system. The agents who maintain prostheses are bearing the conceptual content of the system on behalf of the executing agents. Treating their work as low-status or expendable is treating the system's primary cognitive substrate as expendable. |

---

## Relations

### Core Relations

| Relation | Domain | Range | Properties | Notes |
|----------|--------|-------|------------|-------|
| `compiled_from` | Executable Specification | Intent Specification | functional, total | The compiler's central transformation |
| `derived_from` | Artifact | Artifact | total | General lineage; specialized by transformation type |
| `lineage` | Artifact | Lineage Edge | total | Every artifact must have at least one lineage edge |
| `bound_by` | Agent Call | Execution Contract | functional, total | No uncontracted execution |
| `evaluates` | Verification Process | Artifact or Trace | total | Verification evaluates; it does not create |
| `produces` | Process | Artifact | total | Every process must produce a typed output |
| `executes_under` | Harness Skill | Runtime Charter | functional, total | Every harness operates under exactly one charter |
| `serves` | Prosthesis | Agent | functional, total | Every prosthesis serves exactly one agent |
| `maintained_by` | Prosthesis | Agent | total, not functional | Collective maintenance is common |
| `tunes` | Instruction Tuning | Executable Specification node | not functional | One tuning process may affect many nodes |
| `acceptance_derives_from` | Verification Process | Verification Process | partial | Each verification kind's criterion derives from the next downstream kind |

### The Tier-Conversion Relation

| Relation | Domain | Range | Properties |
|----------|--------|-------|------------|
| `converts_tier` | Compilation Transformation | (Artifact_higher_tier, Artifact_lower_tier) | functional per transformation |

This is the Factory's central relation. Each compilation transformation takes content at one representational tier and emits content at the same or lower tier. The pipeline as a whole converts conceptual → procedural. The SE-Onto's three-tier structure of knowing-states is the theoretical ground for this relation.

---

## Axioms

### Tier Descent

**Statement:** The tier of a pipeline artifact must be equal to or lower (more procedural) than the tier of its immediate upstream artifact. No compilation transformation may raise tier.

**Rationale:** The compiler converts conceptual to procedural. A transformation that raises tier (makes things *more* conceptual) is not compiling; it is interpreting, which is a different process with different reliability properties.

**Counterexample ruled out:** A transformation that takes an executable specification node and produces a "design philosophy document" from it. This would be tier-raising and is not a compilation transformation.

### Lineage Completeness

**Statement:** Every artifact in the pipeline must bear at least one lineage edge connecting it to its immediate upstream source. An artifact without lineage is untraceable and must not pass any verification process.

**Rationale:** Lineage is the mechanism by which verification processes can confirm that downstream artifacts actually derive from upstream intent. Without lineage, verification verdicts are groundless.

**Counterexample ruled out:** An executable specification node that exists without any record of which intent specification claim it realizes.

**Corollary:** Lineage edges must be written per-transformation at the transformation boundary, not batched after the fact. Batched lineage writes are brittle under failure — if the batch step fails, all lineage for the batch is lost.

### Fail-Closed Verification

**Statement:** A verification process's default verdict is *block*. A process that cannot reach a verdict (timeout, error, insufficient evidence) must block the pipeline. A process that passes must produce a verification report with evidence sufficient to justify the verdict.

**Rationale:** A verification that defaults to pass is not a verification; it is a decorator. The purpose of verification is to prevent unverified artifacts from proceeding.

**Counterexample ruled out:** A fidelity verification that times out and allows the executable specification to proceed to execution. This is a fail-open verification and violates the axiom.

### Contract Completeness

**Statement:** Every agent call must execute under an execution contract that specifies required outputs, budget, permission scope, completion conditions, and designated output paths. An agent call without a contract is an uncontracted model call and must not be counted as pipeline execution.

**Rationale:** The distinction between a model call and an agent call is the contract. Without the contract, there is no basis for evaluating success or failure, and the call is invisible to the verification system.

**Counterexample ruled out:** An informal model call during a pipeline run that has no output spec, no budget, and no designated path. Its results are untraceable.

### Acceptance Criterion Derivation

**Statement:** The acceptance criterion of each verification kind must formally derive from the acceptance criterion of the verification kind downstream of it in the pipeline, or from the terminal acceptance condition of the deployed system. A verification whose acceptance criterion cannot be shown to derive from downstream acceptance carries the risk of local-acceptance drift.

**Rationale:** Pan et al.'s strongest negative finding. Adding a verification module degraded performance when its local acceptance criterion diverged from the benchmark's final acceptance. The canonical documented case: a verifier reported "solved" while the official evaluator failed the same instance. This axiom prevents that failure mode structurally by requiring formal derivation rather than informal alignment.

**Counterexample ruled out:** A fidelity verification that checks "does the executable specification look reasonable?" without defining "reasonable" in terms that persistence verification can continuously check. This verification's acceptance is local and undischarged.

**Status:** This axiom is stated but the derivation from persistence verification to fidelity verification and from fidelity verification to coherence verification is not yet formally specified. This is an open design problem.

### Orchestrator Minimality

**Statement:** The orchestrator agent must not perform substantive task work. Its role is coordination: delegating agent calls, collecting results, enforcing the runtime charter, and managing the durable state module. Substantive work belongs in worker agents.

**Rationale:** Empirically, the vast majority of compute in effective harness-driven systems occurs in delegated worker agents, not in the coordinating orchestrator. Orchestrator bloat increases cost without improving outcomes.

**Counterexample ruled out:** An orchestrator that directly executes compilation transformations instead of delegating them to workers.

### Elucidation Obligation

**Statement:** Every disposition event in the pipeline must produce an elucidation artifact. Inherited from SE-Onto without modification.

**Rationale:** Without elucidation, amendment processes after divergence detection must reconstruct context from memory — which the comprehension gap research predicts will fail at the conceptual tier.

### Harness Completeness

**Statement:** Every harness skill must satisfy the NLAH component checklist: contracts, roles, stage structure, adapters/scripts, state semantics, failure taxonomy. A harness skill that omits any component is incomplete and should not be deployed.

**Rationale:** An incomplete harness forces the runtime to improvise the missing component, introducing undocumented behavior that is invisible to verification and opaque to maintainers.

**Counterexample ruled out:** A harness skill that specifies roles and stage structure but has no failure taxonomy. When a tool error occurs, recovery behavior is undefined and unauditable.

---

## Slot Map: Where Future Mechanisms Go

When a new mechanism is proposed, the designer finds its categorical home before writing code.

| If the new mechanism is... | It is a... | It slots under... | It must satisfy... |
|---------------------------|-----------|------------------|-------------------|
| A new kind of pipeline artifact | Artifact | §Pipeline Layer, with tier designation | Lineage Completeness, tier assignment |
| A new compiler transformation kind | Compilation Transformation | §Compilation Transformations | Tier Descent, lineage emission |
| A new verification kind | Verification Process | §Verification Processes | Fail-Closed Verification, Acceptance Criterion Derivation |
| A new kind of contracted execution | Agent Call | §Agent Call | Contract Completeness |
| A new optimization over instruction text | Instruction Tuning | §Instruction Tuning | Structure-preserving, verification-bound |
| A new shared policy or enforcement rule | Runtime Charter content | §Runtime Charter | Non-negotiable, separable from harness skills |
| A new task-family control pattern | Harness Skill | §Harness Skill | Harness Completeness (NLAH checklist) |
| A new state persistence mechanism | Durable State Module extension | §Durable State Module | Three persistence properties + lineage integration |
| A new failure mode and recovery | Failure Taxonomy entry | §Failure Taxonomy | Named, recovery-mapped |
| A new prosthetic support mechanism | Knowing-State Prosthesis | §Knowing-State Prosthesis | Four implementation invariants |
| A new dependency-tracking structure | Assurance Graph extension | §Assurance Graph | Propagation-capable, continuously updated |
| A new agent role | Agent | §Agent Layer | One of: Orchestrator (minimality), Worker (contract-bound), Maintaining (knowing-state-bearing) |

---

## Open Problems

Problems the ontology names but does not solve.

**Fidelity-to-persistence derivation.** The Acceptance Criterion Derivation axiom requires each verification kind's criterion to derive from the downstream kind's. The formal derivation linking fidelity verification's criterion to persistence verification's criterion is not yet specified. Without it, fidelity verification carries the local-acceptance drift risk documented empirically.

**Instruction tuning and routing coupling.** Instruction tuning produces model-specific instruction text. The task router selects models. These must be coupled: the router should prefer models whose tuned instructions exist and perform best for a given node type. The coupling mechanism is not yet designed.

**Runtime charter extraction.** The runtime charter is currently distributed across multiple documents. Extracting it into a single artifact requires identifying which content is charter (shared, non-negotiable) versus harness (task-specific, composable). This is an editorial task with architectural consequences.

**Failure taxonomy population.** No existing harness skill ships with a failure taxonomy. Populating them requires analyzing actual failure modes from execution traces — which requires execution history that the bootstrap phase has not yet produced.

**Durable state implementation gap.** The durable state module is the highest-ROI component by empirical evidence and the largest implementation gap. Storage collections are designed; read-write paths through the pipeline are not built.

**Elucidation coverage.** The Elucidation Obligation axiom requires every disposition event to produce an elucidation artifact. Pipeline-internal decisions (compilation choices, routing selections, verification threshold applications) are not yet elucidated.

---

## Terminology Crosswalk

For maintainers who have read Pan et al. (2026):

| Pan et al. term | Factory term | Notes |
|----------------|-------------|-------|
| Natural-Language Agent Harness (NLAH) | Executable Specification (compiled) or Harness Skill (authored) | An executable specification is a compiled NLAH; a harness skill is an authored one |
| Intelligent Harness Runtime (IHR) | Orchestrator + Workers + Runtime Charter | Three-part decomposition adopted |
| Runtime skill | Runtime Charter | Shared, non-negotiable substrate |
| Harness skill | Harness Skill | Task-family-specific control logic |
| Agent call | Agent Call | Adopted directly with formalization |
| Execution contract (κ) | Execution Contract | Adopted directly |
| File-backed state module | Durable State Module | Adopted with two Factory-specific additions (lineage integration, verification visibility) |
| Failure taxonomy | Failure Taxonomy | Adopted directly |
| Backend | Cloud infrastructure substrate | Pan et al.'s "backend" = our compute layer |
| In-loop LLM | Worker agent | Their in-loop LLM interprets harness text; our workers execute executable specification nodes |
| Module ablation | Not applicable to verification processes | Verification processes are charter invariants, not composable modules |
| Self-evolution | Acceptance-gated retry (distinct concept) | Pan et al.'s self-evolution ≠ our bootstrap principle; different referents |

---

## Implementation Mapping

*This section is not part of the ontology. It records where the current codebase instantiates ontological categories. It will drift as the code changes and should be updated by maintainers, not by ontology revision.*

| Ontological category | Current implementation | Status |
|---------------------|----------------------|--------|
| Signal Artifact | `raw_signals` ArangoDB collection; Cloudflare Workers collect | Designed |
| Pressure Artifact | `specs/pressures/` directory; PressureSchema in `@factory/schemas` | Schema exists, directory empty |
| Capability Artifact | `specs/capabilities/`; CapabilitySchema | Schema exists, directory empty |
| Function Proposal | `specs/functions/` | Directory empty |
| Intent Specification | `specs/intent-specifications/` | Directory empty |
| Executable Specification | `specs/executable-specifications/`; Executable SpecificationSchema | Schema exists, directory empty |
| Invariant Specification | `specs/invariants/` | Directory empty |
| Verification Report | `specs/verification-reports/`; `@factory/schemas/coverage.ts` | Schema exists, directory empty |
| Lineage Edge | ArangoDB edge collection; `@factory/schemas/lineage.ts` | Schema exists |
| Decomposition | `packages/compiler/src/passes/` | Directory empty |
| Binding | `packages/compiler/src/passes/` | Directory empty |
| Obligation Extraction | `packages/compiler/src/passes/` | Directory empty |
| Structural Assembly | `packages/compiler/src/passes/` | Directory empty |
| Completeness Certification | `packages/compiler/src/passes/` | Directory empty |
| Coherence Verification | `packages/verification/` | Directory empty |
| Fidelity Verification | `packages/verification/` | Directory empty |
| Persistence Verification | `packages/runtime/` + Assurance Durable Object | Directory empty |
| Agent Call | Durable Object orchestration + pi SDK workers in Cloudflare Containers | Phase 5 spec exists |
| Orchestrator | Durable Object | Phase 5 spec exists |
| Worker | pi SDK agent in Cloudflare Container | Phase 5 spec exists |
| Runtime Charter | Distributed across ConOps, AGENTS.md, implicit conventions | Needs extraction |
| Harness Skill | `.agent/skills/*.SKILL.md` | Exists, needs split (charter vs. harness) |
| Durable State Module | ArangoDB Oasis (25+ collections designed) | Collections designed, read-write paths not built |
| Failure Taxonomy | Not implemented | Gap |
| Assurance Graph | `packages/assurance-graph/` | Directory empty |
| Instruction Tuning | Not implemented | Future |

---

## Predecessor Documents

This ontology draws on and is constrained by:

- Celestin, W. (2026). *A Formal Ontology of Specification-Execution Systems.* Draft 1.0.
- Celestin, W. (2026). *The Knowing-State Prosthesis.* Working paper.
- Celestin, W. (2026). *World Models and the Comprehension Gap.* Working paper.
- Pan, L., Zou, L., Guo, S., Ni, J., & Zheng, H.-T. (2026). *Natural-Language Agent Harnesses.* arXiv:2603.25723.
- Celestin, W. (2026). *Ontological Self-Sensing: Function Factory vs. Software 3.0.* Working analysis.

---

*End of document.*
