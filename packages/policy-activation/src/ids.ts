export function policyActivationIdFromSuccessorId(successorPolicyId: string): string {
  return successorPolicyId.replace(/^GOV-/, "GOVA-")
}

export function rollbackPlanIdFromSuccessorId(successorPolicyId: string): string {
  return successorPolicyId.replace(/^GOV-/, "GOVR-")
}
