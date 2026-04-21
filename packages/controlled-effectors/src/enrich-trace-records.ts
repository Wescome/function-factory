import type { ExecutionNodeRecord, EffectorArtifact } from "@factory/schemas"

export function buildExecutionNodeRecord(eff: EffectorArtifact): ExecutionNodeRecord {
  return {
    nodeId: eff.targetNodeId,
    effectorArtifactId: eff.id,
    effectorType: eff.effectorType,
    effectorMode: eff.effectorMode,
    inputSummary: eff.inputSummary,
    outputSummary: eff.outputSummary,
  }
}
