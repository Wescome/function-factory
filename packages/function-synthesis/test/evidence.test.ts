/**
 * Tests for evidence emission.
 *
 * AC 10, 11, 12
 */

import { describe, it, expect } from "vitest"
import {
  buildTraceLog,
  buildGate2Input,
  buildCandidateSelectionReport,
  SynthesisTraceLog,
  Gate2Input,
  SynthesisCandidateSelectionReport,
} from "../src/index.js"
import {
  makeCandidate,
  makeRoleIterations,
  makeValidationOutcomes,
} from "./test-fixtures.js"

describe("evidence", () => {
  const now = new Date().toISOString()

  // AC 10: SynthesisTraceLog parses with Zod on fail verdict
  it("AC 10: builds a SynthesisTraceLog that parses with Zod", () => {
    const traceLog = buildTraceLog({
      runId: "SYN-TEST-001",
      workGraphId: "WG-TEST-001",
      architectureCandidateId: "AC-TEST-001",
      bindingModeName: "stub",
      roleIterations: makeRoleIterations(),
      resampleBranches: [],
      validationOutcomes: makeValidationOutcomes(),
      terminalDecision: {
        verdict: "fail",
        rationale: "Synthesis failed during testing",
        repairLoopCount: 0,
        resampleBranchCount: 0,
      },
      generatedArtifactPaths: [],
      startedAt: now,
      completedAt: now,
    })

    const parsed = SynthesisTraceLog.safeParse(traceLog)
    expect(parsed.success).toBe(true)
    expect(traceLog.terminalDecision.verdict).toBe("fail")
    // Contains records for every role that executed
    const roles = new Set(traceLog.roleIterations.map((r: { role: string }) => r.role))
    expect(roles.size).toBe(5)
  })

  // AC 11: Gate2Input parses with Zod
  it("AC 11: builds a Gate2Input that parses with Zod", () => {
    const gate2 = buildGate2Input({
      runId: "SYN-TEST-002",
      functionId: "FP-TEST-001",
      workGraphId: "WG-TEST-001",
      architectureCandidateId: "AC-TEST-001",
      artifactPaths: ["/output/src/core.ts"],
      validationOutcomes: makeValidationOutcomes(),
      compileSummary: "All compilations passed",
      testSummary: "All tests passed",
      scopeViolation: false,
      constraintViolation: false,
      repairLoopCount: 0,
      resampleSummary: "0 resample branches",
      bindingModeName: "stub",
      promptPackVersion: "1.0.0",
      toolPolicyHash: "abc123",
      modelBindingHash: "def456",
      startedAt: now,
      completedAt: now,
    })

    const parsed = Gate2Input.safeParse(gate2)
    expect(parsed.success).toBe(true)
    expect(gate2.validationOutcomes.length).toBeGreaterThan(0)
    expect(gate2.provenance.bindingModeName).toBe("stub")
  })

  // AC 12: CandidateSelectionReport with distinct candidates
  it("AC 12: builds CandidateSelectionReport with candidate lineage", () => {
    const candidate1 = makeCandidate({ id: "AC-TEST-CAND-001" })
    const candidate2 = makeCandidate({ id: "AC-TEST-CAND-002" })

    const report1 = buildCandidateSelectionReport({
      runId: "SYN-TEST-003",
      candidate: candidate1,
      objectiveScores: { synthesis: 1.0 },
      selectionReason: "First candidate",
    })

    const report2 = buildCandidateSelectionReport({
      runId: "SYN-TEST-004",
      candidate: candidate2,
      objectiveScores: { synthesis: 0.8 },
      selectionReason: "Second candidate",
    })

    const parsed1 = SynthesisCandidateSelectionReport.safeParse(report1)
    const parsed2 = SynthesisCandidateSelectionReport.safeParse(report2)
    expect(parsed1.success).toBe(true)
    expect(parsed2.success).toBe(true)

    // Distinct candidate IDs
    expect(report1.candidateId).toBe("AC-TEST-CAND-001")
    expect(report2.candidateId).toBe("AC-TEST-CAND-002")
    expect(report1.candidateId).not.toBe(report2.candidateId)
  })
})
