import { describe, expect, it } from "vitest"
import { buildRunTranscript } from "./transcript.js"
import { deriveLearningObservations } from "./observations.js"
import { detectTemplateCandidates } from "./candidates.js"
import { learningRunTranscriptKey } from "./storage-keys.js"

const createdAt = "2026-05-11T00:00:00.000Z"

function successfulTranscript(runId: string) {
  return buildRunTranscript({
    runId,
    createdAt,
    terminalResult: {
      status: "synthesis-passed",
      signalId: "SIG-META-LEARN",
      pressureId: "PRS-META-LEARN",
      capabilityId: "BC-META-LEARN",
      proposalId: "FP-META-LEARN",
      executableSpecificationId: "ES-META-LEARN",
      coherenceVerificationReport: {
        verification: "coherence",
        passed: true,
        executableSpecificationId: "ES-META-LEARN",
        summary: "passed",
      },
      synthesisResult: {
        verdict: { decision: "pass", confidence: 0.95, reason: "ok" },
        tokenUsage: 10,
        repairCount: 0,
      },
    },
  })
}

describe("@factory/learning", () => {
  it("builds a valid run transcript from a terminal pipeline result", () => {
    const transcript = successfulTranscript("run-1")
    expect(transcript.final_verdict.status).toBe("synthesis-passed")
    expect(transcript.repair_count).toBe(0)
    expect(transcript.source_refs).toContain("ES-META-LEARN")
    expect(transcript.verification_results[0]?.passed).toBe(true)
  })

  it("rejects transcripts without source references", () => {
    expect(() => buildRunTranscript({
      runId: "run-empty",
      createdAt,
      terminalResult: { status: "rejected" },
    })).toThrow()
  })

  it("derives factual observations without classifying false positives", () => {
    const observations = deriveLearningObservations(successfulTranscript("run-2"))
    expect(observations.map((entry) => entry.kind)).toEqual([
      "terminal_verdict",
      "verification_pass",
      "zero_repair_completion",
    ])
  })

  it("detects read-only template candidates from repeated zero-repair transcripts", () => {
    const candidates = detectTemplateCandidates([
      successfulTranscript("run-a"),
      successfulTranscript("run-b"),
      successfulTranscript("run-c"),
    ], { minEvidenceRuns: 3, createdAt })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.state).toBe("candidate")
    expect(candidates[0]?.evidence_run_ids).toEqual(["run-a", "run-b", "run-c"])
  })

  it("uses deterministic storage keys", () => {
    expect(learningRunTranscriptKey("workflow/abc")).toBe("run-workflow-abc")
  })
})
