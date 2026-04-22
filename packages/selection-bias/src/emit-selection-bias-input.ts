import type { SelectionBiasInput } from "@factory/schemas"
import { selectionBiasInputIdFromCandidateId } from "./ids.js"

export function emitSelectionBiasInput(input: {
  sourceArchitectureCandidateId: string
  sourceReliabilityId: string
  sourceDriftInputId: string
  reliabilityScore: number
  driftIndicator: number
  boundedBiasAdjustment: number
  sourceRefs: readonly string[]
}): SelectionBiasInput {
  return {
    id: selectionBiasInputIdFromCandidateId(input.sourceArchitectureCandidateId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Selection bias input emitted deterministically from reliability and bounded drift penalty.",
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceReliabilityId: input.sourceReliabilityId,
    sourceDriftInputId: input.sourceDriftInputId,
    reliabilityScore: input.reliabilityScore,
    driftIndicator: input.driftIndicator,
    boundedBiasAdjustment: input.boundedBiasAdjustment,
    summary: "Bounded selection-bias adjustment prepared for future ACS scoring.",
  }
}
