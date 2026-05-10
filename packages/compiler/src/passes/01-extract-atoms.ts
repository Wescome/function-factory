/**
 * Decomposition (legacy Pass 1)- extract atoms.
 *
 * Turns each list item in the Intent Specification's acceptanceCriteria, constraints,
 * and successMetrics sections into a RequirementAtom. Out-of-scope
 * items and prose sections (problem, goal) do not produce atoms- they
 * are context or boundaries, not requirements.
 *
 * Atom ID convention- `ATOM-<QUALIFIER>-<SUBJECT>-<CATEGORY>-<INDEX>`
 * where SUBJECT is derived from the Intent Specification ID (e.g., COHERENCE-VERIFICATION)
 * and INDEX is a zero-padded sequence per category.
 *
 * The MVP populates subject/action/object with bootstrap values- subject
 * is "Coherence Verification", action is "shall", object is the full item text. A
 * production compiler would parse the natural language into structured
 * subject/action/object triples, but the MVP keeps the atom content
 * intact in `object` so no information is lost, and the triple still
 * satisfies the schema's non-empty-string constraints.
 */

import type { ArtifactId, RequirementAtom } from "@factory/schemas"
import type { NormalizedIntentSpecification } from "../types.js"

export function extractAtoms(normalized: NormalizedIntentSpecification): RequirementAtom[] {
  const { draft } = normalized
  const atoms: RequirementAtom[] = []

  // Acceptance criteria → category "acceptance"
  draft.acceptanceCriteria.forEach((text, i) => {
    atoms.push(
      makeAtom({
        id: atomId(draft.id, "AC", i + 1),
        intentSpecificationId: draft.id,
        category: "acceptance",
        object: text,
        sourceSection: "acceptance criteria",
        index: i + 1,
      })
    )
  })

  // Constraints → category "constraint"
  draft.constraints.forEach((text, i) => {
    atoms.push(
      makeAtom({
        id: atomId(draft.id, "CONSTRAINT", i + 1),
        intentSpecificationId: draft.id,
        category: "constraint",
        object: text,
        sourceSection: "constraints",
        index: i + 1,
      })
    )
  })

  // Success metrics → category "nfr" (non-functional requirement; metrics
  // are quantitative quality attributes)
  draft.successMetrics.forEach((text, i) => {
    atoms.push(
      makeAtom({
        id: atomId(draft.id, "METRIC", i + 1),
        intentSpecificationId: draft.id,
        category: "nfr",
        object: text,
        sourceSection: "success metrics",
        index: i + 1,
      })
    )
  })

  return atoms
}

interface MakeAtomArgs {
  readonly id: ArtifactId
  readonly intentSpecificationId: ArtifactId
  readonly category: RequirementAtom["category"]
  readonly object: string
  readonly sourceSection: string
  readonly index: number
}

function makeAtom(args: MakeAtomArgs): RequirementAtom {
  return {
    id: args.id,
    source_refs: [args.intentSpecificationId],
    explicitness: "explicit",
    rationale: `Extracted from ${args.intentSpecificationId} ${args.sourceSection} item ${args.index}`,
    category: args.category,
    subject: "Coherence Verification",
    action: "shall",
    object: args.object,
    conditions: [],
    qualifiers: [],
    successCondition: null,
  }
}

/**
 * Build a valid ArtifactId for an atom extracted from a Intent Specification.
 * The Intent Specification ID is something like "IS-META-COHERENCE-VERIFICATION";
 * the atom ID reuses the subject portion after the IS- prefix.
 */
function atomId(intentSpecificationId: ArtifactId, tag: string, index: number): ArtifactId {
  const subject = intentSpecificationId.replace(/^IS-/, "")
  const padded = String(index).padStart(2, "0")
  return `ATOM-${subject}-${tag}-${padded}` as ArtifactId
}
