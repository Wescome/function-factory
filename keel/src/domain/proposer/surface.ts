/**
 * proposer/surface.ts — B.5: surface (never certify). The proposer's last
 * pure step before an authority acts: package a survivor with its evidence
 * and open defeaters. NOTHING here writes to a spec (INV-LP-SURFACE-NOT-
 * CERTIFY) — surfacing produces a package for a human to read, exactly
 * like a diagnosed ESCALATE (D2/A.4) carries a cause and evidence without
 * itself deciding anything.
 */
import type { Defeater, LiftCandidate } from "./candidate";
import { requiresDomainOwnerConfirmation } from "./challenge";

export interface SurfacePackage {
  readonly candidate: LiftCandidate; // status: "surfaced"
  readonly openDefeaters: readonly Defeater[]; // B.4/B.5: travels WITH it
}

export type SurfaceResult =
  | { readonly ready: true; readonly surfaced: SurfacePackage }
  | { readonly ready: false; readonly reason: string };

/**
 * Blocked (never surfaces) if:
 *  - the candidate was already rejected by challenge (B.3 — a candidate
 *    defeated by a legitimate case is never surfaced as-is).
 *  - it's an invariance (irrelevant-variable) claim without the domain-
 *    owner confirmation B.2 requires (the human half of the dependency
 *    check) — regardless of how well it otherwise survived challenge.
 */
export function surfaceCandidate(candidate: LiftCandidate, domainOwnerConfirmed: boolean): SurfaceResult {
  if (candidate.status === "rejected") {
    return { ready: false, reason: "candidate was defeated by a legitimate case in challenge — never surfaced as-is (B.3)" };
  }
  if (requiresDomainOwnerConfirmation(candidate) && !domainOwnerConfirmed) {
    return { ready: false, reason: "invariance (irrelevant-variable) claim requires domain-owner confirmation before surfacing (B.2)" };
  }
  return { ready: true, surfaced: { candidate: { ...candidate, status: "surfaced" }, openDefeaters: candidate.openDefeaters } };
}
