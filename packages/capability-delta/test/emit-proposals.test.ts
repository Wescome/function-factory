import { describe, expect, it } from "vitest"
import { emitFunctionProposals } from "../src/emit-proposals.js"
import { evaluateDelta } from "../src/evaluate-delta.js"
import { repoInventoryCurrent } from "./fixtures/repo-inventory.current.js"
import { bootstrapCapabilities } from "./fixtures/capabilities.bootstrap.js"

describe("emitFunctionProposals", () => {
  const cap = bootstrapCapabilities.find(
    (c) => c.id === "BC-META-COMPUTE-CAPABILITY-DELTA"
  )!
  const delta = evaluateDelta(cap, repoInventoryCurrent)

  it("emits exactly 3 proposals", () => {
    const proposals = emitFunctionProposals(delta)
    expect(proposals).toHaveLength(3)
  })

  it("emits execution, control, evidence typed proposals", () => {
    const proposals = emitFunctionProposals(delta)
    const types = proposals.map((p) => p.functionType)
    expect(types).toEqual(["execution", "control", "evidence"])
  })

  it("uses correct proposal IDs", () => {
    const proposals = emitFunctionProposals(delta)
    expect(proposals[0]!.id).toBe("FP-META-CAPABILITY-DELTA-ENGINE")
    expect(proposals[1]!.id).toBe("FP-META-CAPABILITY-DELTA-RULES")
    expect(proposals[2]!.id).toBe("FP-META-CAPABILITY-DELTA-EVIDENCE")
  })

  it("preserves lineage from delta", () => {
    const proposals = emitFunctionProposals(delta)
    for (const p of proposals) {
      expect(p.source_refs).toEqual(delta.source_refs)
      expect(p.capabilityId).toBe("BC-META-COMPUTE-CAPABILITY-DELTA")
    }
  })

  it("throws for unsupported capability deltas", () => {
    const fakeDelta = { ...delta, capabilityId: "BC-META-SEMANTICALLY-REVIEW-PRDS" }
    expect(() => emitFunctionProposals(fakeDelta)).toThrowError(
      "Narrow Phase 1: only BC-META-COMPUTE-CAPABILITY-DELTA is supported"
    )
  })

  it("produces deterministic output across calls", () => {
    const a = emitFunctionProposals(delta)
    const b = emitFunctionProposals(delta)
    expect(a).toEqual(b)
  })
})
