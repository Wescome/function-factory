// Tangled from specs/reference/literate-canonical-reference.md
// Context: specification
// Blocks: 13
// Generated: 2026-04-24T14:39:52.554Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 455 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 634 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 655 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 676 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 704 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 723 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 752 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 784 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 832 (Part II -- How Does a Function Come to Exist?) ---
/** CANONICAL-ONLY. All pass outputs bundled for cross-pass reference. */
interface CompilerIntermediates {
  prd: PRD;
  atoms: Atom[];
  contracts: Contract[];
  invariants: Invariant[];
  dependencies: Dependency[];
  validations: Validation[];
}

// --- Block from line 863 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 888 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 912 (Part II -- How Does a Function Come to Exist?) ---
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

// --- Block from line 941 (Part II -- How Does a Function Come to Exist?) ---
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
