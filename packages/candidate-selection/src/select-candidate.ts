import type {
  ArchitectureCandidateSelection,
  CandidateSelectionDecision,
} from "@factory/schemas"
import { selectionArtifactIdFromCandidateId } from "./ids.js"
import { scoreCandidate } from "./score-candidate.js"

export interface CandidateSelectionInput {
  readonly candidateId: string
  readonly sourceWorkGraphId: string
  readonly sourceRefs: readonly string[]
  readonly threshold?: number
}

export function selectCandidate(
  input: CandidateSelectionInput
): ArchitectureCandidateSelection {
  const threshold = input.threshold ?? 0.8
  const scorecard = scoreCandidate({ candidateId: input.candidateId })

  const decision: CandidateSelectionDecision =
    scorecard.totalScore >= threshold ? "selected" : "rejected"

  return {
    id: selectionArtifactIdFromCandidateId(input.candidateId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale:
      "Derived deterministically from ArchitectureCandidate scorecard and bootstrap threshold policy.",
    sourceArchitectureCandidateId: input.candidateId,
    sourceWorkGraphId: input.sourceWorkGraphId,
    decision,
    threshold,
    scorecard,
  }
}
