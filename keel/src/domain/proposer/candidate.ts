/**
 * proposer/candidate.ts — PLAYBOOK-KEEL-LIFT-PROPOSER-001 (B1 capstone): the
 * candidate artifact the whole loop revolves around. A candidate is DATA,
 * never a spec mutation — the containment is the point: nothing here can
 * write to a spec. Only `ratify.ts`'s `ratifyAndWrite`, gated on an
 * authority's ratification, ever touches one (INV-LP-SURFACE-NOT-CERTIFY).
 */
import type { PropertyFamily } from "../lineage/nodes";

/** B.4: how a defeating case's legitimacy has been settled.
 *  - `confirmed-illegitimate`: the requirement doesn't require this case —
 *    narrow applicability to exclude it (challenge.ts).
 *  - `confirmed-legitimate`: a REAL violation — the candidate is defeated,
 *    not narrowable away (B.3, "never surfaced as-is").
 *  - `unsettled`: neither confirmed — registered as an open defeater AND
 *    added as an invalidator (so future evaluation reads it "inconclusive",
 *    not silently "pass"), travels to the authority (B.4). */
export type DefeaterLegitimacy = "confirmed-illegitimate" | "confirmed-legitimate" | "unsettled";

/** A case the candidate's family probe failed, not yet resolved by
 *  narrowing — never dropped silently (INV-LP-DEFEATER-REGISTERED). */
export interface Defeater {
  readonly input: number;
  readonly reason: string;
  readonly legitimacy: DefeaterLegitimacy;
}

export type LiftCandidateStatus = "candidate" | "surfaced" | "ratified" | "rejected";

export interface LiftCandidate {
  /** The `example` criterion id being lifted into a typed `property`. */
  readonly criterionId: string;
  /** INV-LP-PROPOSE-TYPED: always a typed R4 family, never opaque code. */
  readonly family: PropertyFamily;
  /** R1 scope the candidate currently carries — grows only, as challenge
   *  narrows it (challenge.ts). */
  readonly applicability?: readonly string[];
  readonly invalidators?: readonly string[];
  readonly preservationSet?: readonly string[];
  readonly openDefeaters: readonly Defeater[];
  readonly status: LiftCandidateStatus;
}
