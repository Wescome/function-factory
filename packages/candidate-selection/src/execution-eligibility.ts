import type { CandidateSelectionDecision } from "@factory/schemas"

export function assertExecutionEligibility(
  executableSpecificationId: string,
  selectionDecision: CandidateSelectionDecision
): void {
  if (selectionDecision !== "selected") {
    throw new Error(
      `Execution eligibility denied for ${executableSpecificationId}: linked ArchitectureCandidate is not selected`
    )
  }
}
