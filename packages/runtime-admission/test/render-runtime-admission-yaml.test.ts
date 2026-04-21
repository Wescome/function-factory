import { describe, expect, it } from "vitest"
import { evaluateRuntimeAdmission } from "../src/evaluate-runtime-admission.js"
import { renderRuntimeAdmissionYaml } from "../src/render-runtime-admission-yaml.js"

describe("renderRuntimeAdmissionYaml", () => {
  it("renders deterministic yaml", () => {
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

    const yaml = renderRuntimeAdmissionYaml(result)
    expect(yaml).toContain("id: RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW")
    expect(yaml).toContain("decision: allow")
  })
})
