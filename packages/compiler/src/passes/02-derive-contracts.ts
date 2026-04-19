/**
 * Pass 2- derive contracts.
 *
 * Produces one Contract per atom category (acceptance, constraint,
 * nfr), each with `derivedFromAtomIds` containing every atom in that
 * category. This ensures atom_coverage in Gate 1 passes- every atom
 * is referenced by ≥1 downstream artifact (a Contract that derived
 * from it).
 *
 * A production compiler would cluster atoms by semantic relation and
 * produce finer-grained contracts- one per behavior (e.g., pass
 * behavior, fail behavior, emission, determinism). The MVP uses
 * category-level clustering because it is mechanical, coverage-
 * complete, and adequate for bootstrap proof.
 *
 * Contract ID prefix- CONTRACT-. Added to the ArtifactId regex in the
 * paired schemas PR (2026-04-19) so Contracts are first-class artifacts
 * with their own prefix namespace rather than sharing the FN- namespace
 * via an internal -CONTRACT- segment.
 */

import type { ArtifactId, Contract, RequirementAtom } from "@factory/schemas"
import type { NormalizedPRD } from "../types.js"
import { contractId } from "./_shared.js"

export function deriveContracts(
  normalized: NormalizedPRD,
  atoms: readonly RequirementAtom[]
): Contract[] {
  const { draft } = normalized
  const byCategory = new Map<string, RequirementAtom[]>()

  for (const a of atoms) {
    const bucket = byCategory.get(a.category) ?? []
    bucket.push(a)
    byCategory.set(a.category, bucket)
  }

  const contracts: Contract[] = []
  for (const [category, categoryAtoms] of byCategory) {
    if (categoryAtoms.length === 0) continue
    contracts.push(buildContract(draft.id, category, categoryAtoms))
  }

  // Sort for determinism- contract IDs are stable across runs.
  contracts.sort((a, b) => a.id.localeCompare(b.id))
  return contracts
}

function buildContract(
  prdId: ArtifactId,
  category: string,
  categoryAtoms: readonly RequirementAtom[]
): Contract {
  const tag = category.toUpperCase()
  const id = contractId(prdId, tag)
  const atomIds = categoryAtoms.map((a) => a.id)

  return {
    id,
    source_refs: [prdId, ...atomIds],
    explicitness: "explicit",
    rationale: `Derived from ${categoryAtoms.length} ${category}-category atoms in ${prdId}`,
    kind: categoryForKind(category),
    statement: `Aggregate contract for ${category}-category requirements of ${prdId}`,
    producerHint: null,
    consumerHints: [],
    derivedFromAtomIds: atomIds,
  }
}

/**
 * Map atom category to Contract kind. The mapping is conservative-
 * acceptance criteria translate to behavior contracts (what the
 * function must do); constraints translate to invariant contracts
 * (what must always hold); nfrs translate to behavior contracts
 * (quantitative behavioral expectations).
 */
function categoryForKind(category: string): Contract["kind"] {
  switch (category) {
    case "constraint":
      return "invariant"
    case "acceptance":
      return "behavior"
    case "nfr":
      return "behavior"
    default:
      return "behavior"
  }
}
