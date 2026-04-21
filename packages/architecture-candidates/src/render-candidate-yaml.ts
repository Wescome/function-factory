import type { ArchitectureCandidate } from "@factory/schemas"

export function renderArchitectureCandidateYaml(candidate: ArchitectureCandidate): string {
  return [
    `id: ${candidate.id}`,
    "source_refs:",
    ...candidate.source_refs.map((r) => `  - ${r}`),
    `explicitness: ${candidate.explicitness}`,
    `rationale: ${candidate.rationale}`,
    `sourcePrdId: ${candidate.sourcePrdId}`,
    `sourceWorkGraphId: ${candidate.sourceWorkGraphId}`,
    `candidateStatus: ${candidate.candidateStatus}`,
    "topology:",
    `  shape: ${candidate.topology.shape}`,
    `  summary: ${candidate.topology.summary}`,
    "modelBinding:",
    `  bindingMode: ${candidate.modelBinding.bindingMode}`,
    `  summary: ${candidate.modelBinding.summary}`,
    "toolPolicy:",
    `  mode: ${candidate.toolPolicy.mode}`,
    `  summary: ${candidate.toolPolicy.summary}`,
    "convergencePolicy:",
    `  mode: ${candidate.convergencePolicy.mode}`,
    `  summary: ${candidate.convergencePolicy.summary}`,
  ].join("\n")
}
