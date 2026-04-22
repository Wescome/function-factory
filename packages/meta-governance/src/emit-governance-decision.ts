import type { GovernanceDecision } from "@factory/schemas"
import { governanceDecisionIdFromProposalId } from "./ids.js"

export function emitGovernanceDecision(input: {
  sourceProposalId: string
  decision: "approved" | "rejected"
  decidedBy: string
  decisionSummary: string
  sourceRefs: readonly string[]
}): GovernanceDecision {
  return {
    id: governanceDecisionIdFromProposalId(input.sourceProposalId),
    source_refs: [...input.sourceRefs],
    explicitness: "explicit",
    rationale: "Governance decision recorded explicitly under human authority.",
    sourceProposalId: input.sourceProposalId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    decisionSummary: input.decisionSummary,
  }
}
