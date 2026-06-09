/**
 * Structural Assembly validation wiring (legacy Pass 5)- derive validations.
 *
 * For each Invariant, emit a ValidationSpec whose `coversInvariantIds`
 * contains the invariant's ID. This ensures Coherence Verification's invariant_coverage
 * check passes- every invariant has ≥1 covering validation.
 *
 * Each emitted validation also backmaps to the source atom(s) via
 * `coversAtomIds`, reinforcing atom coverage via a second path (in
 * addition to contracts from Binding).
 *
 * Validation kind is "property" for all MVP-emitted validations — each
 * asserts an invariant holds as a property of the compiled system.
 * Priority is "required" because every Coherence Verification invariant is load-bearing
 * for the Factory's audit claim.
 */

import type {
  ArtifactId,
  Contract,
  Dependency,
  Invariant,
  RequirementAtom,
  ValidationSpec,
} from "@factory/schemas"
import type { NormalizedIntentSpecification } from "../types.js"

export function deriveValidations(
  normalized: NormalizedIntentSpecification,
  _atoms: readonly RequirementAtom[],
  _contracts: readonly Contract[],
  invariants: readonly Invariant[],
  _dependencies: readonly Dependency[]
): ValidationSpec[] {
  const { draft } = normalized
  const subject = draft.id.replace(/^IS-/, "")

  const validations: ValidationSpec[] = invariants.map((inv, i) => {
    const index = String(i + 1).padStart(2, "0")
    return {
      id: `VAL-${subject}-VAL-${index}` as ArtifactId,
      source_refs: [inv.id, draft.id, ...inv.derivedFromAtomIds],
      explicitness: "explicit",
      rationale: `Regression validation covering invariant ${inv.id}; required by Coherence Verification invariant_coverage discipline`,
      kind: "property",
      statement: `Assert invariant- ${inv.statement}`,
      targetRefs: [inv.id],
      coversAtomIds: [...inv.derivedFromAtomIds],
      coversContractIds: [],
      coversInvariantIds: [inv.id],
      priority: "required",
    }
  })

  // Deterministic ordering
  validations.sort((a, b) => a.id.localeCompare(b.id))
  return validations
}
