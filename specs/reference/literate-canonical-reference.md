# The Function Factory: A Literate Canonical Reference

**Author:** Wislet J. Celestin, Koales.ai / WeOps Research
**Date:** 22 April 2026
**Status:** Canonical architecture reference; literate programming document
**Version:** 1.0.0

> This document is a literate program in the sense of Donald Knuth (1984).
> The explanation is primary. Code blocks within the narrative are real,
> extractable, compilable TypeScript. The narrative explains WHY before
> showing WHAT. The ordering follows the reader's understanding path,
> not the compiler's import graph.
>
> **This document has three simultaneous roles:**
> 1. The architectural specification (what the system IS)
> 2. The refactoring brief (what the coding agent DOES)
> 3. The canonical reference (the truth when code and docs disagree)

---

## How to Read This Document

You are about to learn the Function Factory from the inside out. The journey follows
the path a human mind takes when understanding a system -- not the path a compiler
takes when resolving imports.

**Part I** answers: *What is a Function?* You cannot understand anything else until
you understand the canonical unit. A Function is not a programming language function.
It is a bounded, composable, governable, verifiable, monitorable unit of behavior.

**Part II** answers: *How does a Function come to exist?* Signals arrive from the
environment. They cluster into Pressures. Pressures map to Capabilities. Capabilities
reveal gaps. Gaps become Proposals. Proposals compile into WorkGraphs through eight
narrow passes. This is the specification pipeline.

**Part III** answers: *How does a Function get built?* The Dark Factory -- a five-role
agent topology -- executes the WorkGraph. This is the only stage that touches code.
The decision algebra D = (I,C,P,E,A,X,O,J,T) is the shared state.

**Part IV** answers: *How does a Function prove itself?* Acceptance review evaluates
scenario coverage over invariants. Deployment means the Function runs in a real
environment and stays running.

**Part V** answers: *How does a Function stay healthy?* Continuous monitoring runs
forever. The trust model composes five dimensions. Regression is detected when
trusted evidence is invalidated.

**Part VI** answers: *How does the Factory get smarter?* Drift signals feed back
into the specification pipeline. The loop closes. The Factory learns which
candidate families work and which do not. Policies evolve.

**Part VII** answers: *How does the code get organized?* Bounded contexts map to
packages. The 32-package inventory. The 6 new packages to build. Where each
function signature lives in the actual repo.

**Appendices** provide the type definitions, anti-corruption layers, and
instructions for the coding agent that will refactor the repo.

### Three Naming Principles

Every name in this document follows three principles confirmed by the principal:

1. **Names describe WHAT happens, not WHERE it goes.** Not
   `execution_prepareGate2Input` but `execution_bundleEvidenceForAcceptanceReview`.
   No jargon that requires external lookup.

2. **State machines are explicit typed artifacts.** The Function lifecycle is a
   typed transition table -- not implied by function call order. Each transition
   names its trigger and guard in plain language.

3. **Pipeline stages are typed data, not code sequences.** Each stage names: what
   context owns it, what goes in, what comes out, blocking or continuous. The
   pipeline array IS the documentation.

### Terminology Mapping

The source documents use "Gate 1", "Gate 2", "Gate 3". This document replaces
that terminology with descriptive guard names throughout:

| Old Name | New Name | What It Guards |
|----------|----------|---------------|
| Gate 1 | `structural_coverage_passed` | WorkGraph emission from the compiler |
| Gate 2 | `scenarios_cover_invariants` | Lifecycle transition from `produced` to `accepted` |
| Gate 3 | `evidence_base_intact` | Continuous health of monitored Functions |

---

## Part I -- What Is a Function?

### The Canonical Unit

The Function Factory produces one thing: Functions. Not features, not services,
not microservices, not capabilities. Functions.

A Function in this framework is not the same as a `function` in a programming
language, though it maps onto one cleanly. Every concept the Factory needs maps
into the word without distortion:

- A Function *executes* -- it takes inputs and produces outputs. That is what the
  Dark Factory builds.
- A Function is *composable* -- Functions chain into WorkGraphs, compose
  higher-order, participate in graphs of dependencies. That is what the compiler
  assembles.
- A Function is *testable* -- validations and invariants become signature
  constraints, preconditions, postconditions, and property-based checks. That is
  what verification proves.
- A Function is *governable* -- constraints, policies, and authority become
  parameters, domain restrictions, and typed contracts. That is what the control
  plane enforces.
- A Function is *monitorable* -- health, trust, freshness, and regression are all
  observable properties of a deployed Function. That is what the runtime closes
  the loop on.

A Function carries seven things:

```typescript
/**
 * The canonical unit of the Function Factory.
 * Aggregate root per whitepaper v4 Section 2.
 *
 * Every artifact the Factory produces is a Function.
 * Every artifact the Factory maintains is a Function.
 * When Functions degrade, the Factory produces new Functions.
 */
interface Function {
  /** What it is for, in compressed human-readable form. */
  intent: string;

  /** Signature, preconditions, postconditions, behavioral promises. */
  contract: Contract;

  /** Persistent truths it must preserve across all invocations. */
  invariants: Invariant[];

  /** Tests, scenarios, and property checks that prove contract and invariants hold. */
  validations: Validation[];

  /** The WorkGraph of nodes and edges that realizes it. */
  implementation: WorkGraph | null;

  /** Health, trust, freshness, incident links. */
  runtime_indicators: RuntimeIndicators;

  /** Current position in the lifecycle. */
  status: FunctionLifecycleState;
}
```

### The Lifecycle State Machine

A Function moves through a lifecycle. This lifecycle is not implied by function
call order -- it is an explicit typed transition table. Each state has a meaning.
Each transition has a trigger and a guard.

The states, in the order a Function typically passes through them:

- **designed** -- The Function has been proposed but no implementation exists.
  It is a specification waiting to be compiled.

- **planned** -- An Architect has approved the Function for implementation.
  Resources can be allocated.

- **in_progress** -- The Dark Factory (Stage 6) is actively building the Function.
  A WorkGraph is being executed.

- **produced** -- Stage 6 completed successfully. Code exists on disk. But the
  code has not yet proven that it covers its invariants.

- **accepted** -- Acceptance review passed. Scenarios cover invariants. Test pass
  rate is 100%. The Function is deployable but not yet monitored.

- **monitored** -- The Function is deployed and under continuous observation.
  Trust is being computed from live evidence.

- **regressed** -- A previously trusted Function has lost trust. Evidence that
  was valid is now invalid. Four regression classes exist: validation regression,
  runtime invariant regression, assurance regression (loss of visibility), and
  incident regression.

- **retired** -- The Function is no longer active. Its artifacts are archived.

```typescript
/**
 * The eight lifecycle states of a Function.
 * Ordered by typical progression, not by enum value.
 */
type FunctionLifecycleState =
  | "designed"
  | "planned"
  | "in_progress"
  | "produced"
  | "accepted"
  | "monitored"
  | "regressed"
  | "retired";
```

Now the transition table. Every legal transition is listed. If a transition is not
in this table, the implementation is wrong. The table IS the test oracle.

```typescript
/**
 * A lifecycle transition: from one state to another,
 * triggered by a named event, guarded by a named condition.
 *
 * Naming principle 2: the trigger and guard describe what happens
 * in plain language. "Gate 2" becomes "scenarios_cover_invariants".
 */
interface LifecycleTransition {
  from: FunctionLifecycleState;
  to: FunctionLifecycleState;
  trigger: string;
  guard: string;
  responsible_context: string;
}

/**
 * The complete transition table for Function lifecycle.
 * This array IS the specification. If a transition fires that
 * is not in this array, the implementation is wrong.
 */
const LIFECYCLE_TRANSITIONS: LifecycleTransition[] = [
  {
    from: "designed",
    to: "planned",
    trigger: "architect_approves_function",
    guard: "function_proposal_has_valid_invariants_and_contracts",
    responsible_context: "Governance",
  },
  {
    from: "planned",
    to: "in_progress",
    trigger: "dark_factory_admits_workgraph",
    guard: "candidate_passes_admissibility_filter",
    responsible_context: "Execution",
  },
  {
    from: "in_progress",
    to: "produced",
    trigger: "dark_factory_completes_execution",
    guard: "verifier_verdict_is_pass",
    responsible_context: "Execution",
  },
  {
    from: "produced",
    to: "accepted",
    trigger: "acceptance_review_passes",
    guard: "scenarios_cover_invariants",
    responsible_context: "Assurance",
  },
  {
    from: "accepted",
    to: "monitored",
    trigger: "function_deployed_to_runtime",
    guard: "deployment_confirmed_and_telemetry_flowing",
    responsible_context: "Observability",
  },
  {
    from: "monitored",
    to: "regressed",
    trigger: "trusted_evidence_invalidated",
    guard: "invariant_health_below_threshold_or_critical_invariant_broken",
    responsible_context: "Assurance",
  },
  {
    from: "monitored",
    to: "regressed",
    trigger: "evidence_base_lost",
    guard: "evidence_base_intact_fails",
    responsible_context: "Assurance",
  },
  {
    from: "regressed",
    to: "in_progress",
    trigger: "remediation_initiated",
    guard: "new_candidate_selected_or_existing_candidate_patched",
    responsible_context: "Execution",
  },
  {
    from: "regressed",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "no_dependent_functions_in_monitored_state",
    responsible_context: "Governance",
  },
  // Any state can transition to retired by architect decision
  {
    from: "designed",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
  {
    from: "planned",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
  {
    from: "produced",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
  {
    from: "accepted",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
];
```

Notice what this table enforces:

- A Function cannot skip from `designed` to `produced`. It must pass through
  `planned` (Architect approval) and `in_progress` (Dark Factory admission).

- A Function cannot reach `monitored` without passing acceptance review
  (`scenarios_cover_invariants`). This is the guard formerly called "Gate 2".

- Regression is not a terminal state. A regressed Function can re-enter
  `in_progress` through remediation.

- The Architect can retire any Function from any state. This is the escape
  valve for the entire system.

### What a Function Carries: The Supporting Types

A Function's contract defines its behavioral promises:

```typescript
/** CANONICAL-ONLY. Signature + preconditions + postconditions. */
interface Contract {
  id: string;
  signature: string;
  preconditions: string[];
  postconditions: string[];
  source_refs: SourceRef[];
}
```

A Function's invariants define persistent truths it must preserve. Each invariant
has a detector specification -- because an invariant without a detector is a wish,
not a guarantee:

```typescript
/** CANONICAL-ONLY. Persistent truth with runtime detection. */
interface Invariant {
  id: string;
  description: string;
  detector_spec: DetectorSpec;
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. Per-invariant runtime detector. */
interface DetectorSpec {
  /** Events that constitute a direct violation. */
  direct_rules: string[];
  /** Events that raise suspicion but are not violations. */
  warning_rules: string[];
  /** Telemetry and audit streams the detector reads. */
  evidence_sources: string[];
  /** How violations map to lifecycle transitions. */
  regression_policy: string;
}
```

A Function's validations are the tests that prove its invariants hold. Every
validation must map back to at least one atom, contract, or invariant it covers.
Validations that cover nothing are dead tests:

```typescript
/** CANONICAL-ONLY. Test/scenario with backmap to what it proves. */
interface Validation {
  id: string;
  description: string;
  /** Backmaps to atoms, contracts, or invariants. */
  covers: SourceRef[];
  source_refs: SourceRef[];
}
```

A Function's implementation is a WorkGraph -- a typed directed graph of nodes
and edges. A WorkGraph is NOT a Work Order. A WorkGraph is a Factory artifact
(I-layer); a Work Order is a WeOps artifact (We-layer). Conflating them erases
the I/We boundary:

```typescript
/** CANONICAL-ONLY. Compiled implementation graph. */
interface WorkGraph {
  id: string; // WG-*
  function_id: string;
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. A node in the WorkGraph. */
interface WorkGraphNode {
  id: string;
  type: NodeType;
  label: string;
}

/** CANONICAL-ONLY. An edge in the WorkGraph. */
interface WorkGraphEdge {
  from: string;
  to: string;
  label: string;
}

/** Nine WorkGraph node types. From ratified decisions lines 210-220. */
type NodeType =
  | "interface"
  | "domain_model"
  | "module"
  | "adapter"
  | "migration"
  | "test"
  | "docs"
  | "infra"
  | "refactor";
```

### Lineage: The Fundamental Primitive

Every artifact in the Factory references its source. This is non-negotiable #1
from the whitepaper. The `SourceRef` type is the lineage primitive:

```typescript
/** Lineage reference string. From ratified decisions line 338. */
type SourceRef = string;
```

Every type in this document that carries `source_refs: SourceRef[]` is participating
in the lineage chain. When you see `source_refs`, you are looking at the Factory's
audit trail. An artifact without `source_refs` is orphaned -- it cannot be traced
to the pressure that birthed it.

---

## Part II -- How Does a Function Come to Exist?

### The Specification Pipeline as Typed Data

A Function comes to exist through a pipeline. But this pipeline is not code that
executes in sequence -- it is *typed data* that describes what happens at each
stage. Naming principle 3: pipeline stages are typed data, not code sequences.

```typescript
/**
 * A pipeline stage: what context owns it, what goes in,
 * what comes out, whether it blocks or runs continuously.
 *
 * This array IS the documentation. If the implementation
 * executes stages in a different order, the implementation is wrong.
 */
interface PipelineStage {
  /** Numeric position in the pipeline. Sub-stages use decimals. */
  stage_number: number;
  /** Descriptive name (naming principle 1). */
  name: string;
  /** Which bounded context owns this stage. */
  context: string;
  /** What type flows in. */
  input: string;
  /** What type flows out. */
  output: string;
  /** Does this stage block the pipeline, or run continuously? */
  mode: "blocking" | "continuous";
  /** Which package(s) implement this stage. */
  packages: string[];
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    stage_number: 1,
    name: "normalize_environmental_signals",
    context: "Specification",
    input: "RawSignal[]",
    output: "Signal[]",
    mode: "blocking",
    packages: ["@factory/signal-hygiene"],
  },
  {
    stage_number: 2,
    name: "cluster_signals_into_pressures",
    context: "Specification",
    input: "Signal[]",
    output: "Pressure[]",
    mode: "blocking",
    packages: ["@factory/schemas"],
  },
  {
    stage_number: 3,
    name: "map_pressures_to_capabilities",
    context: "Specification",
    input: "Pressure[]",
    output: "Capability[]",
    mode: "blocking",
    packages: ["@factory/schemas"],
  },
  {
    stage_number: 4,
    name: "compute_capability_gaps_and_propose_functions",
    context: "Specification",
    input: "Capability[]",
    output: "FunctionProposal[]",
    mode: "blocking",
    packages: ["@factory/capability-delta"],
  },
  {
    stage_number: 4.5,
    name: "emit_architecture_candidates",
    context: "Architecture Search",
    input: "WorkGraph",
    output: "ArchitectureCandidate[]",
    mode: "blocking",
    packages: ["@factory/architecture-candidates"],
  },
  {
    stage_number: 4.75,
    name: "select_optimal_candidate",
    context: "Architecture Search",
    input: "ArchitectureCandidate[]",
    output: "ArchitectureCandidate + CandidateSelectionReport",
    mode: "blocking",
    packages: ["@factory/candidate-selection"],
  },
  {
    stage_number: 5,
    name: "compile_proposals_through_eight_narrow_passes",
    context: "Specification",
    input: "FunctionProposal[]",
    output: "WorkGraph[] + CoverageReport[]",
    mode: "blocking",
    packages: ["@factory/prd-authoring", "@factory/compiler"],
  },
  {
    stage_number: 5.5,
    name: "evaluate_structural_coverage",
    context: "Assurance",
    input: "CompilerIntermediates",
    output: "CoverageReport",
    mode: "blocking",
    packages: ["@factory/coverage-gates"],
  },
  {
    stage_number: 5.75,
    name: "review_semantic_correctness",
    context: "Assurance",
    input: "PRD + WorkGraph",
    output: "SemanticReviewReport",
    mode: "blocking",
    packages: ["@factory/semantic-review"],
  },
  {
    stage_number: 6,
    name: "execute_workgraph_through_dark_factory",
    context: "Execution",
    input: "DecisionState (D0)",
    output: "Stage6TraceLog + RoleAdherenceReport",
    mode: "blocking",
    packages: ["@factory/stage-6-coordinator"],
  },
  {
    stage_number: 7,
    name: "observe_deployed_functions",
    context: "Observability",
    input: "Stage6TraceLog + runtime telemetry",
    output: "Observation[]",
    mode: "continuous",
    packages: ["@factory/observability-feedback"],
  },
  {
    stage_number: 7.25,
    name: "reinject_observations_as_signals",
    context: "Observability",
    input: "Observation[]",
    output: "Signal[]",
    mode: "blocking",
    packages: ["@factory/signal-hygiene"],
  },
  {
    stage_number: 8,
    name: "recalibrate_pressure_weights",
    context: "Adaptation",
    input: "Observation[] + current weights",
    output: "RecalibratedPressure[]",
    mode: "blocking",
    packages: ["@factory/adaptive-recalibration"],
  },
  {
    stage_number: 8.5,
    name: "correct_candidate_selection_bias",
    context: "Adaptation",
    input: "candidate lineage",
    output: "BiasReport",
    mode: "blocking",
    packages: ["@factory/selection-bias"],
  },
  {
    stage_number: 9,
    name: "detect_policy_stress",
    context: "Governance",
    input: "GovernanceMetrics",
    output: "PolicyStressReport",
    mode: "blocking",
    packages: ["@factory/meta-governance"],
  },
  {
    stage_number: 10,
    name: "activate_or_rollback_policies",
    context: "Governance",
    input: "PolicyStressReport + BiasReport",
    output: "PolicyAction[]",
    mode: "blocking",
    packages: ["@factory/policy-activation"],
  },
];
```

### Stage 1: Signals Arrive

The pipeline begins with raw evidence from the world. A Signal is not yet a
problem. It is raw material. Normalization ensures signals are comparable by
applying a canonical schema:

```typescript
/** CANONICAL-ONLY. Normalized signal envelope. */
interface Signal {
  id: string; // SIG-*
  source: string;
  timestamp: string;
  confidence: Score;
  severity: "low" | "medium" | "high" | "critical";
  frequency: number;
  entity_tags: string[];
  content: string;
  source_refs: SourceRef[];
}

/** 0-1 bounded score. From ratified decisions line 259. */
type Score = number;
```

The normalization function takes raw input with arbitrary shapes and produces
typed Signals. No interpretation occurs -- only schema conformance:

```typescript
/**
 * Stage 1: Normalize raw signals into canonical schema.
 * Pure function. No interpretation, only conformance.
 */
declare function specification_normalizeSignals(
  raw: ReadonlyArray<{
    source: string;
    content: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
  }>
): Signal[];
```

### Stage 2: Signals Cluster into Pressures

Signals cluster into Pressures. A Pressure is a forcing function -- the `F(t)` term
in a driven dynamical system. It is not a feature, a requirement, or a project. It
is the organization's felt experience compressed into structured forcing:

```typescript
/** CANONICAL-ONLY. Forcing function on the organization. */
interface Pressure {
  id: string; // PRS-*
  category:
    | "growth"
    | "retention"
    | "reliability"
    | "compliance"
    | "risk"
    | "efficiency"
    | "competitive_gap"
    | "trust";
  strength: Score;
  urgency: Score;
  frequency: number;
  confidence: Score;
  source_refs: SourceRef[];
}
```

### Stage 3: Pressures Map to Capabilities

A Capability is the organization's durable ability to respond to a Pressure.
Three guardrails are enforced: (1) do not jump from signal to feature, (2)
every capability yields execution, control, and evidence Functions, (3)
merge top-down and bottom-up proposals:

```typescript
/** CANONICAL-ONLY. Organizational ability to respond. */
interface Capability {
  id: string; // BC-*
  name: string;
  function_types: {
    execution: string[];
    control: string[];
    evidence: string[];
  };
  source_refs: SourceRef[];
}
```

### Stage 4: Capability Delta and Function Proposals

For each capability, the Factory computes what is missing, degraded, or
underutilized. The delta generates typed Function proposals:

```typescript
/** CANONICAL-ONLY. Gap between required and existing capability. */
interface CapabilityDelta {
  capability_id: string;
  missing: string[];
  degraded: string[];
  underutilized: string[];
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. Candidate Function with type and constraints. */
interface FunctionProposal {
  id: string; // FP-*
  type: "execution" | "control" | "evidence" | "integration";
  expected_inputs: string[];
  expected_outputs: string[];
  governing_constraints: string[];
  candidate_invariants: string[];
  success_signals: string[];
  source_refs: SourceRef[];
}
```

### Stage 5: The Compiler

Each Function proposal gets drafted into a PRD and compiled through eight narrow
passes. This is non-negotiable #2: each pass does exactly one thing. Collapsing
passes destroys debuggability.

```typescript
/** CANONICAL-ONLY. Product Requirements Document. */
interface PRD {
  id: string; // PRD-*
  function_id: string;
  title: string;
  atoms: Atom[];
  contracts: Contract[];
  invariants: Invariant[];
  validations: Validation[];
  dependencies: Dependency[];
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. Single requirement extracted by Pass 2. */
interface Atom {
  id: string;
  content: string;
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. Inter-node dependency from Pass 5. */
interface Dependency {
  from_node: string;
  to_node: string;
  source_refs: SourceRef[];
}
```

The eight passes form a Pipe-and-Filter pipeline (ADR-001). Each pass is a pure
function (Functional Core / Imperative Shell, ADR-004):

```typescript
/** Pass 0: Normalize PRD text, resolve ambiguity, fail closed. */
declare function specification_pass0_normalize(prd: PRD): PRD;

/** Pass 2: Extract requirement atoms. One atom = one semantic claim. */
declare function specification_pass2_extractAtoms(prd: PRD): Atom[];

/** Pass 3: Derive contracts (signature, preconditions, postconditions). */
declare function specification_pass3_deriveContracts(
  prd: PRD,
  atoms: ReadonlyArray<Atom>
): Contract[];

/** Pass 4: Derive invariants with detector specs. */
declare function specification_pass4_deriveInvariants(
  prd: PRD,
  atoms: ReadonlyArray<Atom>,
  contracts: ReadonlyArray<Contract>
): Invariant[];

/** Pass 5: Derive dependencies between nodes. */
declare function specification_pass5_deriveDependencies(
  prd: PRD,
  contracts: ReadonlyArray<Contract>
): Dependency[];

/** Pass 6: Derive validations with backmaps to atoms/contracts/invariants. */
declare function specification_pass6_deriveValidations(
  prd: PRD,
  atoms: ReadonlyArray<Atom>,
  contracts: ReadonlyArray<Contract>,
  invariants: ReadonlyArray<Invariant>
): Validation[];

/** Pass 7: Consistency check -- produces CoverageReport. */
declare function specification_pass7_consistencyCheck(
  intermediates: CompilerIntermediates
): CoverageReport;

/** Pass 8: Assemble WorkGraph. Only runs if structural_coverage_passed. */
declare function specification_pass8_assembleWorkGraph(
  prd: PRD,
  intermediates: CompilerIntermediates
): WorkGraph;
```

The compiler intermediates bundle all pass outputs:

```typescript
/** CANONICAL-ONLY. All pass outputs bundled for cross-pass reference. */
interface CompilerIntermediates {
  prd: PRD;
  atoms: Atom[];
  contracts: Contract[];
  invariants: Invariant[];
  dependencies: Dependency[];
  validations: Validation[];
}
```

### The Structural Coverage Guard (formerly "Gate 1")

Between Pass 7 and Pass 8, the structural coverage guard runs. This is the
cheapest gate -- it catches specification defects before any code is generated.

Four checks, all required, all fail-closed:

1. **Atom coverage** -- every PRD atom has at least one downstream artifact
   (contract, invariant, or validation). Atoms with no downstream are dead spec.

2. **Invariant coverage** -- every invariant has at least one validation AND at
   least one detector spec. An invariant without both is a wish, not a guarantee.

3. **Validation coverage** -- every validation backmaps to at least one atom,
   contract, or invariant. Validations that cover nothing are dead tests.

4. **Dependency closure** -- every dependency resolves to two WorkGraph-resident
   endpoints. Dangling dependencies mean the graph is incomplete.

```typescript
/** CANONICAL-ONLY. Output of any coverage evaluation. */
interface CoverageReport {
  id: string; // CR-*
  function_id: string;
  gate: "compile" | "simulation" | "assurance";
  atom_coverage: boolean;
  invariant_coverage: boolean;
  validation_coverage: boolean;
  dependency_closure: boolean;
  overall: "pass" | "fail";
  failures: CoverageFailure[];
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. A specific coverage failure. */
interface CoverageFailure {
  artifact_id: string;
  reason: string;
  source_ref: SourceRef;
}
```

The guard function:

```typescript
/**
 * Stage 5.5: Evaluate structural coverage.
 * Runs between Pass 7 and Pass 8.
 *
 * FAIL-CLOSED: if any check fails, WorkGraph is not emitted.
 * The PRD must be remediated upstream.
 *
 * IMPORTANT: structural_coverage_passed is STRUCTURAL, not SEMANTIC.
 * A PRD can pass all four checks and still be conceptually wrong.
 * That is why Semantic Review (Stage 5.75) exists.
 */
declare function assurance_evaluateStructuralCoverage(
  intermediates: CompilerIntermediates
): CoverageReport;
```

### Semantic Review (Stage 5.75)

Between the structural coverage guard and Pass 8, the Semantic Review runs.
This addresses a proven limitation: structural coverage passing does not imply
conceptual correctness. The HARNESS-EXECUTE retraction proved that a PRD can
pass all four structural checks and still be conceptually wrong.

```typescript
/** CANONICAL-ONLY. Semantic Review output. */
interface SemanticReviewReport {
  id: string; // SRR-*
  prd_id: string;
  workgraph_id: string;
  status: "approved" | "rejected" | "needs_revision";
  rationale: string;
  source_refs: SourceRef[];
}

/**
 * Stage 5.75: Review semantic correctness.
 *
 * In Bootstrap mode: human-in-the-loop (Architect reviews).
 * In Steady-State: LLM-driven evaluation.
 *
 * FAIL-CLOSED: rejected or needs_revision blocks WorkGraph emission.
 */
declare function assurance_reviewSemanticCorrectness(
  prd: PRD,
  workGraph: WorkGraph
): SemanticReviewReport;
```

### The Specification Pipeline Composed

The entire specification pipeline, from raw signals to compiled WorkGraphs:

```typescript
/**
 * The Specification Context's primary operation.
 *
 * Runs: Signals -> Pressures -> Capabilities -> Deltas ->
 *       Proposals -> PRDs -> Compile (8 passes) ->
 *       structural_coverage_passed -> Semantic Review ->
 *       WorkGraph emission
 *
 * Returns only WorkGraphs that pass both guards.
 */
declare function specification_compilePipeline(
  signals: ReadonlyArray<Signal>
): {
  workGraphs: WorkGraph[];
  coverageReports: CoverageReport[];
  prds: PRD[];
};
```

---

## Part III -- How Does a Function Get Built?

### Architecture Search: Picking the Right Model Configuration

Before the Dark Factory can build a Function, the Factory must decide HOW to
build it. Which models for which roles? What topology? What tool permissions?

This is the Architecture Search context. It takes a WorkGraph and produces an
ArchitectureCandidate -- a complete configuration for how Stage 6 will execute.

The ArchitectureCandidate is one of the most important types in the Factory.
It specifies everything about HOW the Dark Factory will work:

```typescript
/**
 * Complete configuration for a Dark Factory execution.
 * From ratified decisions lines 342-367.
 *
 * Immutable after emission. Downstream outcomes belong in
 * lineage artifacts, not mutable candidate fields.
 */
interface ArchitectureCandidate {
  id: string; // AC-*
  schema_version: string;
  created_at: string;
  source_refs: SourceRef[];

  /** Fingerprint of the WorkGraph this candidate was generated for. */
  workgraph_fingerprint: string;

  /** Which routing rules produced this candidate. */
  routing_rule_refs: RoutingRuleRef[];

  /** Was this candidate explicitly configured or inferred from defaults? */
  explicitness: "explicit" | "inferred";

  // -- Design intent --

  /** Which of the 7 valid role topologies to use. */
  topology: RoleTopology;

  /** Which model to use for each role. */
  model_binding: Record<RoleName, ModelIdentifier>;

  /** How many samples, critique rounds, repair loops, etc. */
  inference_config: InferenceConfig;

  /** What tools each role is allowed to use. */
  tool_policy: ToolPolicy;

  /** When to stop: first pass, verifier required, trace complete. */
  convergence_policy: ConvergencePolicy;

  /** Which node type in the WorkGraph this candidate targets. */
  node_type_applied: NodeType;

  /** Conditions under which this candidate is applicable. */
  applicability_conditions: string[];

  /** Human-readable explanation of why this configuration was chosen. */
  rationale: string;

  // -- Evaluation snapshot --

  /** Six binary admissibility checks. All must pass. */
  hard_filter_results: HardFilterResults;

  /** Nine-axis weighted scoring. Null before evaluation. */
  objective_scores: ObjectiveScores | null;

  // -- Selection state --

  /** Was this candidate selected? */
  selected: boolean;

  /** Why was it selected (or not)? */
  selection_reason?: string;

  /** If this candidate replaces another, which one? */
  supersedes_candidate_id?: string | null;
}
```

The supporting types for the candidate:

```typescript
/** Five Stage 6 roles. From ratified decisions lines 202-208. */
type RoleName = "planner" | "coder" | "critic" | "tester" | "verifier";

/** Valid five-role configurations. From ratified decisions lines 222-230. */
type RoleTopology =
  | "planner_coder_critic_tester_verifier"
  | "planner_coder_tester_verifier"
  | "planner_coder_critic_verifier"
  | "planner_coder_verifier"
  | "planner_coder_pair_verifier"
  | "planner_parallel_coders_verifier"
  | "planner_coder_critic_parallel_tester_verifier";

/** Provider + model + optional version. From ratified decisions lines 261-265. */
interface ModelIdentifier {
  provider: string;
  model: string;
  version?: string;
}

/** Routing table + rule reference. From ratified decisions lines 332-336. */
interface RoutingRuleRef {
  table_id: string;
  table_version: string;
  rule_id: string;
}
```

#### Two-Stage Candidate Selection

Candidate selection is two stages -- not one. Admissibility is a boundary
condition, not an optimization preference. You do not trade hard-constraint
compliance against latency.

**Stage A -- Admissibility Filter.** Six binary checks, all must pass:

```typescript
/** Six binary admissibility checks. From ratified decisions lines 307-315. */
interface HardFilterResults {
  hard_constraint_compliance: ComplianceVerdict;
  scope_compliance: ComplianceVerdict;
  role_policy_compliance: ComplianceVerdict;
  trace_completeness: ComplianceVerdict;
  compile_viability: ComplianceVerdict;
  admissible: boolean;
  failure_reasons: string[];
}

type ComplianceVerdict = "pass" | "fail" | "unknown";
```

**Stage B -- Nine-axis weighted scoring** over admissible candidates:

```typescript
/** Nine scoring axes with weights. From ratified decisions lines 247-259. */
type ObjectiveAxis =
  | "correctness_proxy"       // 0.30
  | "test_pass_rate"          // 0.20
  | "regression_avoidance"    // 0.15
  | "compile_success_robustness" // 0.10
  | "lineage_reliability"    // 0.10
  | "latency_efficiency"     // 0.05
  | "token_cost_efficiency"  // 0.04
  | "patch_economy"          // 0.03
  | "consistency_with_past_choices"; // 0.03

interface ObjectiveScores {
  per_axis: Record<ObjectiveAxis, Score>;
  weighted_total: Score;
  weights: Record<ObjectiveAxis, Score>;
}
```

The cold-start policy for `lineage_reliability` prevents pseudo-precision:
- Fewer than 5 observations: axis excluded, remaining weights renormalized
- 5 to 19 observations: shrunk estimate blending neutral prior (0.50) with observed
- 20+ observations: full configured weight

```typescript
/**
 * Cold-start lineage blending. From ratified decisions.
 * Prevents fake precision when evidence is scarce.
 */
function blendedLineageReliability(
  observed: number,
  n: number,
  prior: number = 0.5,
  k: number = 10
): number {
  return ((prior * k) + (observed * n)) / (k + n);
}
```

The complete Architecture Search pipeline:

```typescript
/**
 * Architecture Search: emit candidates, filter, score, select.
 *
 * YAML decides what families are plausible.
 * TypeScript decides how they are evaluated.
 * Lineage decides how much the past should matter.
 * Acceptance review decides whether the result is accepted.
 */
declare function search_selectCandidate(
  workGraph: WorkGraph,
  routingTablePath: string,
  lineageObservationCounts: Record<string, number>
): {
  selected: ArchitectureCandidate;
  report: CandidateSelectionReport;
};

/** From ratified decisions lines 769-781. */
interface CandidateSelectionReport {
  selected_candidate_id: string;
  workgraph_id: string;
  evaluated_candidates: number;
  admissible_candidates: number;
  selection_reason: string;
  runner_up_id: string | null;
  scoring_details: ObjectiveScores;
  evaluated_at: string;
}
```

### The Dark Factory: Five Roles, One Shared State

Now the reader knows what a Function IS (Part I), how it gets SPECIFIED (Part II),
and how the Factory picks the right model configuration (above). The Dark Factory
is where code gets written.

The Dark Factory operates a fixed topology of five roles. Each role is a typed
partial transformation over shared state. Roles do not share memory, hidden
assumptions, or cross-cutting ambient context. They behave like small pure
functions over shared state.

#### The Decision Algebra as Shared State

The shared state is the decision algebra D = (I,C,P,E,A,X,O,J,T) from the
cognitive runtime paper. Each element maps to concrete Factory types:

```typescript
/**
 * The decision algebra as Stage 6's shared state.
 *
 * CANONICAL-ONLY. From integration whitepaper Section 3.
 *
 * Each role reads a subset of this state and writes a subset.
 * Write-domain discipline is enforced: a role that writes to
 * a field it does not own triggers a WriteDomainViolation.
 */
interface DecisionState {
  /** I (Intent): what the Function is for. Set once at D0. */
  intent: {
    prd_id: string;
    title: string;
    contracts: Contract[];
    invariants: Invariant[];
  };

  /** C (Context): operational state the role must act within. Set at D0, enriched by Planner. */
  context: {
    work_graph: WorkGraph;
    target_node_ids: string[];
    edit_scopes: string[];
    repo_context: string;
  };

  /** P (Policy): constraints governing this execution. Set at D0, immutable during execution. */
  policy: {
    convergence_policy: ConvergencePolicy;
    tool_policy: ToolPolicy;
    model_binding: Record<RoleName, ModelIdentifier>;
  };

  /** E (Evidence): observations accumulated during execution. Append-only. */
  evidence: {
    validation_outcomes: ValidationOutcome[];
    tool_results: ToolCallRecord[];
    critique: string | null;
  };

  /** A (Authority): scope and constraint boundaries. Written by Verifier only. */
  authority: {
    scope_violation: boolean;
    hard_constraint_violation: boolean;
  };

  /** X (Action): role outputs. Each role writes its own field. */
  action: {
    plan: string | null;
    patch_proposals: string[];
    validation_plan: string | null;
  };

  /** O (Outcome): terminal decision. Written by Verifier only. */
  outcome: TerminalDecision | null;

  /** J (Justification): trace record. Append-only. */
  justification: {
    role_iterations: RoleIterationRecord[];
    tool_calls: ToolCallRecord[];
    resample_tree: ResampleNode[];
  };

  /** T (Time): iteration tracking. Increment-only. */
  temporal: {
    repair_loop_count: number;
    max_repair_loops: number;
    iteration_timestamps: string[];
  };
}
```

#### The Five Roles: What Each One Reads and Writes

Write-domain enforcement is not a prompt instruction -- it is a structural
property of the state model. Each role's read and write sets are declared:

| Role | Reads | Writes |
|------|-------|--------|
| **Planner** | intent, context, policy, evidence.validation_outcomes | action.plan |
| **Coder** | action.plan, context, policy, evidence | action.patch_proposals |
| **Critic** | action.plan, action.patch_proposals, context, intent | evidence.critique |
| **Tester** | action.plan, action.patch_proposals, evidence.critique, context | action.validation_plan, evidence.validation_outcomes |
| **Verifier** | action.plan, action.patch_proposals, evidence, temporal, authority, policy | outcome, authority.scope_violation, authority.hard_constraint_violation |

The enforcement function:

```typescript
/**
 * Enforce write-domain discipline. Throws on unauthorized writes.
 *
 * CEF paper Section 2.4: "Nodes may not silently alter policy
 * or authority unless explicitly designated as such."
 */
declare function execution_enforceWriteDomain(
  role: RoleName,
  currentState: DecisionState,
  proposedUpdate: Partial<DecisionState>
): void;
```

#### The Anti-Corruption Layer: Building D0

Before the repair loop can start, the shared state must be initialized. The
ACL translates upstream artifacts into DecisionState D0:

```typescript
/**
 * ACL: Specification + Search -> Execution.
 * Build the initial DecisionState (D0) from upstream artifacts.
 *
 * Pure function. No side effects. Trivially testable.
 * Given input A, expect output B. No mocking required.
 *
 * Maps the nine algebra elements:
 *   I <- PRD title + contracts + invariants
 *   C <- WorkGraph + targetNodeIds + editScopes + repoContext
 *   P <- Candidate's convergence_policy + tool_policy + model_binding
 *   E <- empty at D0
 *   A <- Candidate scope constraints
 *   X <- empty at D0
 *   O <- empty at D0
 *   J <- empty at D0
 *   T <- { repair_loop_count: 0, max_repair_loops: from candidate }
 */
declare function execution_buildInitialDecisionState(
  workGraph: WorkGraph,
  candidate: ArchitectureCandidate,
  prd: PRD
): DecisionState;
```

#### The Repair Loop

The repair loop runs the five-role topology until convergence or bounds are
exceeded. This is a Saga pattern (ADR-003): each role iteration is a saga step,
and the Verifier's verdict determines the saga outcome.

```typescript
/**
 * The repair loop sub-graph:
 *
 *   candidate_start -> planner -> coder -> critic -> tester -> verifier
 *   -> route_after_verifier:
 *      pass -> candidate_done
 *      patch -> coder (Coder revises; compensation)
 *      resample -> planner (new candidate; abort + restart)
 *      interrupt -> human_gate (escalation)
 *      fail -> candidate_failed (abort)
 */
declare function execution_runRepairLoop(
  initialState: DecisionState,
  candidate: ArchitectureCandidate
): {
  finalState: DecisionState;
  traceLog: Stage6TraceLog;
};
```

#### Decision-Conditioned Escalation at the Verifier

The Verifier makes the most consequential decision in Stage 6. Rather than a
binary `requiresHumanApproval` flag, DCE provides a continuous calibrated score:

```typescript
/**
 * DCE composite escalation score.
 *
 * S_esc(z) = w_H * H_hat(X|z) + w_M * (1 - M(z)) + w_E * U_epistemic(z)
 *            + w_C * 1[|Gamma_alpha(z)| > 1] + w_R * R(z) - w_V * C_local(z)
 *
 * Default weights: w_H=0.25, w_M=0.20, w_E=0.20, w_C=0.00 (v1), w_R=0.25, w_V=0.10
 * Default thresholds: tau_local=0.30, tau_frontier=0.60, tau_human=0.85
 *
 * Routing:
 *   S_esc < tau_local       -> autonomous action (pass or patch)
 *   tau_local <= < tau_frontier -> candidate resampling
 *   tau_frontier <= < tau_human -> Architect semantic review
 *   S_esc >= tau_human      -> mandatory human approval
 */
declare function execution_evaluateEscalationScore(
  state: DecisionState,
  verifierPosterior: Record<string, number>,
  policyWeights: {
    w_H: number; w_M: number; w_E: number;
    w_C: number; w_R: number; w_V: number;
  },
  thresholds: {
    tau_local: number; tau_frontier: number; tau_human: number;
  }
): TerminalDecision;
```

The three disagreement classes -- when the Verifier passes but acceptance review
fails:

```typescript
/**
 * Three classes of disagreement between Verifier and acceptance review.
 * From ratified decisions.
 */
type DisagreementClass =
  | "repairable_local"  // narrow defect, current candidate reusable
  | "architectural"     // wrong candidate family, new selection required
  | "governance";       // scope conflict, human required
```

#### What Stage 6 Produces

Stage 6 produces two artifacts: a Stage6TraceLog (complete execution record)
and a RoleAdherenceReport (post-hoc validation of write-domain discipline).

```typescript
/**
 * Complete execution record. From ratified decisions lines 424-452.
 * Every role iteration, every tool call, every resample branch.
 */
interface Stage6TraceLog {
  run_id: string;
  function_id: string;
  prd_id: string;
  workgraph_id: string;
  candidate_id: string; // AC-*
  harness_command: string;
  prompt_pack_version: string;
  started_at: string;
  completed_at?: string;
  repair_loop_count: number;
  max_repair_loops: number;
  scope_violation: boolean;
  hard_constraint_violation: boolean;
  resample_tree: ResampleNode[];
  role_iterations: RoleIterationRecord[];
  tool_calls: ToolCallRecord[];
  validation_outcomes: ValidationOutcome[];
  generated_artifact_paths: string[];
  terminal_decision: TerminalDecision;
}
```

The subordinate types within Stage6TraceLog:

```typescript
/** From ratified decisions lines 382-392. */
interface RoleIterationRecord {
  role: RoleName;
  branch_id: string;
  iteration_index: number;
  started_at: string;
  completed_at?: string;
  read_fields: string[];
  write_fields: string[];
  output_artifact_paths: string[];
  summary?: string;
}

/** From ratified decisions lines 373-380. */
interface ToolCallRecord {
  at: string;
  role: RoleName;
  tool_name: string;
  args_digest: string;
  outcome: "success" | "failure" | "blocked";
  notes?: string;
}

/** From ratified decisions lines 394-400. */
interface ResampleNode {
  branch_id: string;
  parent_branch_id: string | null;
  candidate_id: string; // AC-*
  reason: string;
  status: "spawned" | "completed" | "abandoned";
}

/** From ratified decisions lines 416-422. */
interface TerminalDecision {
  verdict: TerminalVerdict;
  rationale: string;
  requires_human_approval: boolean;
  human_approval_payload: HumanApprovalPayload | null;
  disagreement_class?: DisagreementClass | null;
}

type TerminalVerdict =
  | "pass"
  | "patch-exhausted"
  | "resample-exhausted"
  | "interrupt"
  | "fail";

/** From ratified decisions lines 410-414. */
interface ValidationOutcome {
  name: string;
  status: "pass" | "fail" | "skipped";
  details?: string;
}

/** From ratified decisions lines 402-408. */
interface HumanApprovalPayload {
  reason: string;
  scope_violation: boolean;
  hard_constraint_violation: boolean;
  requested_action: "approve" | "reject" | "amend";
  notes?: string;
}
```

The RoleAdherenceReport checks four contract surfaces per role:

```typescript
/** From ratified decisions lines 475-486. */
interface RoleAdherenceReport {
  id: string; // RAR-*
  run_id: string;
  function_id: string;
  workgraph_id: string;
  generated_at: string;
  semantic_intent_unverified: true; // always true -- semantic intent needs Semantic Review
  roles: RoleAdherenceEntry[];
  overall_verdict: ComplianceVerdict;
}

interface RoleAdherenceEntry {
  role: RoleName;
  checks: ContractSurfaceCheck[];
  overall_verdict: ComplianceVerdict;
}

interface ContractSurfaceCheck {
  surface: ContractSurface;
  verdict: ComplianceVerdict;
  violations: string[];
}

type ContractSurface =
  | "read_access"
  | "write_access"
  | "do_not"
  | "output_semantics";
```

#### CEF / Pi-AI Model Selection

The Factory delegates to the minimum-sufficient model per role. It never touches
provider APIs directly -- that is a governance violation. The pi-ai unified model
abstraction provides `getModel(modelId, options)`:

```typescript
/**
 * Per-role model configuration within a candidate.
 * From package-contracts Section 3.2.
 */
interface RoleModelBinding {
  role: RoleName;
  modelId: string;
  thinkingLevel: "none" | "low" | "medium" | "high" | "max";
  thinkingBudget?: { maxTokens: number; reservedPrefill: number };
  temperature: number;
  maxTokens: number;
}

/**
 * Complete model binding for a candidate execution.
 */
interface ProductionModelBinding {
  bindings: RoleModelBinding[];
  fallback: ModelIdentifier;
  costCeiling: number;
}
```

The tool policy controls what each role can do:

```typescript
/** Nine tool categories. From ratified decisions lines 272-282. */
interface ToolPolicy {
  read_repo: ToolPermission;
  write_repo: ToolPermission;
  run_tests: ToolPermission;
  run_build: ToolPermission;
  search_code: ToolPermission;
  read_filesystem: ToolPermission;
  write_filesystem: ToolPermission;
  network_access: ToolPermission;
  shell_command: ToolPermission;
}

interface ToolPermission {
  allowed: boolean;
  notes?: string;
}
```

The inference configuration controls iteration bounds:

```typescript
/** From ratified decisions lines 284-297. */
interface InferenceConfig {
  samples_per_role: Record<RoleName, number>;
  critique_round_count: number;
  ranking_strategy: "single_best" | "majority_vote" | "scored_ranking";
  verification_depth: "light" | "standard" | "deep";
  patch_iteration_cap: number;
  max_repair_loops: number;
}

/** From ratified decisions lines 299-305. */
interface ConvergencePolicy {
  stop_on_first_pass: boolean;
  require_verifier_pass: boolean;
  require_trace_completeness: boolean;
  max_candidate_evaluations: number;
  max_resample_branches: number;
}
```

### The Execution Context's Primary Operation

The Execution Context composes all of the above into a single operation:

```typescript
/**
 * The Execution Context's primary operation.
 *
 * Given a WorkGraph, ArchitectureCandidate, and PRD:
 *   1. Build initial DecisionState (D0) via ACL
 *   2. Admit to runtime (check candidate admissibility, resources, policy)
 *   3. Run the repair loop (five-role topology with DCE at Verifier)
 *   4. Generate RoleAdherenceReport (post-hoc write-domain validation)
 *   5. Bundle evidence for acceptance review via ACL
 *
 * This function does NOT evaluate acceptance review -- that belongs
 * to the Assurance Context. The boundary is the Gate2Input ACL.
 */
declare function execution_runDarkFactory(
  workGraph: WorkGraph,
  candidate: ArchitectureCandidate,
  prd: PRD
): {
  traceLog: Stage6TraceLog;
  adherenceReport: RoleAdherenceReport;
  gate2Input: Gate2Input;
};
```

### LangGraph.js State Partitioning

The DecisionState D is partitioned across LangGraph.js state channels. Each
channel has a reducer that governs concurrent updates. This partitioning makes
write-domain enforcement structural rather than behavioral:

```
LangGraph.js StateGraph channels:
  intent:         SetOnceReducer<SpecEnvelope>        -- immutable after D0
  context:        SetOnceReducer<ExecutionContext>     -- enriched once by Planner
  policy:         SetOnceReducer<ExecutionPolicy>      -- immutable during execution
  evidence:       AppendReducer<EvidenceAccumulator>   -- each role appends
  authority:      LastWriteReducer<AuthorityEnvelope>  -- Verifier writes
  action:         MergeReducer<ActionProposals>        -- role-specific partial updates
  outcome:        LastWriteReducer<TerminalDecision>   -- Verifier writes terminal
  justification:  AppendReducer<TraceAccumulator>      -- each role iteration appends
  temporal:       IncrementReducer<TemporalState>      -- repair loop counter
```

The reducers enforce discipline:

- **SetOnceReducer**: throws if written after initialization. Protects I, C, P.
- **AppendReducer**: new data appends to existing. Never overwrites. Protects E, J.
- **LastWriteReducer**: most recent write wins. Used for A, O (Verifier only).
- **MergeReducer**: partial updates merge into the existing object. Protects X.
- **IncrementReducer**: only increments are valid. Protects T.

Each role iteration's read/write record is a partial decision state diff: D_before
and D_after. Stage 6 replay becomes algebraic verification:

  D_final = N_m . N_{m-1} . ... . N_1(D_0)

where each N_k is a role iteration's typed partial transformation.

### Four System Modes

The Factory operates in one of four modes at any time:

**Bootstrap** -- The Factory builds itself. META-* prefix enforced on all
artifacts. Trajectory-driven birth disabled. Structural human-in-the-loop:
the Architect reviews every artifact. Semantic Review is human-in-the-loop
(not LLM-driven).

**Steady-State** -- External signals flow in. Full autonomy for the vertical
track. Trajectory-driven birth enabled. Semantic Review is LLM-driven.
This is the normal operating mode.

**Degraded** -- Partial outage. One or more components unavailable. All
offline gates fail-closed: if a gate cannot be evaluated, the Function
cannot advance. The system does not guess at pass/fail -- it stops.

**Emergency** -- Time-boxed (4 hours default). Architect overrides permitted.
Class C amendments are fast-pathed. Mandatory follow-up review when the
emergency expires.

```typescript
/**
 * Determine the current system mode based on governance metrics.
 */
declare function governance_determineSystemMode(
  metrics: GovernanceMetrics
): "bootstrap" | "steady_state" | "degraded" | "emergency";

/** CANONICAL-ONLY. Governance measurement inputs. */
interface GovernanceMetrics {
  policy_stress_indicators: PolicyStressIndicator[];
  amendment_history: AmendmentRecord[];
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. Historical amendment. */
interface AmendmentRecord {
  class: "A" | "B" | "C";
  description: string;
  applied_at: string;
}
```

### The Evaluation Context

Each candidate is evaluated in a specific context. This context is recorded
so that evaluation results can be reproduced:

```typescript
/** From ratified decisions lines 323-330. */
interface EvaluationContext {
  harness_command: string;
  harness_version?: string;
  prompt_pack_version: string;
  model_binding_hash: string;
  tool_policy_hash: string;
  evaluated_at: string;
}
```

The evaluation context matters because reproducibility is a governance
requirement. If a model version is silently deprecated, the candidate must
be marked as unresolvable -- no silent substitution is permitted.

```typescript
/**
 * Resolved model reference after resolution.
 * From ratified decisions Section 9.
 *
 * In routing-table defaults, aliases are acceptable.
 * In emitted ArchitectureCandidates, resolved versions are REQUIRED.
 * In Stage6TraceLogs and Gate2Inputs, resolved versions are REQUIRED.
 */
interface ResolvedModelIdentifier {
  provider: string;
  model: string;
  version: string; // required after resolution
  resolved_at: string;
  resolution_source: "provider_api" | "repo_lockfile" | "manual_pin";
}
```

---

## Part IV -- How Does a Function Prove Itself?

### The Evidence Bundle ACL

Stage 6 produces raw execution artifacts. But the Assurance Context does not
consume raw artifacts -- it consumes a normalized evidence bundle. The ACL
between Execution and Assurance translates Stage6TraceLog into a Gate2Input:

```typescript
/**
 * ACL: Execution -> Assurance.
 * Bundle Stage 6 output into a normalized evidence package
 * for acceptance review.
 *
 * This was formerly called "handToGate2" or "prepareGate2Input".
 * Renamed per naming principle 1: describes what happens, not where it goes.
 *
 * Pure function: given input A, expect output B. No mocking required.
 */
declare function execution_bundleEvidenceForAcceptanceReview(
  traceLog: Stage6TraceLog,
  adherenceReport: RoleAdherenceReport
): Gate2Input;
```

The Gate2Input type is the contract between Execution and Assurance:

```typescript
/**
 * Normalized evidence bundle for acceptance review.
 * From ratified decisions lines 490-528.
 *
 * This is what the Assurance Context sees. It does not see
 * raw harness transcripts -- those are drill-down evidence,
 * not the contract.
 */
interface Gate2Input {
  id: string;
  function_id: string;
  prd_id: string;
  workgraph_id: string;
  candidate_id: string; // AC-*
  stage6_run_id: string;

  verifier_verdict: TerminalVerdict;
  requires_human_approval: boolean;

  artifacts: {
    trace_log_path: string;
    role_adherence_report_path: string;
    generated_artifact_paths: string[];
    validation_artifact_paths: string[];
  };

  evidence: {
    validation_outcomes: ValidationOutcome[];
    compile_summary: unknown | null;
    test_summary: unknown | null;
    scope_violation: boolean;
    hard_constraint_violation: boolean;
    repair_loop_count: number;
    resample_summary: unknown | null;
  };

  provenance: {
    harness_command: string;
    prompt_pack_version: string;
    tool_policy_hash: string;
    model_binding_hash: string;
    started_at: string;
    completed_at?: string;
  };
}
```

### Acceptance Review (formerly "Gate 2")

The acceptance review evaluates whether the implementation actually exercises
its specification. This is the guard `scenarios_cover_invariants`.

Three checks, all required, all fail-closed:

1. **Scenario coverage** -- every branch in the WorkGraph has been exercised
   by at least one scenario. Unreached branches are dead or untested code.

2. **Invariant exercise** -- every invariant has at least one scenario that
   could plausibly violate it. A negative test must exist.

3. **Required-validation pass rate** -- 100%. Below 100% is not partial
   credit; it is a fail.

```typescript
/** CANONICAL-ONLY. Acceptance review verdict. */
interface AcceptanceReviewVerdict {
  gate2_input_id: string;
  scenario_coverage: boolean;
  invariant_exercise: boolean;
  required_validation_pass_rate: number;
  overall: "pass" | "fail";
  failures: CoverageFailure[];
}

/**
 * Stage 7 (entry): Evaluate acceptance review.
 * Before lifecycle transition from produced -> accepted.
 *
 * FAIL-CLOSED: Function stays in produced state, cannot promote.
 */
declare function assurance_evaluateAcceptanceReview(
  gate2Input: Gate2Input
): AcceptanceReviewVerdict;
```

### Deployment

For a Function to reach `monitored`, it must be deployed to a real environment
where telemetry flows. In the META case (Bootstrap mode), the Factory IS the
runtime -- it runs its own code, and its own telemetry is the input. In vertical
cases, deployment means an external runtime.

---

## Part V -- How Does a Function Stay Healthy?

### Continuous Evidence Monitoring (formerly "Gate 3")

The structural coverage guard and acceptance review are one-shot gates. The
evidence monitoring guard is different. It runs continuously, as a property of
every Function that has reached `monitored` status.

Its job: ensure the runtime evidence base has not silently decayed.

Three checks per Function, per invariant:

1. **Detector freshness** -- every invariant's detector has reported within
   its freshness threshold. Silence is not evidence of correctness. A detector
   that has gone 24 hours without emitting is missing, not passing.

2. **Evidence source liveness** -- every named evidence source (telemetry stream,
   audit topic, incident channel) is still emitting at expected cadence.

3. **Audit pipeline integrity** -- expected vs observed audit volume. Under-auditing
   is a regression.

```typescript
/** CANONICAL-ONLY. Continuous monitoring report per function. */
interface EvidenceMonitoringReport {
  function_id: string;
  detector_freshness: boolean;
  evidence_source_liveness: boolean;
  audit_pipeline_integrity: boolean;
  overall: "pass" | "fail";
  failures: CoverageFailure[];
}

/**
 * Continuous: Sweep evidence integrity for a monitored Function.
 *
 * FAIL-CLOSED: Function transitions to regressed (evidence_base_lost).
 * This is a visibility regression, not a behavioral regression.
 * The Function may still be behaving correctly, but trust without
 * evidence is not trust -- it is assumption.
 */
declare function assurance_sweepEvidenceIntegrity(
  functionId: string
): EvidenceMonitoringReport;
```

### The Trust Model

Trust is composed from five dimensions, each a score from 0.0 to 1.0:

```typescript
/** CANONICAL-ONLY. Five-dimensional trust composite. */
interface TrustComposite {
  correctness: Score;    // weight 0.30 -- does it do what the contract says
  compliance: Score;     // weight 0.25 -- does it honor policy
  observability: Score;  // weight 0.20 -- can its behavior be verified from evidence
  stability: Score;      // weight 0.15 -- does it behave consistently under stress
  user_response: Score;  // weight 0.10 -- do users rely on it and succeed
  weighted_total: Score;
}

/**
 * Compose trust from gate history and evidence.
 *
 * Hard rule: if any critical invariant is broken, the Function
 * cannot remain trusted, regardless of average score.
 */
declare function assurance_composeTrust(
  functionId: string,
  gateHistory: GateHistory
): TrustComposite;
```

### Invariant Health

Invariant health is a continuous signal, not a compliance checkbox:

```typescript
/** CANONICAL-ONLY. Per-invariant health score. */
interface InvariantHealth {
  invariant_id: string;
  score: Score; // 0.0-1.0
  direct_violations: number;
  warning_signals: number;
  open_incidents: number;
  monitoring_staleness_hours: number;
}
```

### Regression Classes

When a monitored Function loses trust, it regresses. Four classes:

- **validation_regression** -- a previously passing validation now fails
- **runtime_invariant_regression** -- a runtime invariant detector fires
- **assurance_regression** -- loss of visibility (evidence_base_intact fails)
- **incident_regression** -- a production incident linked to the Function's invariants

### Incident Propagation Through the Assurance Dependency Graph

Incidents propagate through typed dependencies, not service adjacency. Five
dependency types:

```typescript
/**
 * Propagate an incident through the assurance dependency graph.
 *
 * Five dependency types:
 *   execution:        one Function calls another
 *   evidence:         one Function's evidence consumed by another
 *   policy:           one Function's policy decisions govern another
 *   shared_invariant: both depend on the same invariant
 *   shared_adapter:   both route through the same integration substrate
 *
 * Propagation is typed (watch, degraded, regressed) and modified by:
 *   criticality, fallback availability, isolation boundary,
 *   evidence confidence, temporal freshness.
 */
declare function assurance_propagateIncident(
  sourceFunction: string,
  failedInvariant: string,
  dependencyGraph: ReadonlyArray<{
    from: string;
    to: string;
    type: "execution" | "evidence" | "policy" | "shared_invariant" | "shared_adapter";
  }>
): Array<{
  function_id: string;
  impact: "watch" | "degraded" | "regressed";
  reason: string;
}>;
```

---

## Part VI -- How Does the Factory Get Smarter?

### Trajectory Detection: The Loop Closes

The Factory is not a one-way pipeline. Stage 7's runtime observations feed back
into Stage 1 as new Signals. This is where the loop closes.

```typescript
/** CANONICAL-ONLY. Drift pattern observed in a monitored Function. */
interface Trajectory {
  function_id: string;
  drift_type: string;
  severity: Score;
  recurrence: number;
  coupling: number;
  dimensions: string[];
  source_refs: SourceRef[];
}

/**
 * Detect drift trajectories in monitored Functions.
 * Trajectories that exceed the birth gate threshold trigger
 * new FunctionProposals, closing the loop.
 */
declare function observability_detectTrajectories(
  observations: ReadonlyArray<Observation>
): Trajectory[];
```

### The Birth Gate

The system must not auto-birth Functions from every noisy fluctuation. The birth
gate prevents proposal inflation:

```typescript
/** CANONICAL-ONLY. Proposal ranking. */
interface FunctionBirthScore {
  proposal: FunctionProposal;
  drift_severity: Score;
  recurrence: Score;
  coupling: Score;
  recovery_cost: Score;
  expected_leverage: Score;
  implementation_cost: Score;
  overlap: Score;
  total: Score;
}

/**
 * Score birth proposals. High-scoring proposals above the birth
 * gate threshold are auto-drafted into PRDs and enter Stage 5.
 */
declare function observability_scoreBirthProposals(
  trajectories: ReadonlyArray<Trajectory>
): FunctionBirthScore[];
```

### The Observation-to-Signal ACL

The ACL strips execution metadata and normalizes Observations into Signals:

```typescript
/** CANONICAL-ONLY. Runtime observation from a deployed Function. */
interface Observation {
  id: string;
  function_id: string;
  timestamp: string;
  trust_composite: TrustComposite;
  invariant_health: InvariantHealth[];
  source_refs: SourceRef[];
}

/**
 * ACL: Observability -> Specification.
 * Strip execution metadata, normalize Observation into Signal.
 *
 * Stripping discipline:
 *   - Execution-specific metadata (run_id, branch_id) STRIPPED
 *   - Trust and invariant health computations PRESERVED as signal content
 *   - Trajectory drift patterns TRANSLATED into Signal severity/urgency
 *   - Originating Function ID PRESERVED as source for lineage
 *
 * Pure function. The signal-hygiene package serves both
 * ingestion and feedback paths.
 */
declare function observability_reinjectionToSignal(
  observation: Observation
): Signal;
```

### The Bootstrap Special Case

In Bootstrap mode, the Factory IS the runtime. It builds itself. Every META-
artifact carries lineage back to the Pressure that birthed it. Trajectory-driven
birth is disabled in Bootstrap mode -- the loop is open, not closed. Signals come
from external sources or human-authored PRDs only.

### Adaptation: Pressure Recalibration (Stage 8)

The Factory recalibrates Pressure weights based on observed outcomes:

```typescript
/** CANONICAL-ONLY. Adjusted pressure with rationale. */
interface RecalibratedPressure {
  pressure_id: string;
  original_strength: Score;
  adjusted_strength: Score;
  adjustment_rationale: string;
  source_refs: SourceRef[];
}

declare function adaptation_recalibratePressures(
  observations: ReadonlyArray<Observation>,
  currentPressureWeights: Record<string, Score>
): RecalibratedPressure[];
```

### Adaptation: Selection Bias Correction (Stage 8.5)

The Factory detects systematic over-selection of candidate families:

```typescript
/** CANONICAL-ONLY. Detected selection bias patterns. */
interface BiasReport {
  detected_patterns: string[];
  correction_factors: Record<string, number>;
  source_refs: SourceRef[];
}

declare function adaptation_detectSelectionBias(
  candidateLineage: ReadonlyArray<{
    family_id: string;
    node_type: string;
    scores: ObjectiveScores;
    selected: boolean;
    observation_count: number;
  }>
): BiasReport;
```

### Meta-Governance: Policy Evolution (Stage 9)

The Factory detects when its own governance policies are under stress:

```typescript
/** CANONICAL-ONLY. Policy stress indicators. */
interface PolicyStressIndicator {
  policy_id: string;
  stress_type: string;
  severity: Score;
}

interface PolicyStressReport {
  indicators: PolicyStressIndicator[];
  recommendations: PolicyAction[];
  source_refs: SourceRef[];
}

declare function governance_evaluatePolicyStress(
  metrics: GovernanceMetrics
): PolicyStressReport;
```

### Policy Activation (Stage 10)

Policy changes follow three amendment classes:

- **Class A (additive)** -- new candidate family, new detector. Required: paired
  PR + DECISIONS entry.

- **Class B (substitutive)** -- existing default changes. Required: paired PR +
  DECISIONS entry + Architect Semantic Review + golden-corpus regression test.

- **Class C (emergency)** -- temporary override for confirmed regression. Required:
  fast-path PR + DECISIONS entry + explicit expiry + mandatory follow-up review.

```typescript
/** CANONICAL-ONLY. Policy change action. */
interface PolicyAction {
  type: "activate" | "rollback" | "amend";
  policy_id: string;
  rationale: string;
  amendment_class: "A" | "B" | "C";
}

declare function governance_activatePolicy(
  action: PolicyAction
): {
  activated: boolean;
  reason: string;
  expiry?: string; // only for Class C
};
```

---

## Part VII -- How Does the Code Get Organized?

### Seven Bounded Contexts

The 17-stage pipeline decomposes into seven bounded contexts. Each context owns
a coherent sub-domain with its own ubiquitous language, aggregates, and consistency
boundaries:

| Context | Stages | Responsibility | Aggregate Root |
|---------|--------|---------------|----------------|
| **Specification** | 1-5 | Compile signals into executable specifications | Function |
| **Architecture Search** | 4.5-4.75 | Emit and select optimal ArchitectureCandidate | ArchitectureCandidate |
| **Execution** | 6-6.75 | Execute WorkGraphs through five-role topology | ExecutionRun |
| **Observability** | 7-7.25 | Capture feedback and close the loop | Observation |
| **Adaptation** | 8-8.5 | Recalibrate pressures and correct selection bias | RecalibrationCycle |
| **Governance** | 9-10 | Evolve the Factory's governance policies | GovernanceDecision |
| **Assurance** | 5.5, 5.75, within 7 | Verify coverage at all three guards + trust | CoverageReport |

### The 32-Package Inventory

28 Factory packages + 4 pi-mono packages:

**Specification Context:**
- `@factory/schemas` -- shared kernel, all Zod types
- `@factory/signal-hygiene` -- signal normalization + feedback path
- `@factory/capability-delta` -- gap analysis
- `@factory/prd-authoring` -- PRD drafting
- `@factory/compiler` -- eight narrow passes

**Architecture Search Context:**
- `@factory/architecture-candidates` -- candidate generation from routing tables
- `@factory/candidate-selection` -- two-stage selection

**Execution Context:**
- `@factory/stage-6-coordinator` -- **NEW, P2 priority, 800-1200 LOC**
- `@factory/runtime-admission` -- admission checks
- `@factory/execution-lifecycle` -- lifecycle management
- `@factory/controlled-effectors` -- tool policy enforcement
- `@factory/effector-realization` -- tool execution

**Observability Context:**
- `@factory/observability-feedback` -- observation capture and feedback

**Adaptation Context:**
- `@factory/adaptive-recalibration` -- pressure weight adjustment
- `@factory/selection-bias` -- bias detection and correction

**Governance Context:**
- `@factory/meta-governance` -- policy stress detection
- `@factory/policy-activation` -- policy promotion/rollback
- `@factory/recursion-governance` -- recursion depth control

**Assurance Context:**
- `@factory/coverage-gates` -- structural coverage + acceptance review
- `@factory/semantic-review` -- **NEW, P5 priority**
- `@factory/runtime` -- trust scoring, regression detection (stub)
- `@factory/assurance-graph` -- typed incident propagation (stub)

**New packages to build (6):**
- `@factory/stage-6-coordinator` -- P2 priority
- `@factory/semantic-review` -- P5 priority
- `@factory/learning` -- P7 priority
- `@factory/gate-2-runner` -- acceptance review runner
- `@factory/gate-3-runner` -- continuous monitoring runner
- (pipeline-bus replaced by LangGraph.js)

**Pi-mono packages (external):**
- `@anthropic/pi-ai` -- unified model abstraction
- `@anthropic/pi-agent-core` -- per-role agent execution
- `@anthropic/pi-coding-agent` -- specialized Coder role
- `@langgraph/langgraph` -- orchestration substrate

### The Pi-Mono Integration Boundary

Only TWO Factory packages cross the pi-mono boundary:
- `@factory/stage-6-coordinator` -- consumes pi-agent-core for per-role Agent instances
- `@factory/learning` -- consumes pi-ai for model routing table queries and cost data

Any other Factory package that imports `@anthropic-ai/sdk`, `openai`, or
`@google/generative-ai` directly is a governance violation.

### The Repository Pattern

Each bounded context has its own repository interface. All repositories share
the `MemoryProvider` base interface, implemented by a single `ArangoMemoryProvider`
class backed by ArangoDB.

Repository invariants:
1. All inputs and outputs are Zod-validated. Raw ArangoDB `_key`/`_id`/`_rev`
   fields are stripped at the repository boundary.
2. Lineage is native. Every repository method that persists an artifact accepts
   `source_refs: SourceRef[]` and stores them as first-class fields.
3. Append-only for the episodic tier. No update or delete methods are exposed.
4. TTL for working state. Session-scoped state expires automatically.
5. Graph traversals for assurance. Incident propagation uses ArangoDB's native
   graph traversal.

```typescript
/**
 * The MemoryProvider interface. All repositories implement this.
 * From memory-substrate Section 3.4.
 *
 * One ArangoMemoryProvider class backs all seven memory tiers.
 */
interface MemoryProvider {
  // Episodic tier
  appendEvent(event: EpisodicEvent): Promise<void>;
  replayEvents(filter: EventFilter): AsyncGenerator<EpisodicEvent>;

  // Working tier
  getWorkingState(sessionId: string): Promise<WorkingState | null>;
  setWorkingState(sessionId: string, state: WorkingState): Promise<void>;

  // Semantic tier
  searchLessons(query: string, limit?: number): Promise<Lesson[]>;
  findSimilarLessons(embedding: number[], limit?: number): Promise<Lesson[]>;

  // Graph tier
  traverseGraph(
    startVertex: string,
    depth: number,
    direction: "outbound" | "inbound"
  ): Promise<GraphPath[]>;
  getNeighborhood(
    vertexId: string,
    edgeTypes?: string[]
  ): Promise<Neighborhood>;

  // Artifact tier
  putArtifact<T>(collection: string, artifact: T): Promise<string>;
  getArtifact<T>(collection: string, id: string): Promise<T | null>;
  queryArtifacts<T>(
    collection: string,
    filter: ArtifactFilter
  ): Promise<T[]>;
  walkLineage(artifactId: string, depth?: number): Promise<LineageChain>;
}
```

### Domain Events

The Factory's pipeline is event-driven. Domain events are transported via
LangGraph.js state updates, not through a separate event bus. Each stage
produces events that the next stage consumes.

**38 domain events** flow through the system:

| Context | Events |
|---------|--------|
| **Specification** | SignalNormalized, PressureClustered, CapabilityMapped, DeltaComputed, ProposalGenerated, PRDDrafted, CompilerPassCompleted (x8), WorkGraphEmitted |
| **Architecture Search** | CandidateEmitted, CandidateEvaluated, CandidateSelected, CandidateRejected |
| **Execution** | ExecutionAdmitted, RoleIterationStarted, RoleIterationCompleted, ToolCallExecuted, RepairLoopIterated, CandidateResampled, ExecutionCompleted, EvidenceBundlePrepared, EffectorRealized |
| **Observability** | ObservationEmitted, TrustCompositeUpdated, TrajectoryDetected, SignalReinjected, FunctionBirthProposed |
| **Adaptation** | PressureRecalibrated, SelectionBiasCorrected, DCEWeightsRecalibrated |
| **Governance** | PolicyStressDetected, GovernanceProposed, PolicyActivated, PolicyRolledBack |
| **Assurance** | StructuralCoverageEvaluated, SemanticReviewCompleted, AcceptanceReviewEvaluated, EvidenceMonitoringSwept, FunctionRegressed, AssuranceRegressed, DisagreementResolved |

Events are persisted to ArangoDB at each LangGraph.js node completion.
LangGraph.js checkpointing provides crash recovery.

### The Bounded Learning Loop

The Factory's learning system follows the CEF paper's five-plane discipline:
"execute online, learn offline."

**Plane 1 (Runtime execution):** Stage 6 executes with a frozen candidate.
No candidate mutates during execution.

**Plane 2 (Telemetry capture):** Stage6TraceLogs record every detail.
`EpisodicStoreAdapter.ingest(traceLog)` indexes into ArangoDB.

**Plane 3 (Evaluation):** `CandidateLineageIndexer.evaluate(family)` computes
nine-axis scores with cold-start policy.

**Plane 4 (Training):** `RoutingTableAmendmentEngine.proposeAmendment(results, table)`
produces Class A/B/C proposals.

**Plane 5 (Release):** `GoldenCorpusRunner.run(amendment, corpus)` gates
Class B amendments on regression testing.

The golden corpus contains four fixture types:
1. A deterministic real-function fixture (stable regression baseline)
2. A routing-diversity fixture (validates routing-table application)
3. A governance-stress fixture (validates repair loops + interrupts)
4. A tool-policy-sensitive fixture (validates tool-policy discipline)

### Schema Evolution

Schema changes are classified into two classes:

**S1 (backward-compatible):** Additive optional fields, stricter descriptions,
new enum members that do not change scoring semantics. Required: paired PR,
DECISIONS entry, compatibility tests.

**S2 (semantic or backward-incompatible):** Renaming/removing fields, changing
meaning of scoring/routing/prompt-binding fields. Required: paired PR, DECISIONS
entry, Architect Semantic Review, migration note.

Historical artifacts remain immutable. Lineage scoring reads old artifacts through
a versioned reader that projects each prior schema version into a canonical view:

```typescript
/**
 * Canonical projection for cross-version lineage scoring.
 * From ratified decisions Section 8.
 *
 * This function handles v1, v2, and later schema versions.
 * Scoring never consumes raw historical blobs directly.
 */
interface CanonicalCandidateView {
  id: string;
  topology: string;
  model_binding: Record<string, unknown>;
  inference_config: Record<string, unknown>;
  tool_policy: Record<string, unknown>;
  convergence_policy: Record<string, unknown>;
  node_type_applied: string;
  objective_scores: Record<string, number> | null;
  selected: boolean;
  schema_version: string;
}

declare function readArchitectureCandidate(
  raw: unknown
): CanonicalCandidateView;
```

### Routing Table Validation

Routing-table YAML is validated in three layers:

1. **Safe parse:** YAML parsed with safe loader. Custom tags forbidden.
2. **Structural validation:** Zod schema validates exact allowed keys. Unknown
   keys fail. Missing required fields fail.
3. **Semantic lint:** Custom validator rejects executable content, checks
   identifier uniqueness, reference integrity, allowed topology names.

```typescript
/**
 * Routing table validation report.
 * From ratified decisions Section 11.
 */
interface RoutingTableLintReport {
  table_id: string;
  table_version: string;
  status: "pass" | "fail";
  structural_errors: string[];
  semantic_errors: string[];
  generated_at: string;
}
```

CI fails on any routing-table validation error.

### ArangoDB Collection Design

One database `function_factory` with seven tiers:

| Tier | Collection(s) | Access Pattern |
|------|--------------|---------------|
| 1. Episodic | `episodic_events` | Append-only, 10-100/sec, 90-day rolling |
| 2. Working | `working_state` | TTL-indexed, session-scoped |
| 3. Semantic | `semantic_lessons`, `semantic_decisions` | Vector index + BM25 |
| 4. Candidate | `candidate_lineage` | Pattern + score indexes |
| 5. Graph | `assurance_graph` (named graph) | Graph traversals |
| 6. Artifacts | `artifacts_prds`, `artifacts_workgraphs`, `artifacts_coverage`, `artifacts_governance` | Write-once, lineage traversal |
| 7. Cold | `cold_archive` | Write-once, read-rarely |

Edge collections: `evaluates`, `escalates_to`, `monitors`, `governs`, `produces`,
`observed_as`, `references`.

### LangGraph.js: Two Graphs

**Graph 1: Pipeline graph** (17 stages, mostly synchronous):

```
START -> normalize_signals -> cluster_pressures -> map_capabilities
      -> compute_delta -> generate_proposals -> draft_prds
      -> compile (Passes 0-7) -> structural_coverage_guard
      -> semantic_review -> assemble_workgraph (Pass 8)
      -> select_candidate -> admit_to_execution
      -> [async] run_dark_factory_subgraph
      -> acceptance_review -> promote_to_monitored
      -> [continuous] evidence_monitoring_sweep
      -> trajectory_detection -> birth_gate -> [loop to draft_prds]
```

**Graph 2: Dark Factory sub-graph** (Stage 6, with repair loops):

```
candidate_start -> planner -> coder -> critic -> tester -> verifier
-> route_after_verifier:
   pass -> candidate_done
   patch -> coder
   resample -> planner (new candidate)
   interrupt -> human_gate
   fail -> candidate_failed
```

### Five Deployable Components

The Factory deploys as five components on Railway:

| Component | What | Scaling |
|-----------|------|---------|
| **Pipeline Orchestrator** | Stages 1-5, 7.25, 8, 8.5, 9, 10. Compiler passes. structural_coverage_passed. | 1 instance (leader-elected) |
| **Execution Workers** | Stage 6 Dark Factory. Five-role topology via pi-agent-core. | N workers, scale-to-zero, max 8 |
| **Observation Engine** | Stage 7 continuous. Trust, acceptance review, evidence monitoring, feedback. | 1-2 instances |
| **API Gateway** | Signal intake, Architect review UI, dashboard, artifact retrieval. | 1 instance (auto-scaled) |
| **Semantic Reviewer** | Between structural_coverage_passed and Pass 8. LLM-driven in Steady-State. | 1 instance (burst to 2) |

**Cost model at 50 Functions/month:**

| Category | Monthly Cost |
|----------|-------------|
| LLM API costs | ~$2,075 (dominant: 200 executions x 200 calls x $0.05 avg) |
| Railway compute | ~$45 |
| ArangoDB on Railway | ~$10-25 |
| Object store (S3-compatible) | ~$5 |
| **Total** | **~$2,140/month** |

97% of cost is LLM. Infrastructure is noise. Cost optimization is model
selection and repair-loop reduction, not infrastructure optimization.

### Harness-Agnostic Loading

The Factory is harness-agnostic. The WorkGraph and prompt pack are designed to
be read by any compliant harness. Four root-level pointer files provide
cross-harness discovery:

- `AGENTS.md` -- Codex CLI, Amp, Cursor, Windsurf, and ~20 other harnesses
- `CLAUDE.md` -- Claude Code (mandatory; Claude does not read AGENTS.md natively)
- `GEMINI.md` -- Gemini CLI, Antigravity
- `.github/copilot-instructions.md` -- GitHub Copilot in VS Code

Design principle: keep pointer files as data (one-line imports), not code.
Push detail into `.agent/` subtree for progressive disclosure.

### Where Each Function Signature Lives

| Function | Package | Part |
|----------|---------|------|
| `specification_normalizeSignals` | `@factory/signal-hygiene` | II |
| `specification_compilePipeline` | `@factory/compiler` | II |
| `specification_pass0..pass8` | `@factory/compiler` | II |
| `search_selectCandidate` | `@factory/candidate-selection` | III |
| `execution_buildInitialDecisionState` | `@factory/stage-6-coordinator` | III |
| `execution_runRepairLoop` | `@factory/stage-6-coordinator` | III |
| `execution_enforceWriteDomain` | `@factory/stage-6-coordinator` | III |
| `execution_evaluateEscalationScore` | `@factory/stage-6-coordinator` | III |
| `execution_bundleEvidenceForAcceptanceReview` | `@factory/stage-6-coordinator` | IV |
| `assurance_evaluateStructuralCoverage` | `@factory/coverage-gates` | II |
| `assurance_reviewSemanticCorrectness` | `@factory/semantic-review` | II |
| `assurance_evaluateAcceptanceReview` | `@factory/coverage-gates` | IV |
| `assurance_sweepEvidenceIntegrity` | `@factory/gate-3-runner` | V |
| `assurance_composeTrust` | `@factory/runtime` | V |
| `assurance_propagateIncident` | `@factory/assurance-graph` | V |
| `observability_detectTrajectories` | `@factory/observability-feedback` | VI |
| `observability_scoreBirthProposals` | `@factory/observability-feedback` | VI |
| `observability_reinjectionToSignal` | `@factory/signal-hygiene` | VI |
| `adaptation_recalibratePressures` | `@factory/adaptive-recalibration` | VI |
| `adaptation_detectSelectionBias` | `@factory/selection-bias` | VI |
| `governance_evaluatePolicyStress` | `@factory/meta-governance` | VI |
| `governance_activatePolicy` | `@factory/policy-activation` | VI |

---

## Appendix A -- Type Definitions

All types referenced in Parts I-VI, grouped by bounded context. Types from
ratified Zod schemas are marked with their line numbers. Types that exist only
in this canonical reference are marked CANONICAL-ONLY.

### Shared Kernel (`@factory/schemas`)

| Type | Source | Description |
|------|--------|-------------|
| `RoleName` | Ratified lines 202-208 | Five Stage 6 roles |
| `NodeType` | Ratified lines 210-220 | Nine WorkGraph node types |
| `RoleTopology` | Ratified lines 222-230 | Seven valid role configurations |
| `ComplianceVerdict` | Ratified line 232 | pass, fail, unknown |
| `TerminalVerdict` | Ratified lines 233-239 | Five terminal outcomes |
| `DisagreementClass` | Ratified lines 241-245 | Three disagreement classes |
| `ObjectiveAxis` | Ratified lines 247-257 | Nine scoring axes |
| `Score` | Ratified line 259 | 0-1 bounded number |
| `ModelIdentifier` | Ratified lines 261-265 | Provider + model + version |
| `ToolPermission` | Ratified lines 267-270 | Allowed boolean + notes |
| `ToolPolicy` | Ratified lines 272-282 | Nine tool categories |
| `InferenceConfig` | Ratified lines 284-297 | Samples, critique rounds, caps |
| `ConvergencePolicy` | Ratified lines 299-305 | Stopping rules |
| `HardFilterResults` | Ratified lines 307-315 | Six admissibility checks |
| `ObjectiveScores` | Ratified lines 317-321 | Nine-axis weighted scores |
| `EvaluationContext` | Ratified lines 323-330 | Harness/prompt/hash metadata |
| `RoutingRuleRef` | Ratified lines 332-336 | Routing table reference |
| `SourceRef` | Ratified line 338 | Lineage string |

### Specification Context

| Type | Source | Description |
|------|--------|-------------|
| `Signal` | CANONICAL-ONLY | Normalized evidence envelope |
| `Pressure` | CANONICAL-ONLY | Forcing function on the organization |
| `Capability` | CANONICAL-ONLY | Organizational ability |
| `CapabilityDelta` | CANONICAL-ONLY | Gap between required and existing |
| `FunctionProposal` | CANONICAL-ONLY | Candidate Function with type |
| `PRD` | CANONICAL-ONLY | Product Requirements Document |
| `Atom` | CANONICAL-ONLY | Single requirement |
| `Contract` | CANONICAL-ONLY | Signature + pre/postconditions |
| `Invariant` | CANONICAL-ONLY | Persistent truth with detector |
| `DetectorSpec` | CANONICAL-ONLY | Runtime detector for invariant |
| `Validation` | CANONICAL-ONLY | Test with backmap |
| `Dependency` | CANONICAL-ONLY | Inter-node dependency |
| `WorkGraph` | CANONICAL-ONLY | Compiled implementation graph |
| `WorkGraphNode` | CANONICAL-ONLY | Graph node with type |
| `WorkGraphEdge` | CANONICAL-ONLY | Graph edge |
| `CompilerIntermediates` | CANONICAL-ONLY | All pass outputs bundled |

### Architecture Search Context

| Type | Source | Description |
|------|--------|-------------|
| `ArchitectureCandidate` | Ratified lines 342-367 | Complete execution configuration |
| `CandidateSelectionReport` | Ratified lines 769-781 | Selection audit trail |
| `RoleModelBinding` | Package-contracts 3.2 | Per-role model config |
| `ProductionModelBinding` | Package-contracts 3.2 | Complete binding array |

### Execution Context

| Type | Source | Description |
|------|--------|-------------|
| `DecisionState` | CANONICAL-ONLY | Decision algebra D=(I,C,P,E,A,X,O,J,T) |
| `Stage6TraceLog` | Ratified lines 424-452 | Complete execution record |
| `RoleIterationRecord` | Ratified lines 382-392 | Per-role-turn record |
| `ToolCallRecord` | Ratified lines 373-380 | Tool invocation record |
| `ResampleNode` | Ratified lines 394-400 | Resample branch |
| `TerminalDecision` | Ratified lines 416-422 | Verifier's final verdict |
| `HumanApprovalPayload` | Ratified lines 402-408 | Escalation payload |
| `ValidationOutcome` | Ratified lines 410-414 | Test result |
| `RoleAdherenceReport` | Ratified lines 475-486 | Write-domain compliance |
| `RoleAdherenceEntry` | Ratified lines 469-473 | Per-role compliance |
| `ContractSurfaceCheck` | Ratified lines 463-467 | Per-surface check |
| `ContractSurface` | Ratified lines 456-461 | Four contract surfaces |
| `Gate2Input` | Ratified lines 490-528 | Evidence bundle for acceptance |

### Assurance Context

| Type | Source | Description |
|------|--------|-------------|
| `CoverageReport` | CANONICAL-ONLY | Output of any coverage gate |
| `CoverageFailure` | CANONICAL-ONLY | Specific coverage failure |
| `SemanticReviewReport` | CANONICAL-ONLY | Semantic review output |
| `AcceptanceReviewVerdict` | CANONICAL-ONLY | Acceptance review verdict |
| `EvidenceMonitoringReport` | CANONICAL-ONLY | Continuous monitoring report |
| `TrustComposite` | CANONICAL-ONLY | Five-dimensional trust |
| `InvariantHealth` | CANONICAL-ONLY | Per-invariant health score |
| `GateHistory` | CANONICAL-ONLY | Gate verdicts over time |

### Observability Context

| Type | Source | Description |
|------|--------|-------------|
| `Observation` | CANONICAL-ONLY | Runtime observation bundle |
| `Trajectory` | CANONICAL-ONLY | Drift pattern |
| `FunctionBirthScore` | CANONICAL-ONLY | Proposal ranking |

### Adaptation Context

| Type | Source | Description |
|------|--------|-------------|
| `RecalibratedPressure` | CANONICAL-ONLY | Adjusted pressure weight |
| `BiasReport` | CANONICAL-ONLY | Detected selection bias |

### Governance Context

| Type | Source | Description |
|------|--------|-------------|
| `PolicyStressIndicator` | CANONICAL-ONLY | Policy stress signal |
| `PolicyStressReport` | CANONICAL-ONLY | Stress evaluation output |
| `PolicyAction` | CANONICAL-ONLY | Policy change action |
| `GovernanceMetrics` | CANONICAL-ONLY | Governance measurement inputs |
| `AmendmentRecord` | CANONICAL-ONLY | Historical amendment |

**Total: 32 types from ratified schemas + 35 CANONICAL-ONLY types = 67 types.**

---

## Appendix B -- Anti-Corruption Layers

Four context-crossing translation functions. Each ACL is a pure function:
stateless, side-effect-free, trivially testable.

### ACL 1: Specification + Search -> Execution

**Function:** `execution_buildInitialDecisionState`
**Bridges:** Specification + Architecture Search -> Execution
**Transforms:** WorkGraph + ArchitectureCandidate + PRD -> DecisionState D0
**Why:** The Execution Context speaks the decision algebra (I,C,P,E,A,X,O,J,T).
The Specification and Search contexts speak WorkGraphs and Candidates. The ACL
translates one vocabulary into the other.

### ACL 2: Execution -> Assurance

**Function:** `execution_bundleEvidenceForAcceptanceReview`
**Bridges:** Execution -> Assurance
**Transforms:** Stage6TraceLog + RoleAdherenceReport -> Gate2Input
**Why:** The Assurance Context evaluates normalized evidence bundles, not raw
harness transcripts. The ACL extracts terminal decisions, collects artifact paths,
summarizes evidence, and preserves provenance.

### ACL 3: Observability -> Specification

**Function:** `observability_reinjectionToSignal`
**Bridges:** Observability -> Specification
**Transforms:** Observation -> Signal
**Why:** The Specification Context processes Signals. The Observability Context
produces Observations. The ACL strips execution-specific metadata (run_id,
branch_id, iteration_index), preserves trust and health computations as signal
content, and normalizes drift patterns into Signal severity.

### ACL 4: Pi-mono -> Factory

**Boundary:** External substrate (pi-ai, pi-agent-core) -> Factory
**Bridges:** pi-mono types -> Factory types
**Transforms:**
- `AgentMessage[]` -> DecisionState partial update
- `AgentEvent` stream -> ToolCallRecord[] + RoleIterationRecord
- `Model` (pi-ai) -> ResolvedModelIdentifier
- `CostTracker` totals -> execution cost accounting
**Why:** Pi-mono uses its own type vocabulary. The Factory must not leak pi-mono
types into its domain model. Only `@factory/stage-6-coordinator` and
`@factory/learning` may cross this boundary.

---

## Appendix C -- For the Coding Agent

This appendix contains instructions for the coding agent that will refactor the
Function Factory repository using this document as its specification.

### Reading Order

1. Read Parts I-VI for understanding. You need to know what the system IS before
   you can implement it.

2. Read Part VII specifically for package mapping. This tells you where each
   function signature lives in the actual repo.

3. Read Appendix A for type definitions. Every type listed there must exist in
   `@factory/schemas` (for shared kernel types) or in its owning package.

### Code Blocks Are the Specification

Each Part's code blocks ARE the function signatures the packages must expose.
The signatures are complete: parameter types, return types, and JSDoc comments
that explain the function's purpose and constraints.

### The Lifecycle Transition Table IS the Test Oracle

The `LIFECYCLE_TRANSITIONS` array in Part I defines every legal lifecycle
transition. If the implementation allows a transition that is not in this array,
the implementation is wrong. If the implementation blocks a transition that IS
in this array, the implementation is wrong.

### The Pipeline Stage Array IS the Orchestration Specification

The `PIPELINE_STAGES` array in Part II defines the execution order, inputs,
outputs, and owning context for every stage. If the implementation executes
stages in a different order, the implementation is wrong.

### Guards Replace Gate Numbers

Throughout the codebase, replace:
- "Gate 1" with `structural_coverage_passed` (the guard condition)
- "Gate 2" with `scenarios_cover_invariants` (the guard condition)
- "Gate 3" with `evidence_base_intact` (the guard condition)

### Naming Conventions

1. Function names describe what happens: `execution_buildInitialDecisionState`,
   not `execution_prepareD0`.

2. Type names describe what the data IS: `TrustComposite`, not `Gate3Score`.

3. Guard names describe the condition: `structural_coverage_passed`, not
   `gate1Result`.

### Zero Design Decisions

This document specifies everything. The coding agent makes ZERO design decisions.
If something is ambiguous, flag it -- do not resolve it. The relationship between
this document and the coding agent is the same as between the AOMA Kernel
Refactoring Spec and its coding agent: zero-design-decision execution.

### Implementation Priorities

| Priority | Package | Estimated LOC |
|----------|---------|---------------|
| P1 | `@factory/schemas` (extend with CANONICAL-ONLY types) | 200-400 |
| P2 | `@factory/stage-6-coordinator` (NEW) | 800-1200 |
| P3 | `@factory/compiler` (align passes to spec) | 400-600 |
| P4 | `@factory/coverage-gates` (three guards) | 300-500 |
| P5 | `@factory/semantic-review` (NEW) | 200-400 |
| P6 | `@factory/candidate-selection` (two-stage + cold-start) | 300-500 |
| P7 | `@factory/learning` (NEW) | 600-1000 |
| P8 | `@factory/runtime` (implement stub) | 300-500 |
| P9 | `@factory/assurance-graph` (implement stub) | 300-500 |

### Pattern Discipline

- Compiler passes (Stages 1-5): Pipe-and-Filter + Functional Core / Imperative Shell
- Stage 6 (Dark Factory): Event-Driven Architecture + Saga Pattern
- Stages 7-10 (Feedback): Event-Driven Architecture + Event Sourcing (telemetry only)
- Within bounded contexts: Vertical Slice
- Storage boundary: Repository Pattern
- Context boundaries: Anti-Corruption Layer (pure functions)

### What NOT to Do

- Do NOT adopt hexagonal architecture. The Factory does not have the
  infrastructure-entanglement problem hexagonal solves.
- Do NOT adopt system-wide CQRS. Informal read/write separation where natural.
- Do NOT import provider SDKs directly. Use pi-ai.
- Do NOT store observed outcomes on ArchitectureCandidate. Use lineage artifacts.
- Do NOT collapse compiler passes. Each pass does exactly one thing.

---

## The Closed Loop: Structural Composition

For reference, here is how all seven bounded contexts compose into the closed
loop. This is the architectural truth test -- if this cannot be read end-to-end,
the architecture has drifted.

```typescript
/**
 * The Function Factory's closed-loop compiler.
 *
 * This is NOT the LangGraph.js production graph.
 * This IS the architectural reference.
 * When they disagree, this is the truth.
 */
async function factoryLoop(
  initialSignals: ReadonlyArray<Signal>,
  mode: "bootstrap" | "steady_state"
): Promise<void> {
  let signals: ReadonlyArray<Signal> = initialSignals;
  const allObservations: Observation[] = [];

  while (signals.length > 0) {
    // SPECIFICATION CONTEXT (Stages 1-5)
    // structural_coverage_passed + semantic review run internally
    const compiled = specification_compilePipeline(signals);

    for (const workGraph of compiled.workGraphs) {
      const prd = compiled.prds.find(
        (p) => p.function_id === workGraph.function_id
      );
      if (!prd) continue;

      // SEARCH CONTEXT (Stages 4.5-4.75)
      const { selected: candidate } = search_selectCandidate(
        workGraph, "config/routing-table.yaml", {}
      );

      // EXECUTION CONTEXT (Stage 6)
      // ACL: buildInitialDecisionState runs inside
      // ACL: bundleEvidenceForAcceptanceReview runs inside
      const { traceLog, adherenceReport, gate2Input } =
        execution_runDarkFactory(workGraph, candidate, prd);

      // ASSURANCE CONTEXT: Acceptance Review (scenarios_cover_invariants)
      const verdict = assurance_evaluateAcceptanceReview(gate2Input);
      if (verdict.overall === "fail") continue;

      // Function promoted to monitored
    }

    // OBSERVABILITY CONTEXT (Stages 7-7.25)
    const feedback = observability_processFeedback(
      allObservations, 0.65 // birth gate threshold
    );

    // ASSURANCE CONTEXT: evidence_base_intact (continuous)
    // Runs per monitored function, not per loop iteration

    // ADAPTATION CONTEXT (Stages 8-8.5)
    const { recalibratedPressures, biasReport } =
      adaptation_runRecalibrationCycle(allObservations, [], {});

    // GOVERNANCE CONTEXT (Stages 9-10)
    const { proposedActions } = governance_evaluateAndPropose(
      { policy_stress_indicators: [], amendment_history: [], source_refs: [] },
      biasReport
    );

    // LOOP CLOSURE
    if (mode === "bootstrap") break;
    signals = feedback.reinjectedSignals;
    if (signals.length === 0) break;
  }
}
```

---

## References

### Primary Architectural Sources
- Celestin, W. J. (2026). *The Function Factory: An Upstream-to-Downstream Compiler for Trustworthy Executable Functions.* Whitepaper v4, Koales.ai, 18 April 2026.
- Celestin, W. J. (2026). *The Function Factory -- Concept of Operations.* Seed ConOps v1, 18 April 2026.
- Celestin, W. J. (2026). *Grounding the Function Factory in a Layered Cognitive Runtime.* Integration whitepaper, 20 April 2026.
- Celestin, W. J. (2026). *The Function Factory -- Definitive Production Architecture.* v1.0.0, 19 April 2026.
- Anonymous preprint (2026). *A Layered Cognitive Runtime for Agentic Systems.* CEF paper.

### Governance Sources
- Celestin, W. J. (2026). *Ratified decisions.* April 2026.
- Architecture Agent (2026). *Function Factory v2 Production Architecture: Package Contracts.* 19 April 2026.
- Architecture Agent (2026). *Function Factory: Domain-Driven Design and DTO Architecture.* 22 April 2026.
- Architecture Agent (2026). *Function Factory: Architecture Pattern Evaluation and ADRs.* 22 April 2026.

### Literate Programming
- Knuth, D. E. (1984). *Literate Programming.* The Computer Journal, 27(2), 97-111.

---

*End of document.*
