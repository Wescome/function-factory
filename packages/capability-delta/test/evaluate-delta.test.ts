import { describe, expect, it } from "vitest"
import { evaluateDelta } from "../src/evaluate-delta.js"
import { repoInventoryCurrent } from "./fixtures/repo-inventory.current.js"
import { bootstrapCapabilities } from "./fixtures/capabilities.bootstrap.js"

describe("evaluateDelta", () => {
  it("returns a CapabilityDelta for BC-META-COMPUTE-CAPABILITY-DELTA", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-COMPUTE-CAPABILITY-DELTA"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    expect(delta.id).toBe("DEL-META-COMPUTE-CAPABILITY-DELTA")
    expect(delta.capabilityId).toBe("BC-META-COMPUTE-CAPABILITY-DELTA")
    expect(delta.overallStatus).toBe("missing")
    expect(delta.findings).toHaveLength(4)
    expect(delta.recommendedFunctionTypes).toEqual(["execution", "control", "evidence"])
    expect(delta.source_refs).toEqual(cap.source_refs)
    expect(delta.explicitness).toBe("inferred")
  })

  it("classifies execution, control, evidence as missing", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-COMPUTE-CAPABILITY-DELTA"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    const exec = delta.findings.find((f) => f.dimension === "execution")
    const ctrl = delta.findings.find((f) => f.dimension === "control")
    const evid = delta.findings.find((f) => f.dimension === "evidence")

    expect(exec?.status).toBe("missing")
    expect(ctrl?.status).toBe("missing")
    expect(evid?.status).toBe("missing")
  })

  it("classifies integration as underutilized", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-COMPUTE-CAPABILITY-DELTA"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    const integ = delta.findings.find((f) => f.dimension === "integration")
    expect(integ?.status).toBe("underutilized")
  })

  it("throws for unsupported capabilities", () => {
    const fakeCap = {
      ...bootstrapCapabilities[0]!,
      id: "BC-META-UNSUPPORTED-FAKE",
    }
    expect(() => evaluateDelta(fakeCap, repoInventoryCurrent)).toThrowError(
      /only \[.*\] are supported/
    )
  })

  it("produces deterministic output across calls", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-COMPUTE-CAPABILITY-DELTA"
    )!
    const a = evaluateDelta(cap, repoInventoryCurrent)
    const b = evaluateDelta(cap, repoInventoryCurrent)
    expect(a).toEqual(b)
  })

  it("returns a CapabilityDelta for BC-META-SEMANTICALLY-REVIEW-PRDS", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-SEMANTICALLY-REVIEW-PRDS"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    expect(delta.id).toBe("DEL-META-SEMANTICALLY-REVIEW-PRDS")
    expect(delta.capabilityId).toBe("BC-META-SEMANTICALLY-REVIEW-PRDS")
    expect(delta.overallStatus).toBe("missing")
    expect(delta.findings).toHaveLength(4)
    expect(delta.recommendedFunctionTypes).toEqual(["execution", "control", "evidence"])
    expect(delta.source_refs).toEqual(cap.source_refs)
    expect(delta.explicitness).toBe("inferred")
  })

  it("classifies semantic-review execution/control/evidence as missing, integration as underutilized", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-SEMANTICALLY-REVIEW-PRDS"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    expect(delta.findings.find((f) => f.dimension === "execution")?.status).toBe("missing")
    expect(delta.findings.find((f) => f.dimension === "control")?.status).toBe("missing")
    expect(delta.findings.find((f) => f.dimension === "evidence")?.status).toBe("missing")
    expect(delta.findings.find((f) => f.dimension === "integration")?.status).toBe("underutilized")
  })

  it("produces deterministic semantic-review output across calls", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-SEMANTICALLY-REVIEW-PRDS"
    )!
    const a = evaluateDelta(cap, repoInventoryCurrent)
    const b = evaluateDelta(cap, repoInventoryCurrent)
    expect(a).toEqual(b)
  })

  it("returns a CapabilityDelta for BC-META-EMIT-ARCHITECTURE-CANDIDATES", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-EMIT-ARCHITECTURE-CANDIDATES"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    expect(delta.id).toBe("DEL-META-EMIT-ARCHITECTURE-CANDIDATES")
    expect(delta.capabilityId).toBe("BC-META-EMIT-ARCHITECTURE-CANDIDATES")
    expect(delta.overallStatus).toBe("missing")
    expect(delta.findings).toHaveLength(4)
    expect(delta.recommendedFunctionTypes).toEqual(["execution", "control", "evidence"])
    expect(delta.source_refs).toEqual(cap.source_refs)
    expect(delta.explicitness).toBe("inferred")
  })

  it("classifies arch-candidate execution/control/evidence as missing, integration as underutilized", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-EMIT-ARCHITECTURE-CANDIDATES"
    )!
    const delta = evaluateDelta(cap, repoInventoryCurrent)

    expect(delta.findings.find((f) => f.dimension === "execution")?.status).toBe("missing")
    expect(delta.findings.find((f) => f.dimension === "control")?.status).toBe("missing")
    expect(delta.findings.find((f) => f.dimension === "evidence")?.status).toBe("missing")
    expect(delta.findings.find((f) => f.dimension === "integration")?.status).toBe("underutilized")
  })

  it("produces deterministic arch-candidate output across calls", () => {
    const cap = bootstrapCapabilities.find(
      (c) => c.id === "BC-META-EMIT-ARCHITECTURE-CANDIDATES"
    )!
    const a = evaluateDelta(cap, repoInventoryCurrent)
    const b = evaluateDelta(cap, repoInventoryCurrent)
    expect(a).toEqual(b)
  })
})
