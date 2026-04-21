import { describe, expect, it } from "vitest"
import { emitArchitectureCandidate } from "../src/emit-architecture-candidate.js"
import { renderArchitectureCandidateYaml } from "../src/render-candidate-yaml.js"

describe("renderArchitectureCandidateYaml", () => {
  it("renders deterministic yaml", () => {
    const candidate = emitArchitectureCandidate({
      sourcePrdId: "PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
        "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION"
      ],
    })

    const yaml = renderArchitectureCandidateYaml(candidate)
    expect(yaml).toContain("id: AC-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(yaml).toContain("candidateStatus: proposed")
  })
})
