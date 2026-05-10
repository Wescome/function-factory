import type { RuntimeAdmissionArtifact } from "@factory/schemas"
import { runtimeAdmissionIdFromExecutableSpecificationId } from "./ids.js"

export interface RuntimeAdmissionInput {
  readonly sourceExecutableSpecificationId: string
  readonly sourceArchitectureCandidateId: string
  readonly sourceSelectionId: string
  readonly selectionDecision: "selected" | "rejected"
  readonly bootstrapMode: boolean
  readonly sourceRefs: readonly string[]
}

export function evaluateRuntimeAdmission(
  input: RuntimeAdmissionInput
): RuntimeAdmissionArtifact {
  const {
    sourceExecutableSpecificationId,
    sourceArchitectureCandidateId,
    sourceSelectionId,
    selectionDecision,
    bootstrapMode,
    sourceRefs,
  } = input

  if (!bootstrapMode) {
    return {
      id: runtimeAdmissionIdFromExecutableSpecificationId(sourceExecutableSpecificationId, "deny"),
      source_refs: [...sourceRefs],
      explicitness: "inferred",
      rationale: "Runtime admission denied because bootstrap runtime mode is not active.",
      sourceExecutableSpecificationId,
      sourceArchitectureCandidateId,
      sourceSelectionId,
      decision: "deny",
      reason: "bootstrap mode inactive",
    }
  }

  if (selectionDecision !== "selected") {
    return {
      id: runtimeAdmissionIdFromExecutableSpecificationId(sourceExecutableSpecificationId, "deny"),
      source_refs: [...sourceRefs],
      explicitness: "inferred",
      rationale: "Runtime admission denied because linked ArchitectureCandidate selection is not selected.",
      sourceExecutableSpecificationId,
      sourceArchitectureCandidateId,
      sourceSelectionId,
      decision: "deny",
      reason: "linked ArchitectureCandidate not selected",
    }
  }

  return {
    id: runtimeAdmissionIdFromExecutableSpecificationId(sourceExecutableSpecificationId, "allow"),
    source_refs: [...sourceRefs],
    explicitness: "inferred",
    rationale: "Runtime admission allowed because bootstrap mode is active and linked ArchitectureCandidate is selected.",
    sourceExecutableSpecificationId,
    sourceArchitectureCandidateId,
    sourceSelectionId,
    decision: "allow",
    reason: "selected candidate admitted in bootstrap mode",
  }
}
