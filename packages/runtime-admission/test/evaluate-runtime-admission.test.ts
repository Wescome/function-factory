import { describe, expect, it } from "vitest"
import { evaluateRuntimeAdmission } from "../src/evaluate-runtime-admission.js"

describe("evaluateRuntimeAdmission", () => {
  it("allows selected candidate in bootstrap mode", () => {
    const result = evaluateRuntimeAdmission({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      selectionDecision: "selected",
      bootstrapMode: true,
      sourceRefs: [
        "PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    expect(result.decision).toBe("allow")
    expect(result.id).toBe("RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW")
  })

  it("denies rejected candidate", () => {
    const result = evaluateRuntimeAdmission({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      selectionDecision: "rejected",
      bootstrapMode: true,
      sourceRefs: ["ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION"],
    })

    expect(result.decision).toBe("deny")
  })

  it("denies when bootstrap mode is inactive", () => {
    const result = evaluateRuntimeAdmission({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      selectionDecision: "selected",
      bootstrapMode: false,
      sourceRefs: ["ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION"],
    })

    expect(result.decision).toBe("deny")
    expect(result.reason).toContain("bootstrap mode")
  })
})
