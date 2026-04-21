import type { ObservationArtifact } from "@factory/schemas"

export function renderObservationYaml(obs: ObservationArtifact): string {
  return [
    `id: ${obs.id}`,
    "source_refs:",
    ...obs.source_refs.map((r) => `  - ${r}`),
    `explicitness: ${obs.explicitness}`,
    `rationale: ${obs.rationale}`,
    `sourceExecutionResultId: ${obs.sourceExecutionResultId}`,
    `sourceEffectorRealizationId: ${obs.sourceEffectorRealizationId}`,
    `sourceExecutionTraceId: ${obs.sourceExecutionTraceId}`,
    `expectedSummary: ${obs.expectedSummary}`,
    `realizedSummary: ${obs.realizedSummary}`,
    `outcome: ${obs.outcome}`,
    `deltaSummary: ${obs.deltaSummary}`,
  ].join("\n")
}
