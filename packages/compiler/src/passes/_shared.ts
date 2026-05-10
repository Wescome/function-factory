import type { ArtifactId } from "@factory/schemas"

/**
 * Construct a Contract artifact ID from a PRD ID and a tag.
 *
 * Canonical format- `CONTRACT-${subject}-${tag}` where `subject` is the
 * PRD ID with the leading `PRD-` stripped, and `tag` is the contract's
 * semantic label (typically the uppercased atom category- `CONSTRAINT`,
 * `ACCEPTANCE`, `NFR`).
 *
 * Binding (legacy 02-derive-contracts) uses this to emit contract IDs.
 * Obligation Extraction (legacy 03-derive-invariants) uses the same function to reconstruct
 * the lookup string when joining invariants to their constraint
 * contract. One helper eliminates the drift risk that existed when
 * emission and lookup were two independent template-literal sites.
 */
export function contractId(prdId: ArtifactId, tag: string): ArtifactId {
  const subject = prdId.replace(/^PRD-/, "")
  return `CONTRACT-${subject}-${tag}` as ArtifactId
}

/**
 * Construct an Executable Specification artifact ID from a PRD ID.
 *
 * Canonical format- `WG-${subject}` where `subject` is the PRD ID with
 * the leading `PRD-` stripped. Same derivation pattern as contractId.
 * Used by Executable Specification Assembly to name emitted artifacts.
 */
export function executableSpecificationId(prdId: ArtifactId): ArtifactId {
  const subject = prdId.replace(/^PRD-/, "")
  return `WG-${subject}` as ArtifactId
}
