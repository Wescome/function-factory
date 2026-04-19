import { describe, it, expect } from "vitest"
import type { ArtifactId } from "@factory/schemas"
import { contractId } from "./_shared.js"

describe("contractId", () => {
  it("returns CONTRACT-META-FOO-BAR for PRD-META-FOO with tag BAR", () => {
    expect(contractId("PRD-META-FOO" as ArtifactId, "BAR")).toBe(
      "CONTRACT-META-FOO-BAR"
    )
  })

  it("returns CONTRACT-VERTICAL-X-CONSTRAINT for PRD-VERTICAL-X with tag CONSTRAINT", () => {
    expect(contractId("PRD-VERTICAL-X" as ArtifactId, "CONSTRAINT")).toBe(
      "CONTRACT-VERTICAL-X-CONSTRAINT"
    )
  })

  it("produces exactly what Pass 2 was producing for the meta-PRD before the refactor", () => {
    expect(
      contractId(
        "PRD-META-GATE-1-COMPILE-COVERAGE" as ArtifactId,
        "CONSTRAINT"
      )
    ).toBe("CONTRACT-META-GATE-1-COMPILE-COVERAGE-CONSTRAINT")
  })
})
