export function emitFeedbackSignal(input: {
  observationId: string
  sourceRefs: readonly string[]
  outcome: "matched_expectation" | "deviated" | "inconclusive"
  deltaSummary: string
}): string {
  const id = input.observationId.replace(/^OBS-/, "SIG-META-BOOTSTRAP-FEEDBACK-")

  return [
    `id: ${id}`,
    "source_refs:",
    ...input.sourceRefs.map((r) => `  - ${r}`),
    "explicitness: inferred",
    "rationale: Derived deterministically from an observation artifact for bootstrap feedback reinjection.",
    "type: meta_feedback",
    "source: Stage 7 Observability & Feedback",
    `title: Feedback signal derived from ${input.observationId}`,
    "description: >",
    `  ${input.deltaSummary}`,
    "timestamp: 2026-04-21T00:00:00Z",
    "confidence: 0.95",
    "frequency: 0.5",
    "severity: 0.4",
    "tags:",
    "  - bootstrap-feedback",
    `  - ${input.outcome}`,
  ].join("\n")
}
