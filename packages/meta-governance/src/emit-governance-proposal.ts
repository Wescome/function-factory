import type { GovernanceProposal } from "@factory/schemas"
import { governanceProposalIdFromPolicyId } from "./ids.js"

export function emitGovernanceProposal(input: {
  targetPolicyId: string
  sourceStressReportId: string
  proposedPolicyId: string
  proposalType: "threshold_adjustment" | "weight_adjustment" | "cap_adjustment" | "other"
  proposedChangeSummary: string
  justification: string
  sourceRefs: readonly string[]
}): GovernanceProposal {
  return {
    id: governanceProposalIdFromPolicyId(input.targetPolicyId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Governance proposal emitted deterministically from policy stress evidence.",
    targetPolicyId: input.targetPolicyId,
    proposedPolicyId: input.proposedPolicyId,
    proposalType: input.proposalType,
    proposedChangeSummary: input.proposedChangeSummary,
    justification: input.justification,
  }
}
