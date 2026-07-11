/**
 * Improvement-loop validation gate (BRIEF-KEEL-IMPROVE-001, frozen). The safety
 * core: an improvement is PROMOTED only on verified signal, never self-score, and
 * it may NEVER touch the verifier it is judged by. Pure, substrate-free (D6).
 *
 * Three enforced invariants:
 *  - INV-IMPROVE-ORACLE-FIXED: an improvement may touch only harness surfaces
 *    (amend-prompt, connector-doc, procedure, deriver) — never the oracle/suite.
 *    An improvement declaring any other surface is REJECTED, structurally.
 *  - INV-IMPROVE-VERIFIED: promotion requires >=1 target trace flipping to a
 *    verified ACCEPT it did not have before, and NO target losing its ACCEPT.
 *  - INV-IMPROVE-MONOTONE: no trace in the held-out regression suite may flip
 *    ACCEPT -> non-ACCEPT.
 * "ACCEPT" here means a terminal oracle-ACCEPT within attempt budget (not first
 * attempt) — the same terminal verdict KEEL already produces.
 */

export const IMPROVABLE_SURFACES = ["amend-prompt", "connector-doc", "procedure", "deriver"] as const;
export type ImprovableSurface = (typeof IMPROVABLE_SURFACES)[number];

/** before/after terminal ACCEPT for one trace, under baseline vs the candidate. */
export interface VerdictPair { readonly beforeAccepted: boolean; readonly afterAccepted: boolean; }

export interface ImprovementCandidate {
  readonly id: string;
  readonly surfaces: readonly string[];      // what the improvement touches (declared)
  readonly targets: readonly VerdictPair[];  // the failing traces it aims to fix
  readonly regression: readonly VerdictPair[]; // held-out ACCEPTed traces (must not regress)
}
/** disposition distinguishes an auto-handled verdict from one that must go to a
 *  human (INV-IMPROVE-EFFECT-HUMAN: effectful procedures never auto-promote). */
export interface ImprovementDecision { readonly promote: boolean; readonly disposition: "auto" | "human"; readonly reason: string; }

export function evaluateImprovement(c: ImprovementCandidate): ImprovementDecision {
  // INV-IMPROVE-ORACLE-FIXED — reject anything that would modify the verifier
  const illegal = c.surfaces.filter((s) => !(IMPROVABLE_SURFACES as readonly string[]).includes(s));
  if (illegal.length) {
    return { promote: false, disposition: "auto", reason: `rejects: would modify non-harness surface(s) [${illegal.join(", ")}] — the oracle is fixed` };
  }
  // INV-IMPROVE-VERIFIED — a target lost its ACCEPT? reject. any new ACCEPT? required.
  if (c.targets.some((t) => t.beforeAccepted && !t.afterAccepted)) {
    return { promote: false, disposition: "auto", reason: "rejects: a target that previously ACCEPTed no longer does" };
  }
  const newAccepts = c.targets.filter((t) => !t.beforeAccepted && t.afterAccepted).length;
  if (newAccepts === 0) {
    return { promote: false, disposition: "auto", reason: "rejects: no target produced a NEW verified ACCEPT (self-score is not evidence)" };
  }
  // INV-IMPROVE-MONOTONE — no regression may flip ACCEPT -> non-ACCEPT
  const regressed = c.regression.filter((t) => t.beforeAccepted && !t.afterAccepted).length;
  if (regressed > 0) {
    return { promote: false, disposition: "auto", reason: `rejects: ${regressed} regression trace(s) lost their ACCEPT` };
  }
  return { promote: true, disposition: "auto", reason: `promote: +${newAccepts} verified ACCEPT(s), 0 regressions` };
}

// --- statistical gate (harness fixes, non-deterministic re-runs) --------------
/** Wilson score interval (95%, z=1.96) for k successes in n trials. */
export function wilsonInterval(k: number, n: number): readonly [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** The frozen gate rule: CI SEPARATION (improved above baseline), not a fixed N. */
export function ciSeparated(baseAccepts: number, imprAccepts: number, n: number): boolean {
  const [, baseHi] = wilsonInterval(baseAccepts, n);
  const [imprLo] = wilsonInterval(imprAccepts, n);
  return imprLo > baseHi;
}

export interface HarnessFixStat {
  readonly surfaces: readonly string[];
  readonly n: number;
  readonly baseAccepts: number;
  readonly imprAccepts: number;
  readonly regression: readonly VerdictPair[];
  readonly minN?: number; // floor before a verdict is allowed (default 20)
}
export function evaluateHarnessFix(s: HarnessFixStat): ImprovementDecision {
  const illegal = s.surfaces.filter((x) => !(IMPROVABLE_SURFACES as readonly string[]).includes(x));
  if (illegal.length) return { promote: false, disposition: "auto", reason: `rejects: non-harness surface(s) [${illegal.join(", ")}]` };
  const floor = s.minN ?? 20;
  if (s.n < floor) return { promote: false, disposition: "auto", reason: `rejects: N=${s.n} below floor ${floor}` };
  if (s.regression.some((t) => t.beforeAccepted && !t.afterAccepted)) {
    return { promote: false, disposition: "auto", reason: "rejects: a regression trace lost its ACCEPT" };
  }
  if (!ciSeparated(s.baseAccepts, s.imprAccepts, s.n)) {
    return { promote: false, disposition: "auto", reason: `rejects: Wilson CIs do not separate (base ${s.baseAccepts}/${s.n}, impr ${s.imprAccepts}/${s.n}) — run more N or defer` };
  }
  return { promote: true, disposition: "auto", reason: `promote: CIs separate (base ${s.baseAccepts}/${s.n} < impr ${s.imprAccepts}/${s.n})` };
}
