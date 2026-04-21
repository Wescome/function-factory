import { describe, expect, it } from "vitest"
import { assertExecutionEligibility } from "../src/execution-eligibility.js"

describe("assertExecutionEligibility", () => {
  it("allows selected candidates", () => {
    expect(() =>
      assertExecutionEligibility(
        "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "selected"
      )
    ).not.toThrow()
  })

  it("rejects non-selected candidates", () => {
    expect(() =>
      assertExecutionEligibility(
        "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "rejected"
      )
    ).toThrow()
  })
})
