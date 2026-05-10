import { describe, expect, it } from "vitest"
import { selectCandidate } from "../src/select-candidate.js"
import { renderSelectionYaml } from "../src/render-selection-yaml.js"

describe("renderSelectionYaml", () => {
  it("renders deterministic yaml", () => {
    const selection = selectCandidate({
      candidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceExecutableSpecificationId: "ES-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "IS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    const yaml = renderSelectionYaml(selection)
    expect(yaml).toContain("id: ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(yaml).toContain("decision: selected")
  })
})
