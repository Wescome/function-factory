export function policyStressReportIdFromPolicyId(policyId: string): string {
  return policyId.replace(/^GOV-/, "PSR-")
}

export function governanceProposalIdFromPolicyId(policyId: string): string {
  return policyId.replace(/^GOV-/, "GOVP-")
}

export function governanceDecisionIdFromProposalId(proposalId: string): string {
  return proposalId.replace(/^GOVP-/, "GOVD-")
}

export function policySuccessorNoteIdFromPolicyId(policyId: string): string {
  return policyId.replace(/^GOV-/, "GOVS-")
}
