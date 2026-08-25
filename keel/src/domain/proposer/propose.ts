/**
 * proposer/propose.ts — B.1: propose (candidate artifact, not a write).
 *
 * WHICH family/parameters fit a requirement is MODEL-INFERRED input
 * (OD-GG-7's discipline, reused from D2's `TriageProposal`) — this function
 * does not invent that judgment. It admits a PROPOSED family into the loop
 * only if it is well-formed to enter it AT ALL, before any challenge runs:
 * typed and executable (INV-LP-PROPOSE-TYPED, reusing R4's
 * `isFamilyExecutable`) and disposition-admissible (INV-LP-DISPOSITION-
 * BOUNDED, reusing R4's `familyAdmitsDisposition` — the exact function
 * `freezeGate`'s own `familyAdmissibleForDisposition` is built on, so the
 * proposer and the gate can never disagree about which families a
 * disposition allows). A proposal failing either check is rejected
 * outright — it never becomes a candidate, never reaches challenge.
 *
 * `initialScope` is optional R1 scope the proposal starts with (A.2: "what
 * a survivor carries, and what narrow a defeated candidate adds" — the
 * candidate MAY start scoped, not just gain scope through narrowing).
 * `isScopeAdmittable`-consistency (gate.ts's own rule: invalidators/
 * preservationSet without applicability is not admittable) is enforced
 * HERE too, at propose time, not left to surface at ratification — a
 * candidate that starts in a state `freezeGate` would reject can never be
 * written anyway, so catching it at propose time saves a wasted challenge
 * cycle.
 */
import type { PropertyFamily } from "../lineage/nodes";
import type { BehaviorDisposition } from "../disposition/ledger";
import { isFamilyExecutable, familyAdmitsDisposition } from "../spec-loop/gate";
import type { LiftCandidate } from "./candidate";

export interface InitialScope {
  readonly applicability?: readonly string[];
  readonly invalidators?: readonly string[];
  readonly preservationSet?: readonly string[];
}

export type ProposeResult =
  | { readonly admitted: true; readonly candidate: LiftCandidate }
  | { readonly admitted: false; readonly reason: string };

export function proposeCandidate(
  criterionId: string,
  family: PropertyFamily,
  disposition: BehaviorDisposition,
  initialScope?: InitialScope,
): ProposeResult {
  if (!isFamilyExecutable(family)) {
    return { admitted: false, reason: "family lacks the parameters its probe needs (not executable, INV-R4-TYPED-FAMILY)" };
  }
  if (!familyAdmitsDisposition(family.kind, disposition)) {
    return { admitted: false, reason: `family "${family.kind}" is not admissible for disposition "${disposition}" (INV-LP-DISPOSITION-BOUNDED)` };
  }
  const declaresScope = !!(initialScope?.applicability?.length || initialScope?.invalidators?.length || initialScope?.preservationSet?.length);
  if (declaresScope && !initialScope?.applicability?.length) {
    return { admitted: false, reason: "declares relation scope without applicability (not admittable, mirrors isScopeAdmittable)" };
  }
  return {
    admitted: true,
    candidate: {
      criterionId,
      family,
      applicability: initialScope?.applicability,
      invalidators: initialScope?.invalidators,
      preservationSet: initialScope?.preservationSet,
      openDefeaters: [],
      status: "candidate",
    },
  };
}
