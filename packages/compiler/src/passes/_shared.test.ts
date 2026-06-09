import { describe, it, expect } from "vitest"
import type { ArtifactId } from "@factory/schemas"
import { contractId } from "./_shared.js"

describe("contractId", () => {
  it("returns CONTRACT-META-FOO-BAR for IS-META-FOO with tag BAR", () => {
    expect(contractId("IS-META-FOO" as ArtifactId, "BAR")).toBe(
      "CONTRACT-META-FOO-BAR"
    )
  })

  it("returns CONTRACT-VERTICAL-X-CONSTRAINT for IS-VERTICAL-X with tag CONSTRAINT", () => {
    expect(contractId("IS-VERTICAL-X" as ArtifactId, "CONSTRAINT")).toBe(
      "CONTRACT-VERTICAL-X-CONSTRAINT"
    )
  })

  it("produces exactly what Binding was producing for the meta-Intent Specification before the refactor", () => {
    expect(
      contractId(
        "IS-META-COHERENCE-VERIFICATION" as ArtifactId,
        "CONSTRAINT"
      )
    ).toBe("CONTRACT-META-COHERENCE-VERIFICATION-CONSTRAINT")
  })
})
