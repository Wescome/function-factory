import { describe, it, expect } from "vitest"
import { compileOutputContracts } from "./contract-compiler"
import type { CompiledHarness } from "@factory/nlah"

function makeCompiled(
  outputs: Record<string, { required?: boolean; contract?: unknown }>,
): CompiledHarness {
  const artifacts: Record<string, { required: boolean; contract?: unknown; path: string }> = {}
  for (const [name, v] of Object.entries(outputs)) {
    artifacts[name] = { required: v.required !== false, contract: v.contract, path: `artifacts/${name}` }
  }
  return {
    spec: {
      harness: { name: "TEST", task_family: "test", objective: "test" },
      runtime: { state_root: "state", artifact_root: "artifacts", graph_mode: "linear", default_failure_action: "abort", max_repair_rounds: 1 },
      roles: {},
      artifacts: artifacts as CompiledHarness["spec"]["artifacts"],
      stages: {},
    },
    stagesByFromState: {},
  } as unknown as CompiledHarness
}

function makeStage(outputs: string[]): CompiledHarness["spec"]["stages"][string] {
  return {
    from: "TaskReceived",
    to: "Done",
    role: "Agent",
    worker: "pi",
    outputs,
    inputs: [],
  } as unknown as CompiledHarness["spec"]["stages"][string]
}

describe("compileOutputContracts", () => {
  it("defaults to text/nonEmpty when no contract declared", () => {
    const compiled = makeCompiled({ Plan: { required: true } })
    const result = compileOutputContracts(makeStage(["Plan"]), compiled)
    expect(result).toEqual([{ artifact: "Plan", required: true, body: { kind: "text", nonEmpty: true } }])
  })

  it("projects json contract with required_fields", () => {
    const compiled = makeCompiled({ Report: { required: true, contract: { kind: "json", required_fields: ["verdict", "rationale"] } } })
    const result = compileOutputContracts(makeStage(["Report"]), compiled)
    expect(result[0]!.body).toEqual({ kind: "json", requiredFields: ["verdict", "rationale"] })
  })

  it("projects json contract without required_fields", () => {
    const compiled = makeCompiled({ Data: { required: true, contract: { kind: "json" } } })
    const result = compileOutputContracts(makeStage(["Data"]), compiled)
    expect(result[0]!.body).toEqual({ kind: "json" })
  })

  it("projects markdown contract with required_sections and required_patterns", () => {
    const compiled = makeCompiled({
      Doc: { required: true, contract: { kind: "markdown", required_sections: ["## Findings"], required_patterns: ["^Status:"] } },
    })
    const result = compileOutputContracts(makeStage(["Doc"]), compiled)
    expect(result[0]!.body).toEqual({ kind: "markdown", requiredSections: ["## Findings"], requiredPatterns: ["^Status:"] })
  })

  it("projects text contract with non_empty false", () => {
    const compiled = makeCompiled({ Notes: { required: false, contract: { kind: "text", non_empty: false } } })
    const result = compileOutputContracts(makeStage(["Notes"]), compiled)
    expect(result[0]).toEqual({ artifact: "Notes", required: false, body: { kind: "text", nonEmpty: false } })
  })

  it("handles multiple outputs in stage order", () => {
    const compiled = makeCompiled({
      A: { required: true, contract: { kind: "json" } },
      B: { required: true },
    })
    const result = compileOutputContracts(makeStage(["A", "B"]), compiled)
    expect(result.map((r) => r.artifact)).toEqual(["A", "B"])
    expect(result[0]!.body.kind).toBe("json")
    expect(result[1]!.body.kind).toBe("text")
  })

  it("throws when output has no ArtifactSpec", () => {
    const compiled = makeCompiled({ Known: { required: true } })
    expect(() => compileOutputContracts(makeStage(["Known", "Unknown"]), compiled)).toThrow(
      /contract-compiler.*Unknown/,
    )
  })
})
