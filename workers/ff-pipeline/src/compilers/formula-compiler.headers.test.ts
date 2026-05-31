import { describe, expect, it } from "vitest"
import { formulaCompilerInternals } from "./formula-compiler.js"

describe("gasCityAuthHeaders", () => {
  it("includes X-Trace-ID", () => {
    const headers = formulaCompilerInternals.gasCityAuthHeaders(
      { GAS_CITY_BEARER_TOKEN: "tok" } as unknown as import("./formula-compiler.js").FormulaCompilerEnv,
      "trace-123",
    )
    expect(headers.Authorization).toBe("Bearer tok")
    expect(headers["X-GC-Request"]).toBe("1")
    expect(headers["X-Trace-ID"]).toBe("trace-123")
  })
})
