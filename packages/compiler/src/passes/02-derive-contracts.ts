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
 * Contract ID prefix- FN-. The ArtifactId regex allows any of
 * (PRS|BC|FN|FP|PRD|WG|INV|VAL|DEP|ATOM|CR|TRJ|PF|INC|DET|DEL|SIG).
 * Contracts describe function behavior, so FN- is the closest semantic
 * match; the "CONTRACT" segment inside the ID distinguishes Contracts
 * from Function artifacts proper.
 */

import type { ArtifactId, Contract, RequirementAtom } from "@factory/schemas"
import type { NormalizedPRD } from "../types.js"

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
  const subject = prdId.replace(/^PRD-/, "")
  const tag = category.toUpperCase()
  const id = `FN-${subject}-CONTRACT-${tag}` as ArtifactId
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
