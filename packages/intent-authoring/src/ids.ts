/**
 * Deterministic Intent Specification ID helper for the first narrow bridge.
 */
export function intentSpecificationIdFromFunctionProposalId(functionProposalId: string): string {
  return functionProposalId.replace(/^FP-/, "IS-")
}
