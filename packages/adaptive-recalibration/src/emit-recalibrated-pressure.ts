import type { RecalibratedPressure } from "@factory/schemas"
import { recalibratedPressureIdFromPressureId } from "./ids.js"

export function emitRecalibratedPressure(input: {
  sourcePressureId: string
  baselineStrength: number
  baselineUrgency: number
  feedbackInfluence: number
  recalibratedStrength: number
  recalibratedUrgency: number
  sourceRefs: readonly string[]
}): RecalibratedPressure {
  return {
    id: recalibratedPressureIdFromPressureId(input.sourcePressureId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Pressure recalibrated deterministically from weighted signals and bounded drift input.",
    sourcePressureId: input.sourcePressureId,
    baselineStrength: input.baselineStrength,
    baselineUrgency: input.baselineUrgency,
    feedbackInfluence: input.feedbackInfluence,
    recalibratedStrength: input.recalibratedStrength,
    recalibratedUrgency: input.recalibratedUrgency,
    summary: "Recalibrated pressure emitted under bounded feedback influence policy.",
  }
}
