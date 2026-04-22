import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const PolicyStressLevel = z.enum(["low", "moderate", "high"])
export type PolicyStressLevel = z.infer<typeof PolicyStressLevel>

export const PolicyStressReport = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("PSR-"), "PolicyStressReport IDs must start with PSR-"),
  targetPolicyId: ArtifactId,
  driftIndicator: z.number().min(0).max(1),
  deviationCount: z.number().int().nonnegative(),
  repeatedProposalCount: z.number().int().nonnegative(),
  stressLevel: PolicyStressLevel,
  summary: z.string().min(1),
})
export type PolicyStressReport = z.infer<typeof PolicyStressReport>

export const GovernanceProposal = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("GOVP-"), "GovernanceProposal IDs must start with GOVP-"),
  targetPolicyId: ArtifactId,
  proposedPolicyId: ArtifactId,
  proposalType: z.enum(["threshold_adjustment", "weight_adjustment", "cap_adjustment", "other"]),
  proposedChangeSummary: z.string().min(1),
  justification: z.string().min(1),
})
export type GovernanceProposal = z.infer<typeof GovernanceProposal>

export const GovernanceDecision = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("GOVD-"), "GovernanceDecision IDs must start with GOVD-"),
  sourceProposalId: ArtifactId,
  decision: z.enum(["approved", "rejected"]),
  decidedBy: z.string().min(1),
  decisionSummary: z.string().min(1),
})
export type GovernanceDecision = z.infer<typeof GovernanceDecision>

export const PolicySuccessorNote = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("GOVS-"), "PolicySuccessorNote IDs must start with GOVS-"),
  predecessorPolicyId: ArtifactId,
  sourceProposalId: ArtifactId,
  sourceDecisionId: ArtifactId,
  successorPolicyId: ArtifactId,
  activationState: z.enum(["proposed_only", "approved_not_activated", "activated"]),
  summary: z.string().min(1),
})
export type PolicySuccessorNote = z.infer<typeof PolicySuccessorNote>
