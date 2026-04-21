import { governanceDecisionArtifactId } from "./ids.js"
import type { GovernanceEvaluationResult } from "./types.js"

export function renderGovernanceDecisionArtifact(
  result: GovernanceEvaluationResult
): { id: string; filename: string; yaml: string } {
  const id = governanceDecisionArtifactId(result.proposalId, result.decision)

  const yaml = [
    `id: ${id}`,
    "source_refs:",
    `  - ${result.proposalId}`,
    "explicitness: inferred",
    `rationale: ${result.reason}`,
    `proposalId: ${result.proposalId}`,
    `policyMode: ${result.policyMode}`,
    `decision: ${result.decision}`,
  ].join("\n")

  return {
    id,
    filename: `${id}.yaml`,
    yaml,
  }
}
