export function architectureCandidateIdFromIntentSpecificationId(intentSpecificationId: string): string {
  return intentSpecificationId.replace(/^IS-/, "AC-")
}
