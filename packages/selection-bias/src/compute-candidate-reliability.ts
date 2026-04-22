import { MATCH_REWARD_STEP, DEVIATION_PENALTY_STEP, RELIABILITY_BASELINE } from "./policies.js"

export function computeCandidateReliability(input: {
  matchedCount: number
  deviatedCount: number
}): number {
  const raw =
    RELIABILITY_BASELINE +
    input.matchedCount * MATCH_REWARD_STEP -
    input.deviatedCount * DEVIATION_PENALTY_STEP

  const bounded = Math.max(0, Math.min(raw, 1))
  return Number(bounded.toFixed(4))
}
