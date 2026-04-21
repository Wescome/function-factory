import { describe, expect, it } from "vitest"
import { evaluateRecursionGovernance } from "../src/evaluate-recursion-governance.js"
import supported from "./fixtures/fp-supported.json" assert { type: "json" }
import unsupported from "./fixtures/fp-unsupported.json" assert { type: "json" }
import policy from "./fixtures/bootstrap-allowlist-policy.json" assert { type: "json" }
import runContext from "./fixtures/run-context.json" assert { type: "json" }

describe("evaluateRecursionGovernance", () => {
  it("allows supported proposal in bootstrap mode", () => {
    const result = evaluateRecursionGovernance({
      proposal: supported as never,
      policy: policy as never,
      context: runContext as never,
    })

    expect(result.decision).toBe("allow")
  })

  it("denies unsupported proposal", () => {
    const result = evaluateRecursionGovernance({
      proposal: unsupported as never,
      policy: policy as never,
      context: runContext as never,
    })

    expect(result.decision).toBe("deny")
    expect(result.reason).toContain("allowlist")
  })

  it("denies same-run re-authoring", () => {
    const result = evaluateRecursionGovernance({
      proposal: supported as never,
      policy: policy as never,
      context: {
        ...(runContext as any),
        alreadyAuthoredPrdIdsInRun: ["PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION"],
      } as never,
    })

    expect(result.decision).toBe("deny")
    expect(result.reason).toContain("Same-run recursion guard")
  })
})
