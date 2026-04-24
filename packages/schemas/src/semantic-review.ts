/**
 * Semantic Review Report schema.
 *
 * Output of the Architect Semantic Review pass that runs between
 * structural coverage (Gate 1) and WorkGraph emission. Validates
 * that whitepaper concepts are faithfully represented in the
 * compiled artifact set before planning begins.
 */

import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const SemanticReviewStatus = z.enum(["approved", "rejected", "needs_revision"])
export type SemanticReviewStatus = z.infer<typeof SemanticReviewStatus>

export const UpstreamMachineryCheck = z.object({
  sources: z.array(z.string().min(1)).min(1),
  concepts_considered: z.array(z.string().min(1)).min(1),
  missing_machinery: z.array(z.string()).default([]),
  rationale: z.string().min(1),
})
export type UpstreamMachineryCheck = z.infer<typeof UpstreamMachineryCheck>

export const SemanticReviewReport = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("SRR-"),
    "SemanticReviewReport IDs must start with SRR-"
  ),
  status: SemanticReviewStatus,
  reviewer: z.string().min(1),
  whitepaper_sections_checked: z.array(z.string().min(1)).min(1),
  findings: z.array(z.string().min(1)).default([]),
  upstream_machinery_checked: UpstreamMachineryCheck,
})
export type SemanticReviewReport = z.infer<typeof SemanticReviewReport>
