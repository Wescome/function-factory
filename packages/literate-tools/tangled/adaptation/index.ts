// Tangled from specs/reference/literate-canonical-reference.md
// Context: adaptation
// Blocks: 7
// Generated: 2026-04-24T14:39:52.557Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 2021 (Part VI -- How Does the Factory Get Smarter?) ---
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

// --- Block from line 2048 (Part VI -- How Does the Factory Get Smarter?) ---
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

// --- Block from line 2075 (Part VI -- How Does the Factory Get Smarter?) ---
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

// --- Block from line 2115 (Part VI -- How Does the Factory Get Smarter?) ---
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

// --- Block from line 2135 (Part VI -- How Does the Factory Get Smarter?) ---
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

// --- Block from line 2158 (Part VI -- How Does the Factory Get Smarter?) ---
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

// --- Block from line 2190 (Part VI -- How Does the Factory Get Smarter?) ---
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
