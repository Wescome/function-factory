import type { ExecutionTrace } from "@factory/schemas"
import { executionTraceIdFromExecutableSpecificationId } from "./ids.js"
import { assertTraceAllowed } from "./assert-lifecycle-invariants.js"

export function emitExecutionTrace(input: {
  sourceExecutableSpecificationId: string
  sourceArchitectureCandidateId: string
  sourceSelectionId: string
  sourceAdmissionId: string
  sourceExecutionStartId: string
  runId: string
  hasExecutionStart: boolean
  traversedNodeIds: readonly string[]
  sourceRefs: readonly string[]
}): ExecutionTrace {
  assertTraceAllowed(input.hasExecutionStart)
  return {
    id: executionTraceIdFromExecutableSpecificationId(input.sourceExecutableSpecificationId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Execution trace emitted deterministically for the bootstrap single-path run.",
    sourceExecutableSpecificationId: input.sourceExecutableSpecificationId,
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceSelectionId: input.sourceSelectionId,
    sourceAdmissionId: input.sourceAdmissionId,
    sourceExecutionStartId: input.sourceExecutionStartId,
    runId: input.runId,
    nodeCount: input.traversedNodeIds.length,
    traversedNodeIds: [...input.traversedNodeIds],
    completionMode: "deterministic_single_path",
    summary: "Deterministic single-path trace for the admitted bootstrap execution.",
  }
}
