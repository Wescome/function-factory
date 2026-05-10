import { describe, expect, it } from "vitest"
import { emitArchitectureCandidate } from "../src/emit-architecture-candidate.js"

describe("emitArchitectureCandidate", () => {
  it("emits deterministic bootstrap candidate", () => {
    const candidate = emitArchitectureCandidate({
      sourceIntentSpecificationId: "IS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceExecutableSpecificationId: "ES-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
        "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "IS-META-ARCHITECTURE-CANDIDATE-EXECUTION"
      ],
    })

    expect(candidate.id).toBe("AC-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(candidate.candidateStatus).toBe("proposed")
  })
})
