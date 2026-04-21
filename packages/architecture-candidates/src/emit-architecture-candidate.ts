import type { ArchitectureCandidate } from "@factory/schemas"
import { architectureCandidateIdFromPrdId } from "./ids.js"

export interface CandidateEmissionInput {
  readonly sourcePrdId: string
  readonly sourceWorkGraphId: string
  readonly sourceRefs: readonly string[]
}

export function emitArchitectureCandidate(input: CandidateEmissionInput): ArchitectureCandidate {
  const { sourcePrdId, sourceWorkGraphId, sourceRefs } = input

  return {
    id: architectureCandidateIdFromPrdId(sourcePrdId),
    source_refs: [...sourceRefs],
    explicitness: "inferred",
    rationale: "Derived deterministically from compiled PRD and emitted WorkGraph in the paired-emission bootstrap path.",
    sourcePrdId,
    sourceWorkGraphId,
    candidateStatus: "proposed",
    topology: {
      shape: "single_node",
      summary: "Bootstrap single-candidate execution arrangement for one compiled execution path.",
    },
    modelBinding: {
      bindingMode: "unbound",
      summary: "Runtime model binding is not selected in Stage 5.5 bootstrap emission.",
    },
    toolPolicy: {
      mode: "restricted",
      summary: "Tool usage remains governed by bootstrap policy and not runtime-selected here.",
    },
    convergencePolicy: {
      mode: "manual_review",
      summary: "Candidate remains reviewable and not runtime-executed in the current stage.",
    },
  }
}
