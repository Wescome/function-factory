import type { ExecutionStart } from "@factory/schemas"
import { executionStartIdFromExecutableSpecificationId } from "./ids.js"
import { assertExecutionStartAllowed } from "./assert-lifecycle-invariants.js"

export function emitExecutionStart(input: {
  sourceExecutableSpecificationId: string
  sourceArchitectureCandidateId: string
  sourceSelectionId: string
  sourceAdmissionId: string
  radDecision: "allow" | "deny"
  runId: string
  sourceRefs: readonly string[]
}): ExecutionStart {
  assertExecutionStartAllowed(input.radDecision)
  return {
    id: executionStartIdFromExecutableSpecificationId(input.sourceExecutableSpecificationId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Execution start emitted deterministically from allowed runtime admission.",
    sourceExecutableSpecificationId: input.sourceExecutableSpecificationId,
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceSelectionId: input.sourceSelectionId,
    sourceAdmissionId: input.sourceAdmissionId,
    runId: input.runId,
    status: "started",
  }
}
