import type { PolicySuccessorNote } from "@factory/schemas"
import { policySuccessorNoteIdFromPolicyId } from "./ids.js"

export function emitPolicySuccessorNote(input: {
  predecessorPolicyId: string
  sourceProposalId: string
  sourceDecisionId: string
  successorPolicyId: string
  activationState: "proposed_only" | "approved_not_activated" | "activated"
  sourceRefs: readonly string[]
}): PolicySuccessorNote {
  return {
    id: policySuccessorNoteIdFromPolicyId(input.predecessorPolicyId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Policy successor lineage note emitted deterministically from proposal and human decision.",
    predecessorPolicyId: input.predecessorPolicyId,
    sourceProposalId: input.sourceProposalId,
    sourceDecisionId: input.sourceDecisionId,
    successorPolicyId: input.successorPolicyId,
    activationState: input.activationState,
    summary: "Governance lineage note connecting predecessor, proposal, decision, and successor policy.",
  }
}
