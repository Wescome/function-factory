import { describe, expect, it } from "vitest"
import { scoreCandidate } from "../src/score-candidate.js"

describe("scoreCandidate", () => {
  it("scores the bootstrap candidate deterministically", () => {
    const result = scoreCandidate({
      candidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
    })

    expect(result.dimensions).toHaveLength(5)
    expect(result.totalScore).toBeGreaterThan(0.8)
  })

  it("fails explicitly for unsupported candidates", () => {
    expect(() =>
      scoreCandidate({ candidateId: "AC-META-UNSUPPORTED" })
    ).toThrow()
  })
})
