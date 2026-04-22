export function candidateReliabilityIdFromCandidateId(candidateId: string): string {
  return candidateId.replace(/^AC-/, "CRL-")
}

export function selectionBiasInputIdFromCandidateId(candidateId: string): string {
  return candidateId.replace(/^AC-/, "SBI-")
}
