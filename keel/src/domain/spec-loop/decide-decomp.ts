/**
 * decide-decomp.ts — THE DECOMPOSITION-EXIT POLICY (pure). PLAYBOOK-KEEL-
 * DERIV-AMEND, INV-DECOMP-8: `decide()` (loop/decide.ts) lifted one level —
 * same three-exit shape, but the unit is the DECOMPOSITION (a whole
 * derivation batch), not one run; the verdict is a COMPOSITION verdict
 * (coverage gap / cross-cut fail / seam fail), not a single oracle verdict;
 * the "attempt" is a RE-DERIVATION, not a re-generation.
 *
 * This does NOT re-implement detection. It reads the verdicts `runSpecLoop`
 * (coverage) and `compose()` (cross-cut + seam) already produce and maps
 * them to ACCEPT / RE-DERIVE / ESCALATE under a caller-supplied budget —
 * exactly as `decide()` never re-runs an oracle, only reads its outcome.
 */

/** Structural, not import-coupled to `ComposeClauseVerdict` — this file
 *  only needs the outcome shape, the same "read the verdict, don't rebuild
 *  it" discipline `decide()` applies to `VerdictOutcome`. */
export interface CompositionLegVerdict {
  readonly criterionId: string;
  readonly outcome: "pass" | "fail" | "unverifiable" | "error";
}

export interface DecompDecisionInput {
  /** From `SpecLoopSummary.escalated` — true on either a coverage gap or the
   *  inner derivation budget being exhausted. Neither is amend-worthy here:
   *  a coverage gap means the SHAPE was rejected before anything ran (the
   *  gate's own fail-closed refusal, the exact analog of `decide()`'s
   *  `verifier-escalate` — the checker couldn't accept it, not "it ran and
   *  was wrong"). */
  readonly derivationEscalated: boolean;
  /** From `SpecLoopSummary.coverageGap`, when `derivationEscalated` is a
   *  coverage gap specifically (vs. the inner fan-out budget). */
  readonly coverageGap?: readonly string[];
  /** `compose()`'s cross-cut verdicts. */
  readonly clauses: readonly CompositionLegVerdict[];
  /** `compose()`'s seam verdicts. */
  readonly seams: readonly CompositionLegVerdict[];
  /** Re-derivations USED so far, 1-based (the attempt that just produced
   *  this decision's inputs) — the decomposition-level analog of
   *  `DecideInput.attempt`. */
  readonly attempt: number;
  /** Max re-derivations permitted — caller-supplied, never hardcoded, same
   *  discipline as the run-level attempt budget (`decide.ts`). */
  readonly budget: number;
}

export type DecompDecision =
  | { readonly next: "ACCEPT" }
  | { readonly next: "RE-DERIVE"; readonly attempt: number }
  | { readonly next: "ESCALATE"; readonly reason: "coverage-gap" | "leg-escalate" | "budget-exhausted" };

export function decideDecomp(i: DecompDecisionInput): DecompDecision {
  // The gate's own fail-closed refusal (coverage gap) or the inner
  // fan-out/depth/derived budget — neither is "a leg failed," so neither is
  // amend-worthy. Escalate immediately, same tier as `decide()`'s
  // `verifier-escalate`.
  if (i.derivationEscalated) {
    return { next: "ESCALATE", reason: i.coverageGap?.length ? "coverage-gap" : "budget-exhausted" };
  }

  const legs = [...i.clauses, ...i.seams];
  // A leg that could not be judged at all (unverifiable / a malformed
  // relation) is not amendable, exactly as `decide()`'s `escalate` outcome
  // is distinct from `fail` — never evaluate/act on silence or a bad check.
  if (legs.some((l) => l.outcome === "unverifiable" || l.outcome === "error")) {
    return { next: "ESCALATE", reason: "leg-escalate" };
  }
  // A leg that WAS judged and came back wrong is exactly `decide()`'s
  // `fail` — amend-worthy while budget remains.
  if (legs.some((l) => l.outcome === "fail")) {
    return i.attempt < i.budget
      ? { next: "RE-DERIVE", attempt: i.attempt + 1 }
      : { next: "ESCALATE", reason: "budget-exhausted" };
  }
  return { next: "ACCEPT" };
}

/** PLAYBOOK-KEEL-DERIV-AMEND: the failure carried into the next
 *  `deriver.derive` call — the union of what coverage, compose (cross-cut +
 *  seam), and spanning-checkability produced THIS attempt. Only ever called
 *  after a `RE-DERIVE` decision, so `derivationEscalated` is always false
 *  here (an escalated attempt never reaches this) — `coverageGap` is
 *  included in the shape for completeness/documentation (mirrors
 *  `DerivationEvidence`'s own fields) but is consequently always empty in
 *  practice today; a future path that re-derives past an inner coverage
 *  escalation (not this playbook's design) would populate it. */
export function failureToEvidence(
  input: Pick<DecompDecisionInput, "coverageGap" | "clauses" | "seams">,
  spanningUncheckable: readonly string[],
): { readonly coverageGap?: readonly string[]; readonly failedClauses?: readonly string[]; readonly spanningUncheckable?: readonly string[] } {
  const failedClauses = [...input.clauses, ...input.seams].filter((l) => l.outcome === "fail").map((l) => l.criterionId);
  const evidence: { coverageGap?: readonly string[]; failedClauses?: readonly string[]; spanningUncheckable?: readonly string[] } = {};
  if (input.coverageGap?.length) evidence.coverageGap = input.coverageGap;
  if (failedClauses.length) evidence.failedClauses = failedClauses;
  if (spanningUncheckable.length) evidence.spanningUncheckable = [...new Set(spanningUncheckable)];
  return evidence;
}
