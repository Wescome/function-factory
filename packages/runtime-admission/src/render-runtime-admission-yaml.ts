import type { RuntimeAdmissionArtifact } from "@factory/schemas"

export function renderRuntimeAdmissionYaml(admission: RuntimeAdmissionArtifact): string {
  return [
    `id: ${admission.id}`,
    "source_refs:",
    ...admission.source_refs.map((r) => `  - ${r}`),
    `explicitness: ${admission.explicitness}`,
    `rationale: ${admission.rationale}`,
    `sourceWorkGraphId: ${admission.sourceWorkGraphId}`,
    `sourceArchitectureCandidateId: ${admission.sourceArchitectureCandidateId}`,
    `sourceSelectionId: ${admission.sourceSelectionId}`,
    `decision: ${admission.decision}`,
    `reason: ${admission.reason}`,
  ].join("\n")
}
