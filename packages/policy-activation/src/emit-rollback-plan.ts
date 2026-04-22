import type { PolicyRollbackPlan } from "@factory/schemas"
import { rollbackPlanIdFromSuccessorId } from "./ids.js"

export function emitRollbackPlan(input: {
  sourceActivationId: string
  predecessorPolicyId: string
  successorPolicyId: string
  rolloutStateAtCreation: "shadow" | "partial" | "full"
  sourceRefs: readonly string[]
}): PolicyRollbackPlan {
  return {
    id: rollbackPlanIdFromSuccessorId(input.successorPolicyId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Rollback plan emitted deterministically alongside controlled activation.",
    sourceActivationId: input.sourceActivationId,
    predecessorPolicyId: input.predecessorPolicyId,
    successorPolicyId: input.successorPolicyId,
    rollbackTargetPolicyId: input.predecessorPolicyId,
    rolloutStateAtCreation: input.rolloutStateAtCreation,
    rollbackSummary: "Rollback returns policy control to the predecessor policy without silent replacement.",
  }
}
