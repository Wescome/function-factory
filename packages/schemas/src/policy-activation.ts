import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const PolicyRolloutState = z.enum(["shadow", "partial", "full"])
export type PolicyRolloutState = z.infer<typeof PolicyRolloutState>

export const PolicyActivation = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("GOVA-"), "PolicyActivation IDs must start with GOVA-"),
  predecessorPolicyId: ArtifactId,
  successorPolicyId: ArtifactId,
  sourceProposalId: ArtifactId,
  sourceDecisionId: ArtifactId,
  sourceSuccessorNoteId: ArtifactId,
  rolloutState: PolicyRolloutState,
  rollbackTargetPolicyId: ArtifactId,
  activationSummary: z.string().min(1),
}).refine(
  (d) => d.rollbackTargetPolicyId === d.predecessorPolicyId,
  "Bootstrap: rollback target must be predecessor. Remove this constraint when multi-hop rollback is implemented."
)
export type PolicyActivation = z.infer<typeof PolicyActivation>

export const PolicyRollbackPlan = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("GOVR-"), "PolicyRollbackPlan IDs must start with GOVR-"),
  sourceActivationId: ArtifactId,
  predecessorPolicyId: ArtifactId,
  successorPolicyId: ArtifactId,
  rollbackTargetPolicyId: ArtifactId,
  rolloutStateAtCreation: PolicyRolloutState,
  rollbackSummary: z.string().min(1),
}).refine(
  (d) => d.rollbackTargetPolicyId === d.predecessorPolicyId,
  "Bootstrap: rollback target must be predecessor. Remove this constraint when multi-hop rollback is implemented."
)
export type PolicyRollbackPlan = z.infer<typeof PolicyRollbackPlan>
