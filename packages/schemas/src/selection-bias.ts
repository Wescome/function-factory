import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const CandidateReliability = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("CRL-"), "CandidateReliability IDs must start with CRL-"),
  sourceArchitectureCandidateId: ArtifactId,
  matchedCount: z.number().int().nonnegative(),
  deviatedCount: z.number().int().nonnegative(),
  reliabilityScore: z.number().min(0).max(1),
  summary: z.string().min(1),
})
export type CandidateReliability = z.infer<typeof CandidateReliability>

export const SelectionBiasInput = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("SBI-"), "SelectionBiasInput IDs must start with SBI-"),
  sourceArchitectureCandidateId: ArtifactId,
  sourceReliabilityId: ArtifactId,
  sourceDriftInputId: ArtifactId,
  reliabilityScore: z.number().min(0).max(1),
  driftIndicator: z.number().min(0).max(1),
  // Schema allows [-0.25, +0.25] structural headroom; policy enforces [-0.2, +0.15]
  boundedBiasAdjustment: z.number().min(-0.25).max(0.25),
  summary: z.string().min(1),
})
export type SelectionBiasInput = z.infer<typeof SelectionBiasInput>

// ─── Bias Report ────────────────────────────────────────────────────

export const BiasReport = z.object({
  id: z.string().min(1),
  candidate_family: z.string().min(1),
  observed_selection_rate: z.number().min(0).max(1),
  expected_selection_rate: z.number().min(0).max(1),
  bias_magnitude: z.number(),
  confidence: z.number().min(0).max(1),
  recommendation: z.string().min(1),
})
export type BiasReport = z.infer<typeof BiasReport>
