import { describe, it, expect } from "vitest"
import { FactoryMode } from "./core.js"

describe("FactoryMode", () => {
  it("parses bootstrap", () => {
    expect(FactoryMode.parse("bootstrap")).toBe("bootstrap")
  })

  it("parses steady_state", () => {
    expect(FactoryMode.parse("steady_state")).toBe("steady_state")
  })

  it("rejects capitalized variants (case-sensitive)", () => {
    expect(FactoryMode.safeParse("Bootstrap").success).toBe(false)
  })

  it("rejects hyphenated steady-state (underscore required)", () => {
    expect(FactoryMode.safeParse("steady-state").success).toBe(false)
  })

  it("rejects empty string", () => {
    expect(FactoryMode.safeParse("").success).toBe(false)
  })

  it("rejects null", () => {
    expect(FactoryMode.safeParse(null).success).toBe(false)
  })

  it("exposes options as readonly array", () => {
    expect(FactoryMode.options).toEqual(["bootstrap", "steady_state"])
  })
})
