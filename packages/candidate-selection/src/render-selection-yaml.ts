import type { ArchitectureCandidateSelection } from "@factory/schemas"

export function renderSelectionYaml(
  selection: ArchitectureCandidateSelection
): string {
  const lines = [
    `id: ${selection.id}`,
    "source_refs:",
    ...selection.source_refs.map((r) => `  - ${r}`),
    `explicitness: ${selection.explicitness}`,
    `rationale: ${selection.rationale}`,
    `sourceArchitectureCandidateId: ${selection.sourceArchitectureCandidateId}`,
    `sourceWorkGraphId: ${selection.sourceWorkGraphId}`,
    `decision: ${selection.decision}`,
    `threshold: ${selection.threshold}`,
    "scorecard:",
    `  totalScore: ${selection.scorecard.totalScore}`,
    "  dimensions:",
  ]

  for (const d of selection.scorecard.dimensions) {
    lines.push("    -")
    lines.push(`      name: ${d.name}`)
    lines.push(`      score: ${d.score}`)
    lines.push(`      rationale: ${d.rationale}`)
  }

  return lines.join("\n")
}
