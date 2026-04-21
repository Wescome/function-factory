import type { RuntimeAdmissionArtifact } from "@factory/schemas"
import { runtimeAdmissionIdFromWorkGraphId } from "./ids.js"

export interface RuntimeAdmissionInput {
  readonly sourceWorkGraphId: string
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
    sourceWorkGraphId,
    sourceArchitectureCandidateId,
    sourceSelectionId,
    selectionDecision,
    bootstrapMode,
    sourceRefs,
  } = input

  if (!bootstrapMode) {
    return {
      id: runtimeAdmissionIdFromWorkGraphId(sourceWorkGraphId, "deny"),
      source_refs: [...sourceRefs],
      explicitness: "inferred",
      rationale: "Runtime admission denied because bootstrap runtime mode is not active.",
      sourceWorkGraphId,
      sourceArchitectureCandidateId,
      sourceSelectionId,
      decision: "deny",
      reason: "bootstrap mode inactive",
    }
  }

  if (selectionDecision !== "selected") {
    return {
      id: runtimeAdmissionIdFromWorkGraphId(sourceWorkGraphId, "deny"),
      source_refs: [...sourceRefs],
      explicitness: "inferred",
      rationale: "Runtime admission denied because linked ArchitectureCandidate selection is not selected.",
      sourceWorkGraphId,
      sourceArchitectureCandidateId,
      sourceSelectionId,
      decision: "deny",
      reason: "linked ArchitectureCandidate not selected",
    }
  }

  return {
    id: runtimeAdmissionIdFromWorkGraphId(sourceWorkGraphId, "allow"),
    source_refs: [...sourceRefs],
    explicitness: "inferred",
    rationale: "Runtime admission allowed because bootstrap mode is active and linked ArchitectureCandidate is selected.",
    sourceWorkGraphId,
    sourceArchitectureCandidateId,
    sourceSelectionId,
    decision: "allow",
    reason: "selected candidate admitted in bootstrap mode",
  }
}
