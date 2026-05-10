import type { ArchitectureCandidate } from "@factory/schemas"
import { architectureCandidateIdFromIntentSpecificationId } from "./ids.js"

export interface CandidateEmissionInput {
  readonly sourceIntentSpecificationId: string
  readonly sourceExecutableSpecificationId: string
  readonly sourceRefs: readonly string[]
}

export function emitArchitectureCandidate(input: CandidateEmissionInput): ArchitectureCandidate {
  const { sourceIntentSpecificationId, sourceExecutableSpecificationId, sourceRefs } = input

  return {
    id: architectureCandidateIdFromIntentSpecificationId(sourceIntentSpecificationId),
    source_refs: [...sourceRefs],
    explicitness: "inferred",
    rationale: "Derived deterministically from compiled Intent Specification and emitted ExecutableSpecification in the paired-emission bootstrap path.",
    sourceIntentSpecificationId,
    sourceExecutableSpecificationId,
    candidateStatus: "proposed",
    topology: {
      shape: "single_node",
      summary: "Bootstrap single-candidate execution arrangement for one compiled execution path.",
    },
    modelBinding: {
      bindingMode: "unbound",
      summary: "Runtime model binding is not selected in bootstrap architecture-candidate emission.",
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
