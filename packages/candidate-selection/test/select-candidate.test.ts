import { describe, expect, it } from "vitest"
import { selectCandidate } from "../src/select-candidate.js"

describe("selectCandidate", () => {
  it("selects the bootstrap candidate at the default threshold", () => {
    const selection = selectCandidate({
      candidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceExecutableSpecificationId: "ES-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "IS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    expect(selection.id).toBe("ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(selection.decision).toBe("selected")
  })
})
