import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const RecalibratedPressure = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("RPRS-"), "RecalibratedPressure IDs must start with RPRS-"),
  sourcePressureId: ArtifactId,
  baselineStrength: z.number().min(0).max(1),
  baselineUrgency: z.number().min(0).max(1),
  feedbackInfluence: z.number().min(0).max(1),
  recalibratedStrength: z.number().min(0).max(1),
  recalibratedUrgency: z.number().min(0).max(1),
  summary: z.string().min(1),
})
export type RecalibratedPressure = z.infer<typeof RecalibratedPressure>

export const DeltaDriftInput = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("DDI-"), "DeltaDriftInput IDs must start with DDI-"),
  sourcePressureId: ArtifactId,
  sourceRecalibratedPressureId: ArtifactId,
  driftIndicator: z.number().min(0).max(1),
  deviationCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  summary: z.string().min(1),
})
export type DeltaDriftInput = z.infer<typeof DeltaDriftInput>
