/**
 * Deterministic PRD ID helper for the first narrow bridge.
 */
export function prdIdFromFunctionProposalId(functionProposalId: string): string {
  return functionProposalId.replace(/^FP-/, "PRD-")
}
