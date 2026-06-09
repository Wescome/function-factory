import {
  LearningObservation,
  type LearningObservation as LearningObservationType,
  type RunTranscript,
} from "./types.js"
import { learningObservationKey } from "./storage-keys.js"

function observation(input: Omit<LearningObservationType, "observation_id">): LearningObservationType {
  const observationId = learningObservationKey({
    runId: input.run_id,
    kind: input.kind,
    basis: input.fact,
  })
  return LearningObservation.parse({
    ...input,
    observation_id: observationId,
    _key: observationId,
  })
}

export function deriveLearningObservations(transcript: RunTranscript): LearningObservationType[] {
  const observations: LearningObservationType[] = [
    observation({
      run_id: transcript.run_id,
      kind: "terminal_verdict",
      fact: {
        status: transcript.final_verdict.status,
        synthesis_decision: transcript.final_verdict.synthesis_decision,
        repair_count: transcript.repair_count,
      },
      explicitness: "inferred",
      rationale: "Terminal verdict observation derived from the run transcript final verdict.",
      source_refs: transcript.source_refs,
      created_at: transcript.created_at,
    }),
  ]

  for (const verification of transcript.verification_results) {
    observations.push(observation({
      run_id: transcript.run_id,
      kind: verification.passed ? "verification_pass" : "verification_block",
      fact: {
        verification: verification.verification,
        passed: verification.passed,
        summary: verification.summary,
      },
      explicitness: "inferred",
      rationale: "Verification observation derived from normalized transcript verification results.",
      source_refs: transcript.source_refs,
      created_at: transcript.created_at,
    }))
  }

  if (transcript.final_verdict.status === "synthesis-passed" && transcript.repair_count === 0) {
    observations.push(observation({
      run_id: transcript.run_id,
      kind: "zero_repair_completion",
      fact: {
        status: transcript.final_verdict.status,
        repair_count: transcript.repair_count,
      },
      explicitness: "inferred",
      rationale: "Zero-repair completion observation derived from synthesis pass with no repairs.",
      source_refs: transcript.source_refs,
      created_at: transcript.created_at,
    }))
  }

  if (transcript.repair_count > 0) {
    observations.push(observation({
      run_id: transcript.run_id,
      kind: "repair_required",
      fact: {
        repair_count: transcript.repair_count,
        status: transcript.final_verdict.status,
      },
      explicitness: "inferred",
      rationale: "Repair-required observation derived from nonzero terminal repair count.",
      source_refs: transcript.source_refs,
      created_at: transcript.created_at,
    }))
  }

  return observations
}
