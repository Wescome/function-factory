import { describe, expect, it } from "vitest"
import { emitEffectorRealization } from "../src/emit-effector-realization.js"

describe("effector realization", () => {
  it("emits EFFR for trusted safe_execute file_write", () => {
    const effr = emitEffectorRealization({
      sourceEffectorId: "EFF-N1",
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
      sourceExecutionStartId: "EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      effectorMode: "safe_execute",
      environmentTrust: "trusted",
      requestedEffectorType: "file_write",
      outputEvidenceRef: "sandbox:/tmp/bootstrap-output.txt",
      sourceRefs: ["EFF-N1"],
    })

    expect(effr.id).toBe("EFFR-N1")
    expect(effr.realizationMode).toBe("safe_execute")
  })

  it("fails closed for simulate mode", () => {
    expect(() =>
      emitEffectorRealization({
        sourceEffectorId: "EFF-N1",
        sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
        sourceExecutionStartId: "EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        effectorMode: "simulate",
        environmentTrust: "trusted",
        requestedEffectorType: "file_write",
        outputEvidenceRef: "sandbox:/tmp/bootstrap-output.txt",
        sourceRefs: ["EFF-N1"],
      })
    ).toThrow()
  })
})
