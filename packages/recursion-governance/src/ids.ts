export function governanceDecisionArtifactId(
  proposalId: string,
  decision: "allow" | "deny"
): string {
  return `RGD-${proposalId.replace(/^FP-/, "")}-${decision.toUpperCase()}`
}
