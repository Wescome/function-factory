import { describe, expect, it } from "vitest"
import { emitObservation } from "../src/emit-observation.js"
import { emitFeedbackSignal } from "../src/emit-feedback-signal.js"
import { renderObservationYaml } from "../src/render-observation-yaml.js"

describe("observability feedback", () => {
  it("emits OBS and feedback SIG deterministically", () => {
    const obs = emitObservation({
      sourceExecutionResultId: "EXR-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceEffectorRealizationId: "EFFR-N1",
      sourceExecutionTraceId: "EXT-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      expectedSummary: "Deterministic bootstrap execution completed successfully for the admitted path.",
      realizedSummary: "Deterministic bootstrap execution completed successfully for the admitted path.",
      sourceRefs: [
        "EXR-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        "EFFR-N1",
        "EXT-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    expect(obs.id).toBe("OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(obs.outcome).toBe("matched_expectation")

    const obsYaml = renderObservationYaml(obs)
    expect(obsYaml).toContain("outcome: matched_expectation")

    const sig = emitFeedbackSignal({
      observationId: obs.id,
      sourceRefs: [obs.id],
      outcome: obs.outcome,
      deltaSummary: obs.deltaSummary,
    })

    expect(sig).toContain("SIG-META-BOOTSTRAP-FEEDBACK-META-ARCHITECTURE-CANDIDATE-EXECUTION")
  })
})
