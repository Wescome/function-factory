import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"

describe("tangle header", () => {
  it("does not include wall-clock timestamps in generated output", () => {
    const source = readFileSync(new URL("./tangle.ts", import.meta.url), "utf-8")

    expect(source).not.toContain("new Date().toISOString()")
    expect(source).toContain('TANGLE_GENERATED_MARKER = "deterministic"')
  })
})
