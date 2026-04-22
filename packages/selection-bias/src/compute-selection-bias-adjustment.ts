import { MAX_NEGATIVE_BIAS, MAX_POSITIVE_BIAS, DRIFT_PENALTY_MULTIPLIER } from "./policies.js"

export function computeSelectionBiasAdjustment(input: {
  reliabilityScore: number
  driftIndicator: number
}): number {
  const centeredReliability = input.reliabilityScore - 0.5
  const raw = centeredReliability * 0.3 - input.driftIndicator * DRIFT_PENALTY_MULTIPLIER
  const bounded = Math.max(MAX_NEGATIVE_BIAS, Math.min(raw, MAX_POSITIVE_BIAS))
  return Number(bounded.toFixed(4))
}
