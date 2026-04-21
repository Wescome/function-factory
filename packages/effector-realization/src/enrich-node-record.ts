import type { ExecutionNodeRecord, EffectorArtifact, EffectorRealization } from "@factory/schemas"

export function enrichNodeRecordWithRealization(
  eff: EffectorArtifact,
  effr: EffectorRealization
): ExecutionNodeRecord {
  return {
    nodeId: eff.targetNodeId,
    effectorArtifactId: eff.id,
    effectorType: eff.effectorType,
    effectorMode: eff.effectorMode,
    realized: true,
    realizationArtifactId: effr.id,
    outputEvidenceRef: effr.outputEvidenceRef,
    inputSummary: eff.inputSummary,
    outputSummary: eff.outputSummary,
  }
}
