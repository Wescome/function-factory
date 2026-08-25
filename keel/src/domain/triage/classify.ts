/**
 * triage/classify.ts — PLAYBOOK-KEEL-TRIAGE-001 (D2): a failing relation is
 * classified by CAUSE before decide() picks a response, so "regenerate the
 * code" stops being the only exit a red can take.
 *
 * OD-D2-4 (A.3): this is an OVERLAY between the `fail` verdict and decide()'s
 * routing — mirrors disposition/ledger.ts's `overlayDisposition` (annotate,
 * don't reopen decide()'s proven paths). `routeTriage` is pure and
 * substrate-free; it classifies nothing itself. The classification
 * (`TriageProposal`) is supplied by the caller — B.1/OD-GG-7's discipline:
 * model-inferred PROPOSES a cause, never assigns a route unattended.
 *
 * B.3/B.4 (never-worse): a route that matches the status quo
 * (implementation-defect, unknown -> amend) needs no evidence. A route that
 * DIVERGES from amend fires only when confirmed by already-computed
 * evidence, never the label alone. `decide()` only ever sees this when a
 * caller supplies a `TriageRoute` (loop/decide.ts's optional `triage`
 * input); no caller does yet (Track C), so this spike changes zero
 * production behavior until a future playbook wires a real classifier and
 * passes its output in.
 *
 * Scope (per the disposition, Track E — named fast-follow, NOT built here):
 * intentional-divergence rides L1's acceptance half once that lands
 * (until then it surfaces to the authority same as incorrect-relation would,
 * outside this cause set); environmental-nondeterminism -> stabilize;
 * observation/evaluator-defect -> fix-evaluator. None of the three are
 * modeled as `TriageCause` members this spike — the disposed taxonomy is
 * exactly the five values below, not the full brief taxonomy.
 */

/** B.1's disposed cause set — exactly these five, not the brief's full
 *  eight. `unknown` IS the fail-closed default value (not a separate
 *  confidence dial): a classifier that isn't sure emits `unknown`, which
 *  routes identically to `implementation-defect`. */
export type TriageCause =
  | "implementation-defect"
  | "incorrect-relation"
  | "requirement-ambiguity"
  | "invalid-applicability"
  | "unknown";

/** Model-inferred (OD-GG-7): PROPOSES a cause, never assigns the exit. */
export interface TriageProposal {
  readonly cause: TriageCause;
}

/** Already-computed facts, supplied by the caller — this file does no I/O
 *  and consults no model, same discipline as `OracleFactInput`
 *  (grounding/grader.ts): the CALLER resolves "does this fact hold", this
 *  function only reads booleans. */
export interface TriageEvidence {
  /** R1: does the failing criterion have a real scope mechanism to narrow
   *  (a metamorphic `property` criterion — compileMetamorphic's
   *  applicability/invalidators)? invalid-applicability is only evidenced
   *  when there is somewhere for a narrower applicability to land; a plain
   *  criterion has no such mechanism yet (RELATION-SCOPE-001's own disclosed
   *  gap) and cannot be evidenced here. */
  readonly criterionScopable?: boolean;
  /** B.3 (until the proposer lands): a human has confirmed the
   *  incorrect-relation read — the simpler heuristic that produced the
   *  proposal is never enough on its own; D2 never auto-rewrites a test. */
  readonly humanConfirmed?: boolean;
}

/** The three ESCALATE reasons a diverging route surfaces under — carried on
 *  decide()'s ESCALATE outcome (see decide.ts) so a human/downstream
 *  process knows WHAT KIND of escalate this is, not just that one
 *  happened. Deliberately the same three strings as their `TriageCause`
 *  counterparts (minus `implementation-defect`/`unknown`, which never
 *  escalate here). */
export type TriageEscalateReason = "incorrect-relation" | "requirement-ambiguity" | "invalid-applicability";

export type TriageRoute =
  | { readonly exit: "amend" }
  | { readonly exit: "escalate"; readonly reason: TriageEscalateReason };

/**
 * B.2 — the cause picks the exit, gated by evidence (B.3/B.4, never-worse).
 * `implementation-defect` and `unknown` always amend — the status-quo
 * default needs no evidence gate. Every diverging route requires its
 * specific evidence; anything short of that is indistinguishable from
 * today's default: amend.
 */
export function routeTriage(proposal: TriageProposal, evidence: TriageEvidence): TriageRoute {
  switch (proposal.cause) {
    case "implementation-defect":
    case "unknown":
      return { exit: "amend" };
    case "requirement-ambiguity":
      return { exit: "escalate", reason: "requirement-ambiguity" }; // fail-closed, ambiguity IS the evidence
    case "invalid-applicability":
      return evidence.criterionScopable
        ? { exit: "escalate", reason: "invalid-applicability" }
        : { exit: "amend" };
    case "incorrect-relation":
      // OD-D2-3/B.3: never auto-rewrite a test. Surfacing still requires a
      // human confirmation signal, not the model's label alone.
      return evidence.humanConfirmed
        ? { exit: "escalate", reason: "incorrect-relation" }
        : { exit: "amend" };
    default: {
      const _never: never = proposal.cause;
      return _never;
    }
  }
}
