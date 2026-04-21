import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const CandidateSelectionDecision = z.enum(["selected", "rejected"])
export type CandidateSelectionDecision = z.infer<typeof CandidateSelectionDecision>

export const CandidateScoreDimension = z.object({
  name: z.enum([
    "topologyComplexity",
    "policyRisk",
    "toolExposure",
    "convergenceStrictness",
    "runtimeReadiness"
  ]),
  score: z.number().min(0).max(1),
  rationale: z.string().min(1),
})
export type CandidateScoreDimension = z.infer<typeof CandidateScoreDimension>

export const CandidateScorecard = z.object({
  dimensions: z.array(CandidateScoreDimension).length(5),
  totalScore: z.number().min(0).max(1),
})
export type CandidateScorecard = z.infer<typeof CandidateScorecard>

export const ArchitectureCandidateSelection = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("ACS-"),
    "ArchitectureCandidateSelection IDs must start with ACS-"
  ),
  sourceArchitectureCandidateId: ArtifactId,
  sourceWorkGraphId: ArtifactId,
  decision: CandidateSelectionDecision,
  threshold: z.number().min(0).max(1),
  scorecard: CandidateScorecard,
})
export type ArchitectureCandidateSelection = z.infer<typeof ArchitectureCandidateSelection>
