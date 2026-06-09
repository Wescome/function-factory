import type { ExecutionResult } from "@factory/schemas"
import { executionResultIdFromExecutableSpecificationId } from "./ids.js"
import { assertResultAllowed } from "./assert-lifecycle-invariants.js"

export function emitExecutionResult(input: {
  sourceExecutableSpecificationId: string
  sourceArchitectureCandidateId: string
  sourceSelectionId: string
  sourceAdmissionId: string
  runId: string
  hasExecutionStart: boolean
  sourceRefs: readonly string[]
}): ExecutionResult {
  assertResultAllowed(input.hasExecutionStart)
  return {
    id: executionResultIdFromExecutableSpecificationId(input.sourceExecutableSpecificationId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Execution result emitted deterministically for the bootstrap single-path run.",
    sourceExecutableSpecificationId: input.sourceExecutableSpecificationId,
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceSelectionId: input.sourceSelectionId,
    sourceAdmissionId: input.sourceAdmissionId,
    runId: input.runId,
    status: "succeeded",
    summary: "Deterministic bootstrap execution completed successfully for the admitted path.",
  }
}
