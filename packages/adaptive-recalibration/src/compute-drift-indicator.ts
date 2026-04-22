import { DEVIATION_DRIFT_STEP, MATCH_RELIEF_STEP, DRIFT_CAP } from "./policies.js"

export function computeDriftIndicator(input: {
  deviationCount: number
  matchedCount: number
}): number {
  const raw = input.deviationCount * DEVIATION_DRIFT_STEP - input.matchedCount * MATCH_RELIEF_STEP
  const bounded = Math.max(0, Math.min(raw, DRIFT_CAP))
  return Number(bounded.toFixed(4))
}
