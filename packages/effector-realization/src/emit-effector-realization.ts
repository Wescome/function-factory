import type { EffectorRealization } from "@factory/schemas"
import { effectorRealizationIdFromEffectorId } from "./ids.js"
import {
  assertSafeExecuteMode,
  assertTrustedEnvironment,
  assertRealizableEffectorType,
} from "./assert-realization-guards.js"

export function emitEffectorRealization(input: {
  sourceEffectorId: string
  sourceWorkGraphId: string
  sourceArchitectureCandidateId: string
  sourceSelectionId: string
  sourceAdmissionId: string
  sourceExecutionStartId: string
  effectorMode: "simulate" | "safe_execute"
  environmentTrust: "trusted" | "untrusted"
  requestedEffectorType: "tool_call" | "file_write" | "no_op"
  outputEvidenceRef: string
  sourceRefs: readonly string[]
}): EffectorRealization {
  assertSafeExecuteMode(input.effectorMode)
  assertTrustedEnvironment(input.environmentTrust)
  assertRealizableEffectorType(input.requestedEffectorType)

  return {
    id: effectorRealizationIdFromEffectorId(input.sourceEffectorId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Effector realization emitted deterministically under bootstrap safe_execute policy.",
    sourceEffectorId: input.sourceEffectorId,
    sourceWorkGraphId: input.sourceWorkGraphId,
    sourceArchitectureCandidateId: input.sourceArchitectureCandidateId,
    sourceSelectionId: input.sourceSelectionId,
    sourceAdmissionId: input.sourceAdmissionId,
    sourceExecutionStartId: input.sourceExecutionStartId,
    realizationMode: "safe_execute",
    environmentTrust: "trusted",
    outputEvidenceRef: input.outputEvidenceRef,
    summary: "Sandboxed file_write realization completed under trusted bootstrap policy.",
  }
}
