import type { PolicyActivation } from "@factory/schemas"
import { policyActivationIdFromSuccessorId } from "./ids.js"
import { assertActivationAllowed } from "./assert-activation-allowed.js"

export function emitPolicyActivation(input: {
  predecessorPolicyId: string
  successorPolicyId: string
  sourceProposalId: string
  sourceDecisionId: string
  sourceSuccessorNoteId: string
  decision: "approved" | "rejected"
  decisionSourceProposalId: string
  autoActivationAllowed: boolean
  rolloutState: "shadow" | "partial" | "full"
  sourceRefs: readonly string[]
}): PolicyActivation {
  assertActivationAllowed({
    decision: input.decision,
    autoActivationAllowed: input.autoActivationAllowed,
    decisionSourceProposalId: input.decisionSourceProposalId,
    activationSourceProposalId: input.sourceProposalId,
  })

  return {
    id: policyActivationIdFromSuccessorId(input.successorPolicyId),
    source_refs: [...input.sourceRefs],
    explicitness: "explicit",
    rationale: "Policy activation recorded explicitly after human approval and staged rollout choice.",
    predecessorPolicyId: input.predecessorPolicyId,
    successorPolicyId: input.successorPolicyId,
    sourceProposalId: input.sourceProposalId,
    sourceDecisionId: input.sourceDecisionId,
    sourceSuccessorNoteId: input.sourceSuccessorNoteId,
    rolloutState: input.rolloutState,
    rollbackTargetPolicyId: input.predecessorPolicyId,
    activationSummary: "Approved successor policy activated under controlled rollout with rollback preserved.",
  }
}
