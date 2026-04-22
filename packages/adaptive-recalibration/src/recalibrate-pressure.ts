import { MAX_FEEDBACK_INFLUENCE } from "./policies.js"

export function recalibratePressure(input: {
  baselineStrength: number
  baselineUrgency: number
  weightedExternalSignal: number
  weightedFeedbackSignal: number
  driftIndicator: number
}) {
  const boundedFeedbackInfluence = Math.min(input.weightedFeedbackSignal, MAX_FEEDBACK_INFLUENCE)

  const recalibratedStrength = Math.min(
    1,
    Number((input.baselineStrength * 0.7 + input.weightedExternalSignal * 0.2 + boundedFeedbackInfluence * 0.1 + input.driftIndicator * 0.1).toFixed(4))
  )

  const recalibratedUrgency = Math.min(
    1,
    Number((input.baselineUrgency * 0.65 + input.weightedExternalSignal * 0.15 + boundedFeedbackInfluence * 0.1 + input.driftIndicator * 0.2).toFixed(4))
  )

  return {
    feedbackInfluence: Number(boundedFeedbackInfluence.toFixed(4)),
    recalibratedStrength,
    recalibratedUrgency,
  }
}
