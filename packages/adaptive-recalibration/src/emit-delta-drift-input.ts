import type { DeltaDriftInput } from "@factory/schemas"
import { deltaDriftInputIdFromPressureId } from "./ids.js"

export function emitDeltaDriftInput(input: {
  sourcePressureId: string
  sourceRecalibratedPressureId: string
  driftIndicator: number
  deviationCount: number
  matchedCount: number
  sourceRefs: readonly string[]
}): DeltaDriftInput {
  return {
    id: deltaDriftInputIdFromPressureId(input.sourcePressureId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Drift-aware DEL input emitted deterministically from repeated observation outcomes.",
    sourcePressureId: input.sourcePressureId,
    sourceRecalibratedPressureId: input.sourceRecalibratedPressureId,
    driftIndicator: input.driftIndicator,
    deviationCount: input.deviationCount,
    matchedCount: input.matchedCount,
    summary: "Drift-aware input prepared for downstream capability-delta prioritization.",
  }
}
