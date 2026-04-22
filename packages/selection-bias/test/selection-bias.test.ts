import { describe, expect, it } from "vitest"
import { computeCandidateReliability } from "../src/compute-candidate-reliability.js"
import { computeSelectionBiasAdjustment } from "../src/compute-selection-bias-adjustment.js"
import { emitCandidateReliability } from "../src/emit-candidate-reliability.js"
import { emitSelectionBiasInput } from "../src/emit-selection-bias-input.js"

describe("selection bias adaptation", () => {
  it("computes bounded reliability and bias deterministically", () => {
    const reliability = computeCandidateReliability({
      matchedCount: 4,
      deviatedCount: 1,
    })

    expect(reliability).toBe(0.7)

    const bias = computeSelectionBiasAdjustment({
      reliabilityScore: reliability,
      driftIndicator: 0.31,
    })

    expect(bias).toBe(-0.002)

    const crl = emitCandidateReliability({
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      matchedCount: 4,
      deviatedCount: 1,
      reliabilityScore: reliability,
      sourceRefs: [
        "OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION-2",
      ],
    })

    const sbi = emitSelectionBiasInput({
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceReliabilityId: crl.id,
      sourceDriftInputId: "DDI-META-CANDIDATE-EMISSION-GAP",
      reliabilityScore: reliability,
      driftIndicator: 0.31,
      boundedBiasAdjustment: bias,
      sourceRefs: [crl.id, "DDI-META-CANDIDATE-EMISSION-GAP"],
    })

    expect(crl.id).toBe("CRL-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(sbi.id).toBe("SBI-META-ARCHITECTURE-CANDIDATE-EXECUTION")
  })
})
