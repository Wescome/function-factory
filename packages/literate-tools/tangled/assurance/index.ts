// Tangled from specs/reference/literate-canonical-reference.md
// Context: assurance
// Blocks: 3
// Generated: 2026-04-24T14:39:52.556Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 1765 (Part IV -- How Does a Function Prove Itself?) ---
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

// --- Block from line 1784 (Part IV -- How Does a Function Prove Itself?) ---
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

// --- Block from line 1848 (Part IV -- How Does a Function Prove Itself?) ---
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
