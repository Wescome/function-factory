export function assertActivationAllowed(input: {
  decision: "approved" | "rejected"
  autoActivationAllowed: boolean
  decisionSourceProposalId: string
  activationSourceProposalId: string
}): void {
  if (input.decision !== "approved") {
    throw new Error("Policy activation denied: governance decision is not approved")
  }
  if (input.autoActivationAllowed) {
    throw new Error("Policy activation denied: auto-activation must remain disabled")
  }
  if (input.decisionSourceProposalId !== input.activationSourceProposalId) {
    throw new Error("Policy activation denied: decision proposal ID does not match activation proposal ID")
  }
}
