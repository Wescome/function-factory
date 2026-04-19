import type { ArtifactId } from "@factory/schemas"

/**
 * Construct a Contract artifact ID from a PRD ID and a tag.
 *
 * Canonical format- `CONTRACT-${subject}-${tag}` where `subject` is the
 * PRD ID with the leading `PRD-` stripped, and `tag` is the contract's
 * semantic label (typically the uppercased atom category- `CONSTRAINT`,
 * `ACCEPTANCE`, `NFR`).
 *
 * Pass 2 (02-derive-contracts) uses this to emit contract IDs.
 * Pass 3 (03-derive-invariants) uses the same function to reconstruct
 * the lookup string when joining invariants to their constraint
 * contract. One helper eliminates the drift risk that existed when
 * emission and lookup were two independent template-literal sites.
 */
export function contractId(prdId: ArtifactId, tag: string): ArtifactId {
  const subject = prdId.replace(/^PRD-/, "")
  return `CONTRACT-${subject}-${tag}` as ArtifactId
}
