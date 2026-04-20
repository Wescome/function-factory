import { describe, expect, it } from "vitest"
import { emitFunctionProposals } from "../src/emit-proposals.js"

describe("emitFunctionProposals Phase 0 scaffold", () => {
  it("throws explicit not-implemented error", () => {
    expect(() => emitFunctionProposals({} as never)).toThrowError(
      "Phase 0 scaffold only: emitFunctionProposals() is not implemented yet"
    )
  })
})
