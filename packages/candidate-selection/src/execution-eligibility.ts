import type { CandidateSelectionDecision } from "@factory/schemas"

export function assertExecutionEligibility(
  workGraphId: string,
  selectionDecision: CandidateSelectionDecision
): void {
  if (selectionDecision !== "selected") {
    throw new Error(
      `Execution eligibility denied for ${workGraphId}: linked ArchitectureCandidate is not selected`
    )
  }
}
