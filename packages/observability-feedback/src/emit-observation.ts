import type { ObservationArtifact } from "@factory/schemas"
import { observationIdFromExecutionResultId } from "./ids.js"

export function emitObservation(input: {
  sourceExecutionResultId: string
  sourceEffectorRealizationId: string
  sourceExecutionTraceId: string
  expectedSummary: string
  realizedSummary: string
  sourceRefs: readonly string[]
}): ObservationArtifact {
  const outcome =
    input.expectedSummary === input.realizedSummary
      ? "matched_expectation"
      : "deviated"

  return {
    id: observationIdFromExecutionResultId(input.sourceExecutionResultId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Observation emitted deterministically from execution result and realization evidence.",
    sourceExecutionResultId: input.sourceExecutionResultId,
    sourceEffectorRealizationId: input.sourceEffectorRealizationId,
    sourceExecutionTraceId: input.sourceExecutionTraceId,
    expectedSummary: input.expectedSummary,
    realizedSummary: input.realizedSummary,
    outcome,
    deltaSummary:
      outcome === "matched_expectation"
        ? "Realized outcome matched expectation in the bootstrap path."
        : "Realized outcome deviated from expectation in the bootstrap path.",
  }
}
