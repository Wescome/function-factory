/**
 * Pass 4- derive dependencies.
 *
 * The MVP emits no typed-edge dependencies. Gate 1's dependency_closure
 * check passes vacuously on an empty dependency set- there are no
 * endpoints to resolve. This is acceptable for the bootstrap proof-
 * what matters is that every check runs and emits a verdict, not that
 * every check's failure mode is exercised in the first compile.
 *
 * The function signature is retained so a later enrichment pass can
 * add the real behavior- linking atoms to the invariants they motivate,
 * contracts to the atoms they derive from, etc. The compile orchestrator
 * calls this pass unconditionally; swapping in a richer implementation
 * is purely additive.
 */

import type {
  Contract,
  Dependency,
  Invariant,
  RequirementAtom,
} from "@factory/schemas"
import type { NormalizedPRD } from "../types.js"

export function deriveDependencies(
  _normalized: NormalizedPRD,
  _atoms: readonly RequirementAtom[],
  _contracts: readonly Contract[],
  _invariants: readonly Invariant[]
): Dependency[] {
  return []
}
