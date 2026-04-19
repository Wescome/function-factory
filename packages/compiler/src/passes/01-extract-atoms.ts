/**
 * Pass 1- extract atoms.
 *
 * Turns each list item in the PRD's acceptanceCriteria, constraints,
 * and successMetrics sections into a RequirementAtom. Out-of-scope
 * items and prose sections (problem, goal) do not produce atoms- they
 * are context or boundaries, not requirements.
 *
 * Atom ID convention- `ATOM-<QUALIFIER>-<SUBJECT>-<CATEGORY>-<INDEX>`
 * where SUBJECT is derived from the PRD ID (e.g., GATE-1-COMPILE-COVERAGE)
 * and INDEX is a zero-padded sequence per category.
 *
 * The MVP populates subject/action/object with bootstrap values- subject
 * is "Gate 1", action is "shall", object is the full item text. A
 * production compiler would parse the natural language into structured
 * subject/action/object triples, but the MVP keeps the atom content
 * intact in `object` so no information is lost, and the triple still
 * satisfies the schema's non-empty-string constraints.
 */

import type { ArtifactId, RequirementAtom } from "@factory/schemas"
import type { NormalizedPRD } from "../types.js"

export function extractAtoms(normalized: NormalizedPRD): RequirementAtom[] {
  const { draft } = normalized
  const atoms: RequirementAtom[] = []

  // Acceptance criteria → category "acceptance"
  draft.acceptanceCriteria.forEach((text, i) => {
    atoms.push(
      makeAtom({
        id: atomId(draft.id, "AC", i + 1),
        prdId: draft.id,
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
        prdId: draft.id,
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
        prdId: draft.id,
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
  readonly prdId: ArtifactId
  readonly category: RequirementAtom["category"]
  readonly object: string
  readonly sourceSection: string
  readonly index: number
}

function makeAtom(args: MakeAtomArgs): RequirementAtom {
  return {
    id: args.id,
    source_refs: [args.prdId],
    explicitness: "explicit",
    rationale: `Extracted from ${args.prdId} ${args.sourceSection} item ${args.index}`,
    category: args.category,
    subject: "Gate 1",
    action: "shall",
    object: args.object,
    conditions: [],
    qualifiers: [],
    successCondition: null,
  }
}

/**
 * Build a valid ArtifactId for an atom extracted from a PRD.
 * The PRD ID is something like "PRD-META-GATE-1-COMPILE-COVERAGE";
 * the atom ID reuses the subject portion after the PRD- prefix.
 */
function atomId(prdId: ArtifactId, tag: string, index: number): ArtifactId {
  const subject = prdId.replace(/^PRD-/, "")
  const padded = String(index).padStart(2, "0")
  return `ATOM-${subject}-${tag}-${padded}` as ArtifactId
}
