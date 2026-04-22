import type { PolicyStressReport, PolicyStressLevel } from "@factory/schemas"
import {
  HIGH_STRESS_DRIFT_THRESHOLD,
  HIGH_STRESS_DEVIATION_THRESHOLD,
  HIGH_STRESS_REPEAT_THRESHOLD,
  MODERATE_STRESS_DRIFT_THRESHOLD,
  MODERATE_STRESS_DEVIATION_THRESHOLD,
  MODERATE_STRESS_REPEAT_THRESHOLD,
} from "./policies.js"
import { policyStressReportIdFromPolicyId } from "./ids.js"

export function detectPolicyStress(input: {
  targetPolicyId: string
  driftIndicator: number
  deviationCount: number
  repeatedProposalCount: number
  sourceRefs: readonly string[]
}): PolicyStressReport {
  let stressLevel: PolicyStressLevel = "low"

  const driftHigh = input.driftIndicator >= HIGH_STRESS_DRIFT_THRESHOLD
  const deviationHigh = input.deviationCount >= HIGH_STRESS_DEVIATION_THRESHOLD
  const repeatHigh = input.repeatedProposalCount >= HIGH_STRESS_REPEAT_THRESHOLD
  const highCount = [driftHigh, deviationHigh, repeatHigh].filter(Boolean).length

  const driftMod = input.driftIndicator >= MODERATE_STRESS_DRIFT_THRESHOLD
  const deviationMod = input.deviationCount >= MODERATE_STRESS_DEVIATION_THRESHOLD
  const repeatMod = input.repeatedProposalCount >= MODERATE_STRESS_REPEAT_THRESHOLD
  const modCount = [driftMod, deviationMod, repeatMod].filter(Boolean).length

  if (highCount >= 2) {
    stressLevel = "high"
  } else if (modCount >= 1) {
    stressLevel = "moderate"
  }

  return {
    id: policyStressReportIdFromPolicyId(input.targetPolicyId),
    source_refs: [...input.sourceRefs],
    explicitness: "inferred",
    rationale: "Policy stress report emitted deterministically from drift and repeated deviation evidence.",
    targetPolicyId: input.targetPolicyId,
    driftIndicator: input.driftIndicator,
    deviationCount: input.deviationCount,
    repeatedProposalCount: input.repeatedProposalCount,
    stressLevel,
    summary: "Policy stress detected for bounded governance review.",
  }
}
