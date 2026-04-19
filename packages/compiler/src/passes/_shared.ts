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

/**
 * Construct a WorkGraph artifact ID from a PRD ID.
 *
 * Canonical format- `WG-${subject}` where `subject` is the PRD ID with
 * the leading `PRD-` stripped. Same derivation pattern as contractId.
 * Used by Pass 8 (08-assemble-workgraph) to name WorkGraphs emitted to
 * specs/workgraphs/.
 */
export function workGraphId(prdId: ArtifactId): ArtifactId {
  const subject = prdId.replace(/^PRD-/, "")
  return `WG-${subject}` as ArtifactId
}
