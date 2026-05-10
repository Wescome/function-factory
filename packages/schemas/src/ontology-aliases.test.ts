import { describe, expect, it } from "vitest"
import {
  CoherenceVerificationReport,
  ExecutableSpecification,
  FidelityVerificationReport,
  FidelityVerificationVerdict,
  IntentSpecification,
  InvariantSpecification,
  PersistenceVerificationReport,
  VerificationReport,
} from "./ontology-aliases.js"
import {
  VerificationReport as PrimaryVerificationReport,
} from "./coverage.js"
import { Invariant, IntentSpecification as PrimaryIntentSpecification, ExecutableSpecification as PrimaryExecutableSpecification } from "./core.js"

describe("ontology aliases", () => {
  it("exports primary artifact schemas", () => {
    expect(IntentSpecification).toBe(PrimaryIntentSpecification)
    expect(ExecutableSpecification).toBe(PrimaryExecutableSpecification)
    expect(InvariantSpecification).toBe(Invariant)
    expect(VerificationReport).toBe(PrimaryVerificationReport)
  })

  it("exports primary verification schemas", () => {
    expect(CoherenceVerificationReport.shape.verification.value).toBe("coherence")
    expect(FidelityVerificationReport.shape.verification.value).toBe("fidelity")
    expect(PersistenceVerificationReport.shape.verification.value).toBe("persistence")
    expect(FidelityVerificationVerdict.shape.verdict).toBeDefined()
  })
})
