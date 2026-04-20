import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"
import { FunctionType } from "./core.js"

export const CapabilityDeltaStatus = z.enum([
  "missing",
  "degraded",
  "underutilized",
  "sufficient"
])
export type CapabilityDeltaStatus = z.infer<typeof CapabilityDeltaStatus>

export const DeltaDimension = z.enum([
  "execution",
  "control",
  "evidence",
  "integration"
])
export type DeltaDimension = z.infer<typeof DeltaDimension>

export const CapabilityDeltaFinding = z.object({
  dimension: DeltaDimension,
  status: CapabilityDeltaStatus,
  statement: z.string().min(1),
  evidenceRefs: z.array(ArtifactId).min(1),
  severity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1)
})
export type CapabilityDeltaFinding = z.infer<typeof CapabilityDeltaFinding>

export const CapabilityDelta = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("DEL-"),
    "CapabilityDelta IDs must start with DEL-"
  ),
  capabilityId: ArtifactId,
  overallStatus: CapabilityDeltaStatus,
  findings: z.array(CapabilityDeltaFinding).min(1),
  recommendedFunctionTypes: z.array(FunctionType).min(1)
})
export type CapabilityDelta = z.infer<typeof CapabilityDelta>
