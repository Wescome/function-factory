// Tangled from specs/reference/literate-canonical-reference.md
// Context: observability
// Blocks: 4
// Generated: 2026-04-24T14:39:52.556Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 1901 (Part V -- How Does a Function Stay Healthy?) ---
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

// --- Block from line 1929 (Part V -- How Does a Function Stay Healthy?) ---
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

// --- Block from line 1956 (Part V -- How Does a Function Stay Healthy?) ---
/** CANONICAL-ONLY. Per-invariant health score. */
interface InvariantHealth {
  invariant_id: string;
  score: Score; // 0.0-1.0
  direct_violations: number;
  warning_signals: number;
  open_incidents: number;
  monitoring_staleness_hours: number;
}

// --- Block from line 1982 (Part V -- How Does a Function Stay Healthy?) ---
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
