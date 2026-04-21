import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const SignalKind = z.enum(["external", "feedback", "inferred"])
export type SignalKind = z.infer<typeof SignalKind>

export const NormalizedSignal = z.object({
  id: ArtifactId,
  kind: SignalKind,
  title: z.string().min(1),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  severity: z.number().min(0).max(1),
  trustScore: z.number().min(0).max(1),
  effectiveWeight: z.number().min(0).max(1),
  dedupeKey: z.string().min(1),
})
export type NormalizedSignal = z.infer<typeof NormalizedSignal>

export const SignalNormalizationArtifact = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("SNB-"), "SignalNormalizationArtifact IDs must start with SNB-"),
  normalizedSignals: z.array(NormalizedSignal).min(1),
  duplicateSignalIds: z.array(ArtifactId),
  weightingPolicyId: ArtifactId,
  summary: z.string().min(1),
})
export type SignalNormalizationArtifact = z.infer<typeof SignalNormalizationArtifact>
