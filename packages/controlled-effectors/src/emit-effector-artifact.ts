import type { EffectorArtifact } from "@factory/schemas"
import { effectorIdFromNodeId } from "./ids.js"
import { assertToolPolicyAllows } from "./assert-tool-policy.js"

export function emitEffectorArtifact(input: {
  sourceWorkGraphId: string
  sourceArchitectureCandidateId: string
  sourceSelectionId: string
  sourceAdmissionId: string
  sourceExecutionStartId: string
  targetNodeId: string
  toolPolicyMode: "allowlist" | "restricted" | "none"
  requestedEffectorType: "tool_call" | "file_write" | "no_op"
  effectorMode?: "simulate" | "safe_execute"
  sourceRefs: readonly string[]
}): EffectorArtifact {
  const effectorMode = input.effectorMode ?? "simulate"
  assertToolPolicyAllows(input.toolPolicyMode, input.requestedEffectorType)

  return {
    id: effectorIdFromNodeId(input.targetNodeId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Controlled effector emitted deterministically under bootstrap tool policy.",
    sourceWorkGraphId: input.sourceWorkGraphId,
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceSelectionId: input.sourceSelectionId,
    sourceAdmissionId: input.sourceAdmissionId,
    sourceExecutionStartId: input.sourceExecutionStartId,
    effectorType: input.requestedEffectorType,
    effectorMode,
    toolPolicyMode: input.toolPolicyMode,
    allowed: true,
    targetNodeId: input.targetNodeId,
    inputSummary: "Deterministic bootstrap input summary.",
    outputSummary: "Deterministic simulated output summary.",
  }
}
