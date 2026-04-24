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

// ─── Governance Metrics ─────────────────────────────────────────────

export const GovernanceMetrics = z.object({
  architect_override_rate: z.number().min(0).max(1),
  approval_latency_p50: z.number().nonnegative(),
  approval_latency_p95: z.number().nonnegative(),
  decisions_logged_rate: z.number().min(0).max(1),
  role_boundary_violation_rate: z.number().min(0).max(1),
})
export type GovernanceMetrics = z.infer<typeof GovernanceMetrics>

// ─── Policy Stress Indicator ────────────────────────────────────────

export const PolicyStressType = z.enum([
  "override_spike",
  "latency_breach",
  "violation_cluster",
  "repeated_proposal",
  "drift_accumulation",
])
export type PolicyStressType = z.infer<typeof PolicyStressType>

export const PolicyStressIndicator = z.object({
  policy_id: ArtifactId,
  stress_type: PolicyStressType,
  magnitude: z.number().min(0).max(1),
  trigger_source: z.string().min(1),
  detected_at: z.string().datetime(),
})
export type PolicyStressIndicator = z.infer<typeof PolicyStressIndicator>

// ─── Amendment Record ───────────────────────────────────────────────

export const AmendmentClass = z.enum(["A", "B", "C"])
export type AmendmentClass = z.infer<typeof AmendmentClass>

export const AmendmentRecord = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("AMD-"),
    "AmendmentRecord IDs must start with AMD-"
  ),
  amendment_class: AmendmentClass,
  changed_node_types: z.array(z.string().min(1)).min(1),
  prior_default: z.string().min(1),
  new_default: z.string().min(1),
  evidence_basis: z.array(z.string().min(1)).min(1),
  expected_impact: z.string().min(1),
  approved_by: z.string().min(1),
  approved_at: z.string().datetime(),
})
export type AmendmentRecord = z.infer<typeof AmendmentRecord>

// ─── Policy Action ──────────────────────────────────────────────────

export const PolicyActionType = z.enum(["activate", "deactivate", "rollback", "amend"])
export type PolicyActionType = z.infer<typeof PolicyActionType>

export const PolicyAction = z.object({
  action_type: PolicyActionType,
  target_policy_id: ArtifactId,
  rationale: z.string().min(1),
  rollback_plan: z.string().min(1),
  activated_at: z.string().datetime(),
})
export type PolicyAction = z.infer<typeof PolicyAction>
