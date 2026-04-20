import { describe, expect, it } from "vitest"
import { evaluateDelta } from "../src/evaluate-delta.js"
import { repoInventoryCurrent } from "./fixtures/repo-inventory.current.js"
import { bootstrapCapabilities } from "./fixtures/capabilities.bootstrap.js"

describe("evaluateDelta Phase 0 scaffold", () => {
  it("throws explicit not-implemented error", () => {
    expect(() =>
      evaluateDelta(bootstrapCapabilities[0]!, repoInventoryCurrent)
    ).toThrowError(
      "Phase 0 scaffold only: evaluateDelta() is not implemented yet"
    )
  })
})
