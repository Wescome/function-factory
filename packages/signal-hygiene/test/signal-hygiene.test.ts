import { describe, expect, it } from "vitest"
import { normalizeSignals } from "../src/normalize-signals.js"
import { deduplicateSignals } from "../src/deduplicate-signals.js"
import { weightSignals } from "../src/weight-signals.js"
import { emitSignalBatch } from "../src/emit-signal-batch.js"

describe("signal hygiene", () => {
  it("normalizes, deduplicates, and weights bootstrap signals deterministically", () => {
    const normalized = normalizeSignals([
      {
        id: "SIG-EXT-1",
        kind: "external",
        title: "Architecture Candidate Execution Completed",
        source: "external-feed",
        confidence: 0.9,
        severity: 0.6,
      },
      {
        id: "SIG-FB-1",
        kind: "feedback",
        title: "Architecture Candidate Execution Completed",
        source: "feedback-loop",
        confidence: 0.95,
        severity: 0.5,
      },
      {
        id: "SIG-INF-1",
        kind: "inferred",
        title: "Bootstrap execution inference",
        source: "meta-inference",
        confidence: 0.7,
        severity: 0.4,
      },
    ])

    const { kept, duplicates } = deduplicateSignals(normalized)
    const weighted = weightSignals(kept)
    const batch = emitSignalBatch({
      runId: "RUN-META-STAGE725-001",
      normalizedSignals: weighted,
      duplicateSignalIds: duplicates,
      sourceRefs: weighted.map((s) => s.id),
    })

    expect(weighted[0]!.effectiveWeight).toBeGreaterThan(0)
    expect(batch.id).toBe("SNB-RUN-META-STAGE725-001")
    expect(batch.weightingPolicyId).toBe("GOV-META-SIGNAL-HYGIENE-WEIGHTING")
  })
})
