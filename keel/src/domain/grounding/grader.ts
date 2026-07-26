/**
 * grounding/grader.ts — PLAYBOOK-KEEL-GROUNDING-001 (B1): the grounding
 * gate's core, pure and substrate-free. Two graders feed one score; the
 * sure grader (oracle, tool-observed) always outweighs the guessing grader
 * (judge, model-inferred). Seated before `generate()` (run.ts) — this file
 * has no I/O of its own; the adapter (grounding-gate.adapter.ts) supplies
 * already-computed facts (does a suite assertion exist, did a prior
 * attempt's REAL oracle verdict already fail this criterion) and an
 * already-computed judge grade.
 *
 * INV-GRADE-MONOTONE (OD-GG-1): `scoreCriterion` CLAMPS the judge's
 * contribution to zero whenever the oracle has ANY opinion (grounded or
 * contradicted) — so no weight configuration, however adversarial, lets a
 * model-inferred (or signal-observed) label outweigh a tool-observed one.
 * Weights only ever arbitrate among criteria the oracle is silent on.
 *
 * OD-GG-2 / INV-GRADE-FAIL-CLOSED: `decideCriterion` makes "grounded"
 * reachable ONLY through the oracle — a judge label may SURFACE (raise or
 * lower suspicion enough to escalate) but never PASS. Oracle-silent +
 * judge-abstain (or judge-silent, or even judge-surface-grounded) is never
 * a silent pass — it escalates. This is the SAME fail-closed discipline
 * `SuiteOracleAdapter` already applies to a missing assertion, moved one
 * link up the loop.
 */

export type EvidenceType = "tool-observed" | "signal-observed" | "model-inferred";

/** The sure grader's label — tool-observed by construction (whatever
 *  produced it, it is never the judge's own guess). */
export type OracleGradeLabel = "grounded" | "contradicted" | "silent";

/** The guessing grader's label. `evidenceType` is grader-supplied so a
 *  swapped-in judge can honestly declare itself signal-observed (a
 *  heuristic/pattern check) rather than model-inferred (an LLM guess) —
 *  D.5's grader-independence: the CORE rules below don't care which. */
export type JudgeGradeLabel = "surface-grounded" | "surface-contradicted" | "abstain";

export interface OracleGrade {
  readonly criterionId: string;
  readonly label: OracleGradeLabel;
}

export interface JudgeGrade {
  readonly criterionId: string;
  readonly label: JudgeGradeLabel;
  readonly evidenceType: EvidenceType;
}

export interface GroundingWeights {
  readonly toolObserved: number;
  readonly signalObserved: number;
  readonly modelInferred: number;
}

/** Operator-overridable (OD-GG-1). The absolute values don't matter for
 *  correctness (the clamp in `scoreCriterion` is what guarantees monotonicity
 *  for ANY positive weight set) — they're a reporting/ranking convenience,
 *  scaled far apart so a diagnostic dump reads unambiguously tiered. */
export const DEFAULT_GROUNDING_WEIGHTS: GroundingWeights = {
  toolObserved: 1_000_000,
  signalObserved: 1_000,
  modelInferred: 1,
};

/** A diagnostic/reporting score — NOT the decision (`decideCriterion` is,
 *  and never reads weights at all). Clamped: the judge's term is zero
 *  whenever the oracle has an opinion, for every weight set. */
export function scoreCriterion(
  oracle: OracleGrade,
  judge: JudgeGrade | undefined,
  weights: GroundingWeights = DEFAULT_GROUNDING_WEIGHTS,
): number {
  const oracleTerm = oracle.label === "grounded" ? 1 : oracle.label === "contradicted" ? -1 : 0;
  if (oracleTerm !== 0 || !judge) return oracleTerm * weights.toolObserved;
  const judgeSign = judge.label === "surface-grounded" ? 1 : judge.label === "surface-contradicted" ? -1 : 0;
  const judgeWeight = judge.evidenceType === "signal-observed" ? weights.signalObserved : weights.modelInferred;
  return judgeSign * judgeWeight;
}

export type CriterionOutcome = "grounded" | "contradicted" | "escalate";

/** The actual decision — structurally immune to weights (they aren't even a
 *  parameter): "grounded" requires `oracle.label === "grounded"`, full stop. */
export function decideCriterion(oracle: OracleGrade, judge: JudgeGrade | undefined): CriterionOutcome {
  if (oracle.label === "grounded") return "grounded";
  if (oracle.label === "contradicted") return "contradicted";
  // Oracle silent: the judge may only surface, never pass.
  if (judge?.label === "surface-contradicted") return "contradicted";
  return "escalate"; // surface-grounded | abstain | no judge at all
}

export interface CriterionResult {
  readonly criterionId: string;
  readonly outcome: CriterionOutcome;
  readonly score: number;
}

export function gradeCriteria(
  pairs: readonly { readonly criterionId: string; readonly oracle: OracleGrade; readonly judge?: JudgeGrade }[],
  weights: GroundingWeights = DEFAULT_GROUNDING_WEIGHTS,
): readonly CriterionResult[] {
  return pairs.map((p) => ({
    criterionId: p.criterionId,
    outcome: decideCriterion(p.oracle, p.judge),
    score: scoreCriterion(p.oracle, p.judge, weights),
  }));
}

/** Aggregate per-criterion outcomes into the SAME (pass|fail|escalate) shape
 *  every VerdictContent already carries: any contradicted -> fail (AMEND-
 *  eligible: "fix the test, not the code"); else any escalate -> escalate
 *  (immediate — a human supplies the one fact no one wrote down); else
 *  (everything grounded) -> pass (proceed to generation). */
export function aggregateGate(results: readonly CriterionResult[]): "pass" | "fail" | "escalate" {
  if (results.some((r) => r.outcome === "contradicted")) return "fail";
  if (results.some((r) => r.outcome === "escalate")) return "escalate";
  return "pass";
}

/** The oracle grader's own label, from already-computed booleans (I/O lives
 *  in the adapter: does the frozen oracle suite have a real assertion for
 *  this criterion, did a PRIOR attempt's real, tool-observed oracle verdict
 *  already record it as failed). `priorResult: "fail"` -- a recorded trace
 *  already contradicted this exact criterion -- takes priority over a bare
 *  "there's an assertion for it": a test that has already been shown false
 *  once is a live contradiction, not just an unconfirmed claim. */
export interface OracleFactInput {
  readonly hasAssertion: boolean;
  readonly priorResult?: "pass" | "fail";
}

export function gradeOracleFact(input: OracleFactInput): OracleGradeLabel {
  if (input.priorResult === "fail") return "contradicted";
  if (input.hasAssertion) return "grounded";
  return "silent";
}
