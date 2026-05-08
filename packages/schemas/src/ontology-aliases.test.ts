import { describe, expect, it } from "vitest"
import {
  CoherenceVerificationReport,
  ExecutableSpecification,
  FidelityVerificationReport,
  IntentSpecification,
  InvariantSpecification,
  PersistenceVerificationReport,
  VerificationReport,
} from "./ontology-aliases.js"
import {
  CoverageReport,
  Gate1Report,
  Gate2Report,
  Gate3Report,
} from "./coverage.js"
import { Invariant, PRDDraft, WorkGraph } from "./core.js"

describe("ontology aliases", () => {
  it("aliases current artifact schemas without replacing compatibility names", () => {
    expect(IntentSpecification).toBe(PRDDraft)
    expect(ExecutableSpecification).toBe(WorkGraph)
    expect(InvariantSpecification).toBe(Invariant)
    expect(VerificationReport).toBe(CoverageReport)
  })

  it("aliases current gate report schemas to verification process terms", () => {
    expect(CoherenceVerificationReport).toBe(Gate1Report)
    expect(FidelityVerificationReport).toBe(Gate2Report)
    expect(PersistenceVerificationReport).toBe(Gate3Report)
  })
})
