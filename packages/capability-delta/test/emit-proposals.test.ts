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
    const fakeDelta = { ...delta, capabilityId: "BC-META-UNSUPPORTED-FAKE" }
    expect(() => emitFunctionProposals(fakeDelta)).toThrowError(
      /only \[.*\] are supported/
    )
  })

  it("produces deterministic output across calls", () => {
    const a = emitFunctionProposals(delta)
    const b = emitFunctionProposals(delta)
    expect(a).toEqual(b)
  })

  describe("BC-META-SEMANTICALLY-REVIEW-PRDS", () => {
    const srCap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-SEMANTICALLY-REVIEW-PRDS"
    )!
    const srDelta = evaluateDelta(srCap, repoInventoryCurrent)

    it("emits exactly 3 proposals", () => {
      const proposals = emitFunctionProposals(srDelta)
      expect(proposals).toHaveLength(3)
    })

    it("emits execution, control, evidence typed proposals", () => {
      const proposals = emitFunctionProposals(srDelta)
      const types = proposals.map((p) => p.functionType)
      expect(types).toEqual(["execution", "control", "evidence"])
    })

    it("uses correct proposal IDs", () => {
      const proposals = emitFunctionProposals(srDelta)
      expect(proposals[0]!.id).toBe("FP-META-SEMANTIC-REVIEW-EXECUTION")
      expect(proposals[1]!.id).toBe("FP-META-SEMANTIC-REVIEW-RULES")
      expect(proposals[2]!.id).toBe("FP-META-SEMANTIC-REVIEW-EVIDENCE")
    })

    it("preserves lineage from delta", () => {
      const proposals = emitFunctionProposals(srDelta)
      for (const p of proposals) {
        expect(p.source_refs).toEqual(srDelta.source_refs)
        expect(p.capabilityId).toBe("BC-META-SEMANTICALLY-REVIEW-PRDS")
      }
    })

    it("produces deterministic output across calls", () => {
      const a = emitFunctionProposals(srDelta)
      const b = emitFunctionProposals(srDelta)
      expect(a).toEqual(b)
    })
  })

  describe("BC-META-EMIT-ARCHITECTURE-CANDIDATES", () => {
    const acCap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-EMIT-ARCHITECTURE-CANDIDATES"
    )!
    const acDelta = evaluateDelta(acCap, repoInventoryCurrent)

    it("emits exactly 3 proposals", () => {
      const proposals = emitFunctionProposals(acDelta)
      expect(proposals).toHaveLength(3)
    })

    it("emits execution, control, evidence typed proposals", () => {
      const proposals = emitFunctionProposals(acDelta)
      const types = proposals.map((p) => p.functionType)
      expect(types).toEqual(["execution", "control", "evidence"])
    })

    it("uses correct proposal IDs", () => {
      const proposals = emitFunctionProposals(acDelta)
      expect(proposals[0]!.id).toBe("FP-META-ARCHITECTURE-CANDIDATE-EXECUTION")
      expect(proposals[1]!.id).toBe("FP-META-ARCHITECTURE-CANDIDATE-RULES")
      expect(proposals[2]!.id).toBe("FP-META-ARCHITECTURE-CANDIDATE-EVIDENCE")
    })

    it("preserves lineage from delta", () => {
      const proposals = emitFunctionProposals(acDelta)
      for (const p of proposals) {
        expect(p.source_refs).toEqual(acDelta.source_refs)
        expect(p.capabilityId).toBe("BC-META-EMIT-ARCHITECTURE-CANDIDATES")
      }
    })

    it("produces deterministic output across calls", () => {
      const a = emitFunctionProposals(acDelta)
      const b = emitFunctionProposals(acDelta)
      expect(a).toEqual(b)
    })
  })
})
