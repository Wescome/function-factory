import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const ObservationOutcome = z.enum(["matched_expectation", "deviated", "inconclusive"])
export type ObservationOutcome = z.infer<typeof ObservationOutcome>

export const ObservationArtifact = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("OBS-"), "ObservationArtifact IDs must start with OBS-"),
  sourceExecutionResultId: ArtifactId,
  sourceEffectorRealizationId: ArtifactId,
  sourceExecutionTraceId: ArtifactId,
  expectedSummary: z.string().min(1),
  realizedSummary: z.string().min(1),
  outcome: ObservationOutcome,
  deltaSummary: z.string().min(1),
})
export type ObservationArtifact = z.infer<typeof ObservationArtifact>
