import type { CandidateScorecard } from "@factory/schemas"

export interface CandidateScoringInput {
  readonly candidateId: string
}

export function scoreCandidate(
  input: CandidateScoringInput
): CandidateScorecard {
  if (input.candidateId !== "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION") {
    throw new Error("Stage 5.75 bootstrap scoring supports only AC-META-ARCHITECTURE-CANDIDATE-EXECUTION")
  }

  const dimensions = [
    {
      name: "topologyComplexity",
      score: 0.9,
      rationale: "Single-node bootstrap topology is low complexity and highly legible.",
    },
    {
      name: "policyRisk",
      score: 0.85,
      rationale: "Restricted tool policy and manual review posture reduce policy risk.",
    },
    {
      name: "toolExposure",
      score: 0.8,
      rationale: "Tool policy is restricted and not runtime-expanded in this stage.",
    },
    {
      name: "convergenceStrictness",
      score: 0.9,
      rationale: "Manual review convergence policy is strict and bootstrap-safe.",
    },
    {
      name: "runtimeReadiness",
      score: 0.7,
      rationale: "The candidate is structurally ready for selection but not yet for runtime execution.",
    },
  ] as const

  const totalScore =
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length

  return {
    dimensions: [...dimensions],
    totalScore,
  }
}
