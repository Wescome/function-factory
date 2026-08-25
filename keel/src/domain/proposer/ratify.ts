/**
 * proposer/ratify.ts — B.6: ratify and write. The ONLY step in the whole
 * loop that touches a spec. On ratification, compile the candidate (its
 * R4 family + R1 scope) into the target criterion and run the resulting
 * child `SpecificationContent` through `freezeGate` — it must be
 * admissible, not exempt (A.4/D.7: "a ratified relation is written
 * THROUGH freezeGate like any other [derived spec]"). Rejection (or no
 * ratification at all) writes nothing; a gate reject ALSO writes nothing —
 * ratification is necessary but, exactly like every other derived spec in
 * this codebase, not sufficient on its own (INV-LP-SURFACE-NOT-CERTIFY /
 * D.4: nothing unratified is ever written, and nothing inadmissible is
 * written even once ratified).
 */
import type { SpecificationContent } from "../lineage/nodes";
import { freezeGate, type GateDecision, type GatePolicy } from "../spec-loop/gate";
import type { LiftCandidate } from "./candidate";

export type RatifyDecision =
  | { readonly ratified: true }
  | { readonly ratified: false; readonly reason: string };

export type WriteResult =
  | { readonly written: true; readonly spec: SpecificationContent; readonly gate: GateDecision }
  | { readonly written: false; readonly reason: string };

/**
 * `parent` is the spec BEFORE the lift (the criterion is still a bare
 * `example` on it); `root` anchors prohibitions/authority exactly as it
 * does for any other `freezeGate` call. The written `child` differs from
 * `parent` ONLY in the lifted criterion's shape — every other field
 * (connectors, forbids, spanning, behaviorDispositions, …) carries
 * unchanged, so every OTHER freezeGate check (`attenuates`,
 * `inheritsProhibitions`, `inheritsSpanning`, `inheritsDisposition`)
 * trivially holds exactly as it did for `parent` itself; only the NEW
 * family/scope checks (`isFamilyAdmittable`, `familyAdmissibleForDisposition`,
 * `isScopeAdmittable`, the three R1 inheritance checks) are actually live
 * here — and `propose.ts`/`challenge.ts` already keep the candidate
 * consistent with them throughout the loop, so a reject at this final
 * gate should be rare, not routine — but it is still checked for real,
 * never assumed or skipped (D.7: not exempt).
 */
export function ratifyAndWrite(
  candidate: LiftCandidate,
  decision: RatifyDecision,
  parent: SpecificationContent,
  root: SpecificationContent,
  policy: GatePolicy,
): WriteResult {
  if (!decision.ratified) return { written: false, reason: decision.reason };

  const targetIndex = parent.acceptance.findIndex((c) => c.id === candidate.criterionId);
  if (targetIndex < 0) return { written: false, reason: `criterion ${candidate.criterionId} not found on the parent spec` };

  const child: SpecificationContent = {
    ...parent,
    acceptance: parent.acceptance.map((c) =>
      c.id === candidate.criterionId
        ? {
            ...c,
            kind: "property" as const,
            family: candidate.family,
            applicability: candidate.applicability,
            invalidators: candidate.invalidators,
            preservationSet: candidate.preservationSet,
          }
        : c,
    ),
  };

  const gate = freezeGate(child, parent, root, policy);
  if (gate.tier === "reject") return { written: false, reason: `freezeGate rejected: ${gate.reasons.join("; ")}` };
  return { written: true, spec: child, gate };
}
