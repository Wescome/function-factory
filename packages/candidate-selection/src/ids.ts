export function selectionArtifactIdFromCandidateId(candidateId: string): string {
  return candidateId.replace(/^AC-/, "ACS-")
}
