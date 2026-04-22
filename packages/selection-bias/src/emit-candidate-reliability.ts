import type { CandidateReliability } from "@factory/schemas"
import { candidateReliabilityIdFromCandidateId } from "./ids.js"

export function emitCandidateReliability(input: {
  sourceArchitectureCandidateId: string
  matchedCount: number
  deviatedCount: number
  reliabilityScore: number
  sourceRefs: readonly string[]
}): CandidateReliability {
  return {
    id: candidateReliabilityIdFromCandidateId(input.sourceArchitectureCandidateId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Candidate reliability emitted deterministically from repeated observation outcomes.",
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    matchedCount: input.matchedCount,
    deviatedCount: input.deviatedCount,
    reliabilityScore: input.reliabilityScore,
    summary: "Reliability score derived from bounded historical observation outcomes.",
  }
}
