import type { ExecutionStart } from "@factory/schemas"
import { executionStartIdFromWorkGraphId } from "./ids.js"
import { assertExecutionStartAllowed } from "./assert-lifecycle-invariants.js"

export function emitExecutionStart(input: {
  sourceWorkGraphId: string
  sourceArchitectureCandidateId: string
  sourceSelectionId: string
  sourceAdmissionId: string
  radDecision: "allow" | "deny"
  runId: string
  sourceRefs: readonly string[]
}): ExecutionStart {
  assertExecutionStartAllowed(input.radDecision)
  return {
    id: executionStartIdFromWorkGraphId(input.sourceWorkGraphId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Execution start emitted deterministically from allowed runtime admission.",
    sourceWorkGraphId: input.sourceWorkGraphId,
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceSelectionId: input.sourceSelectionId,
    sourceAdmissionId: input.sourceAdmissionId,
    runId: input.runId,
    status: "started",
  }
}
