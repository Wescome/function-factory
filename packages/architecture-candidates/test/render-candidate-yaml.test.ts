import { describe, expect, it } from "vitest"
import { emitArchitectureCandidate } from "../src/emit-architecture-candidate.js"
import { renderArchitectureCandidateYaml } from "../src/render-candidate-yaml.js"

describe("renderArchitectureCandidateYaml", () => {
  it("renders deterministic yaml", () => {
    const candidate = emitArchitectureCandidate({
      sourceIntentSpecificationId: "IS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceExecutableSpecificationId: "ES-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
        "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "IS-META-ARCHITECTURE-CANDIDATE-EXECUTION"
      ],
    })

    const yaml = renderArchitectureCandidateYaml(candidate)
    expect(yaml).toContain("id: AC-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(yaml).toContain("candidateStatus: proposed")
  })
})
