export function architectureCandidateIdFromPrdId(prdId: string): string {
  return prdId.replace(/^PRD-/, "AC-")
}
