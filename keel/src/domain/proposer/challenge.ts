/**
 * proposer/challenge.ts — B.2/B.3/B.4: challenge (the core), refine, and
 * register defeaters.
 *
 * ACTUALLY RUNNING a candidate's family probe (compileMetamorphic,
 * suite.ts) over cases is adapter-side execution, not a pure domain
 * concern — this function takes ALREADY-JUDGED cases (each case's pass/
 * fail is real probe output; each failing case's legitimacy is a
 * caller/model-supplied judgment, OD-GG-7's discipline reused from D2:
 * this file classifies and narrows, it does not invent legitimacy).
 *
 * The one slice of "counterexample search" (B.2) this file CAN generate
 * without semantic understanding of the requirement text: generic
 * boundary/edge values (`defaultBoundaryCases`). The other two sources
 * B.2 names — the requirement's stated constraints, and the R1 scope of
 * related relations — need a model or human reading actual text/other
 * criteria; those cases are the CALLER's to supply alongside the boundary
 * ones, not reconstructed here.
 *
 * R1 mapping (disclosed): a `confirmed-illegitimate` failure narrows
 * APPLICABILITY (the relation doesn't even claim to cover this case —
 * `not-applicable` is the right runtime fact). An `unsettled` failure
 * narrows via an INVALIDATOR (the relation would apply, but this input's
 * legitimacy isn't settled — `inconclusive` is the honest runtime fact,
 * not a silent pass) AND is registered in `openDefeaters` so it's visible
 * to the ratifying authority, not just silently absorbed into scope. A
 * `confirmed-legitimate` failure is a REAL violation — narrowing it away
 * would be dishonest, so it defeats the candidate outright (B.3).
 */
import type { Defeater, LiftCandidate } from "./candidate";

export interface ChallengeCase {
  readonly input: number;
  /** Real probe output (adapter-computed, e.g. via compileMetamorphic). */
  readonly passed: boolean;
  /** Only meaningful when `passed` is false. Absent is treated as
   *  `unsettled` (fail-closed: an unjudged failure is never silently
   *  narrowed away as illegitimate, never silently accepted as fine). */
  readonly legitimacy?: Defeater["legitimacy"];
}

export interface ChallengeResult {
  /** The refined candidate: illegitimate failures narrowed into
   *  applicability, unsettled failures narrowed into invalidators AND
   *  registered, status set to "rejected" iff a legitimate defeat remains. */
  readonly candidate: LiftCandidate;
  /** INV-LP-CHALLENGE-CORE: false iff ANY confirmed-legitimate failure
   *  remains — a survivor is a bounded claim, never a candidate still
   *  carrying a real, un-narrowable violation. */
  readonly survives: boolean;
  /** B.3: the case(s) that defeated the candidate outright (never
   *  surfaced as-is) — empty when `survives` is true. */
  readonly legitimateDefeats: readonly ChallengeCase[];
}

/** B.2 (the one mechanically-generatable slice): generic numeric edge
 *  values, independent of any domain semantics. */
export function defaultBoundaryCases(): readonly number[] {
  return [0, 1, -1, 100, -100];
}

/** B.2: an irrelevant-variable (invariance) claim is a dependency claim —
 *  "the output doesn't depend on this transformed dimension" — and needs
 *  the human half of the dependency check (the model half is a named
 *  fast-follow, Track E) before it may even surface, regardless of how it
 *  fares in challenge. */
export function requiresDomainOwnerConfirmation(candidate: LiftCandidate): boolean {
  return candidate.family.kind === "invariance";
}

function excludeExpr(input: number): string {
  return `input !== ${JSON.stringify(input)}`;
}
function invalidateExpr(input: number): string {
  return `input === ${JSON.stringify(input)}`;
}

/** A scoped candidate must carry SOME applicability the moment it carries
 *  invalidators or a preservation set (mirrors gate.ts's `isScopeAdmittable`
 *  — a relation that declares scope but gives the oracle nothing to check
 *  applicability against is not admittable). Narrowing an UNSCOPED
 *  candidate with its first invalidator would otherwise land in exactly
 *  that not-admittable state; seed a trivial always-true applicability so
 *  it never does. */
function ensureScopeAdmittable(applicability: readonly string[] | undefined, needsScope: boolean): readonly string[] | undefined {
  if (!needsScope) return applicability;
  return applicability?.length ? applicability : ["true"];
}

export function challengeCandidate(candidate: LiftCandidate, cases: readonly ChallengeCase[]): ChallengeResult {
  const failures = cases.filter((c) => !c.passed);
  const legitimateDefeats = failures.filter((c) => c.legitimacy === "confirmed-legitimate");
  const illegitimate = failures.filter((c) => c.legitimacy === "confirmed-illegitimate");
  const unsettled = failures.filter((c) => c.legitimacy === undefined || c.legitimacy === "unsettled");

  const applicabilityGrown = illegitimate.length
    ? [...(candidate.applicability ?? []), ...illegitimate.map((c) => excludeExpr(c.input))]
    : candidate.applicability;
  const invalidatorsGrown = unsettled.length
    ? [...(candidate.invalidators ?? []), ...unsettled.map((c) => invalidateExpr(c.input))]
    : candidate.invalidators;
  const newDefeaters: readonly Defeater[] = unsettled.length
    ? [
        ...candidate.openDefeaters,
        ...unsettled.map((c): Defeater => ({
          input: c.input,
          reason: `probe ${c.input} failed the candidate's family probe; legitimacy not yet confirmed`,
          legitimacy: "unsettled",
        })),
      ]
    : candidate.openDefeaters;

  const survives = legitimateDefeats.length === 0;

  const refined: LiftCandidate = {
    ...candidate,
    applicability: ensureScopeAdmittable(applicabilityGrown, !!invalidatorsGrown?.length || !!candidate.preservationSet?.length),
    invalidators: invalidatorsGrown,
    openDefeaters: newDefeaters,
    status: survives ? candidate.status : "rejected",
  };

  return { candidate: refined, survives, legitimateDefeats };
}
