import { describe, expect, it, vi } from "vitest"
import { RunEventLog } from "./run-event-log"

class MemoryR2Object {
  constructor(private readonly value: string) {}
  async text() { return this.value }
  async json<T>() { return JSON.parse(this.value) as T }
}

class MemoryR2Bucket {
  readonly objects = new Map<string, string>()

  async get(key: string) {
    const value = this.objects.get(key)
    return value === undefined ? null : new MemoryR2Object(value)
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, _options?: unknown) {
    this.objects.set(key, typeof value === "string" ? value : String(value))
    return null
  }

  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? ""
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    }
  }
}

describe("RunEventLog", () => {
  it("persists events, summary, active index, and terminal attempt logs", async () => {
    const bucket = new MemoryR2Bucket()
    const log = new RunEventLog(bucket as unknown as R2Bucket)

    await log.emit({
      runId: "run-obs-001",
      workflowId: "wf-001",
      type: "run_started",
      emitter: "harness-bridge",
      timestamp: "2026-05-18T15:00:00.000Z",
      data: { harnessKey: "harnesses/coding.harness.yaml" },
    })
    await log.emit({
      runId: "run-obs-001",
      stageName: "CONTRACT",
      attemptNumber: 1,
      type: "stage_started",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T15:01:00.000Z",
      data: { worker: "pi" },
    })
    await log.emit({
      runId: "run-obs-001",
      stageName: "CONTRACT",
      attemptNumber: 1,
      type: "worker_executed",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T15:02:00.000Z",
      data: { status: "pass", artifacts: ["IssueContract"] },
    })
    await log.emit({
      runId: "run-obs-001",
      stageName: "CONTRACT",
      attemptNumber: 1,
      type: "stage_completed",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T15:03:00.000Z",
      data: { action: "complete" },
    })
    await log.emit({
      runId: "run-obs-001",
      stageName: "CONTRACT",
      type: "harness_complete",
      emitter: "run-coordinator",
      timestamp: "2026-05-18T15:04:00.000Z",
      data: { overall: "pass", finalExecutionNode: "CONTRACT" },
    })
    await log.emit({
      runId: "run-obs-001",
      stageName: "CONTRACT",
      attemptNumber: 1,
      type: "stage_completed",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T15:04:01.000Z",
      data: { action: "complete", status: "pass" },
    })

    const summary = await log.getSummary("run-obs-001")
    expect(summary).toMatchObject({
      runId: "run-obs-001",
      workflowId: "wf-001",
      status: "completed",
      currentPhase: "report",
      lastEventType: "stage_completed",
      terminalAt: "2026-05-18T15:04:00.000Z",
      eventCount: 6,
    })
    expect(summary?.stageHistory).toContainEqual(expect.objectContaining({
      stage: "CONTRACT",
      verdict: "pass",
      attempts: 1,
    }))

    const activeIndex = JSON.parse(bucket.objects.get("runs/_active-index.json") ?? "{}")
    expect(activeIndex.runs).toEqual([])

    const attemptLog = bucket.objects.get("runs/run-obs-001/logs/CONTRACT/attempt-1.log")
    expect(attemptLog).toContain("=== STAGE: CONTRACT  ATTEMPT: 1")
    expect(attemptLog).toContain("===STAGE_RESULT===")
    expect(attemptLog).toContain('"status":"pass"')
  })

  it("does not throw upstream when R2 writes fail", async () => {
    const log = new RunEventLog({
      get: vi.fn(async () => null),
      put: vi.fn(async () => { throw new Error("r2 unavailable") }),
      list: vi.fn(),
    } as unknown as R2Bucket)

    await expect(log.emit({
      runId: "run-r2-fail",
      type: "run_started",
      emitter: "harness-bridge",
      data: {},
    })).resolves.toBeUndefined()
  })
})
