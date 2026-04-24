// Tangled from specs/reference/literate-canonical-reference.md
// Context: execution
// Blocks: 22
// Generated: 2026-04-24T15:11:44.399Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 976 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1048 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1085 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1102 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1127 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1144 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1191 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1279 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1298 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1330 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1356 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1388 (Part III -- How Does a Function Get Built?) ---
/**
 * Three classes of disagreement between Verifier and acceptance review.
 * From ratified decisions.
 */
type DisagreementClass =
  | "repairable_local"  // narrow defect, current candidate reusable
  | "architectural"     // wrong candidate family, new selection required
  | "governance";       // scope conflict, human required

// --- Block from line 1404 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1434 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1502 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1540 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1566 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1588 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1613 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1693 (Part III -- How Does a Function Get Built?) ---
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

// --- Block from line 1721 (Part III -- How Does a Function Get Built?) ---
/** From ratified decisions lines 323-330. */
interface EvaluationContext {
  harness_command: string;
  harness_version?: string;
  prompt_pack_version: string;
  model_binding_hash: string;
  tool_policy_hash: string;
  evaluated_at: string;
}

// --- Block from line 1737 (Part III -- How Does a Function Get Built?) ---
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
