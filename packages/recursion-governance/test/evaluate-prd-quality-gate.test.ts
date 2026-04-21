import { describe, expect, it } from "vitest"
import { evaluatePrdQualityGate } from "../src/evaluate-prd-quality-gate.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("evaluatePrdQualityGate", () => {
  it("passes for a good rendered PRD", () => {
    const markdown = readFileSync(
      join(process.cwd(), "test/fixtures/rendered-prd-good.md"),
      "utf-8"
    )

    expect(() =>
      evaluatePrdQualityGate({
        id: "PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        markdown,
      })
    ).not.toThrow()
  })

  it("fails for a bad rendered PRD", () => {
    const markdown = readFileSync(
      join(process.cwd(), "test/fixtures/rendered-prd-bad.md"),
      "utf-8"
    )

    expect(() =>
      evaluatePrdQualityGate({
        id: "PRD-BAD",
        markdown,
      })
    ).toThrow()
  })
})
