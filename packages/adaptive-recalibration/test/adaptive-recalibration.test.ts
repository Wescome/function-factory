import { describe, expect, it } from "vitest"
import { computeDriftIndicator } from "../src/compute-drift-indicator.js"
import { recalibratePressure } from "../src/recalibrate-pressure.js"
import { emitRecalibratedPressure } from "../src/emit-recalibrated-pressure.js"
import { emitDeltaDriftInput } from "../src/emit-delta-drift-input.js"

describe("adaptive recalibration", () => {
  it("computes bounded drift and emits recalibrated artifacts deterministically", () => {
    const drift = computeDriftIndicator({
      deviationCount: 3,
      matchedCount: 1,
    })

    expect(drift).toBe(0.31)

    const recalc = recalibratePressure({
      baselineStrength: 0.88,
      baselineUrgency: 0.8,
      weightedExternalSignal: 0.513,
      weightedFeedbackSignal: 0.3562,
      driftIndicator: drift,
    })

    const rprs = emitRecalibratedPressure({
      sourcePressureId: "PRS-META-CANDIDATE-EMISSION-GAP",
      baselineStrength: 0.88,
      baselineUrgency: 0.8,
      feedbackInfluence: recalc.feedbackInfluence,
      recalibratedStrength: recalc.recalibratedStrength,
      recalibratedUrgency: recalc.recalibratedUrgency,
      sourceRefs: [
        "PRS-META-CANDIDATE-EMISSION-GAP",
        "SNB-RUN-META-STAGE725-001",
      ],
    })

    const ddi = emitDeltaDriftInput({
      sourcePressureId: "PRS-META-CANDIDATE-EMISSION-GAP",
      sourceRecalibratedPressureId: rprs.id,
      driftIndicator: drift,
      deviationCount: 3,
      matchedCount: 1,
      sourceRefs: [rprs.id],
    })

    expect(rprs.id).toBe("RPRS-META-CANDIDATE-EMISSION-GAP")
    expect(ddi.id).toBe("DDI-META-CANDIDATE-EMISSION-GAP")
    expect(ddi.driftIndicator).toBe(0.31)
  })
})
