import { describe, expect, it } from "vitest"
import { emitArchitectureCandidate } from "../src/emit-architecture-candidate.js"

describe("emitArchitectureCandidate", () => {
  it("emits deterministic bootstrap candidate", () => {
    const candidate = emitArchitectureCandidate({
      sourcePrdId: "PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
        "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION"
      ],
    })

    expect(candidate.id).toBe("AC-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(candidate.candidateStatus).toBe("proposed")
  })
})
