import type { SignalNormalizationArtifact, NormalizedSignal } from "@factory/schemas"
import { signalBatchIdFromRunId } from "./ids.js"
import { SIGNAL_WEIGHTING_POLICY_ID } from "./policies.js"

export function emitSignalBatch(input: {
  runId: string
  normalizedSignals: NormalizedSignal[]
  duplicateSignalIds: string[]
  sourceRefs: readonly string[]
}): SignalNormalizationArtifact {
  return {
    id: signalBatchIdFromRunId(input.runId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Signal normalization batch emitted deterministically from Stage 7.25 hygiene pass.",
    normalizedSignals: input.normalizedSignals,
    duplicateSignalIds: input.duplicateSignalIds,
    weightingPolicyId: SIGNAL_WEIGHTING_POLICY_ID,
    summary: "Normalized, deduplicated, and weighted signal batch for bootstrap upstream interpretation.",
  }
}
