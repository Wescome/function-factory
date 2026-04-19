import { describe, it, expect } from "vitest"
import type { ArtifactId } from "./lineage.js"
import {
  ExecutionLog,
  ExecutionNodeRecord,
  ExecutionNodeStatus,
  ExecutionSummaryStatus,
} from "./execution-log.js"

const baseNodeRecord = {
  nodeId: "interface-WG-META-FOO-entry",
  status: "completed" as const,
  rationale: "completed by dry-run adapter",
}

const baseLog = {
  id: "EL-WG-META-FOO-2026-04-19T18-00-00-000Z" as ArtifactId,
  source_refs: ["WG-META-FOO" as ArtifactId],
  explicitness: "explicit" as const,
  rationale: "first invocation against WG-META-FOO",
  workGraphId: "WG-META-FOO" as ArtifactId,
  adapterId: "dry-run",
  timestamp: "2026-04-19T18:00:00.000Z",
  status: "completed" as const,
  nodes: [baseNodeRecord],
}

describe("ExecutionNodeStatus", () => {
  it("parses each of the 5 enum values", () => {
    for (const v of ["completed", "failed", "skipped", "simulated", "unknown"]) {
      expect(ExecutionNodeStatus.safeParse(v).success).toBe(true)
    }
  })

  it("rejects success (matches PRD AC 8 not Wes's original sketch)", () => {
    expect(ExecutionNodeStatus.safeParse("success").success).toBe(false)
  })
})

describe("ExecutionSummaryStatus", () => {
  it("parses each of the 4 enum values", () => {
    for (const v of [
      "completed",
      "failed",
      "adapter_unavailable",
      "partial",
    ]) {
      expect(ExecutionSummaryStatus.safeParse(v).success).toBe(true)
    }
  })

  it("rejects uncomputable (matches PRD AC 9 not Wes's original sketch)", () => {
    expect(ExecutionSummaryStatus.safeParse("uncomputable").success).toBe(false)
  })
})

describe("ExecutionNodeRecord", () => {
  it("accepts a minimal valid record", () => {
    expect(ExecutionNodeRecord.safeParse(baseNodeRecord).success).toBe(true)
  })

  it("rejects empty nodeId", () => {
    expect(
      ExecutionNodeRecord.safeParse({ ...baseNodeRecord, nodeId: "" }).success
    ).toBe(false)
  })

  it("rejects empty rationale", () => {
    expect(
      ExecutionNodeRecord.safeParse({ ...baseNodeRecord, rationale: "" })
        .success
    ).toBe(false)
  })

  it("accepts record with outcome payload", () => {
    const withOutcome = {
      ...baseNodeRecord,
      outcome: { stdout: "hello", exitCode: 0 },
    }
    expect(ExecutionNodeRecord.safeParse(withOutcome).success).toBe(true)
  })

  it("accepts record with timing fields", () => {
    const withTiming = {
      ...baseNodeRecord,
      startedAt: "2026-04-19T18:00:00.000Z",
      completedAt: "2026-04-19T18:00:01.500Z",
    }
    expect(ExecutionNodeRecord.safeParse(withTiming).success).toBe(true)
  })
})

describe("ExecutionLog", () => {
  it("accepts a minimal valid log", () => {
    expect(ExecutionLog.safeParse(baseLog).success).toBe(true)
  })

  it("rejects log whose id does not start with EL-", () => {
    const bad = {
      ...baseLog,
      id: "CR-NOT-AN-EXECUTION-LOG" as ArtifactId,
    }
    expect(ExecutionLog.safeParse(bad).success).toBe(false)
  })

  it("accepts adapter_unavailable log with empty nodes", () => {
    const unavail = {
      ...baseLog,
      status: "adapter_unavailable" as const,
      nodes: [],
    }
    expect(ExecutionLog.safeParse(unavail).success).toBe(true)
  })

  it("defaults nodes to empty array when omitted", () => {
    const { nodes: _nodes, ...withoutNodes } = baseLog
    const parsed = ExecutionLog.safeParse(withoutNodes)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.nodes).toEqual([])
  })

  it("rejects empty adapterId", () => {
    expect(
      ExecutionLog.safeParse({ ...baseLog, adapterId: "" }).success
    ).toBe(false)
  })

  it("rejects non-datetime timestamp", () => {
    expect(
      ExecutionLog.safeParse({ ...baseLog, timestamp: "not a datetime" })
        .success
    ).toBe(false)
  })
})
