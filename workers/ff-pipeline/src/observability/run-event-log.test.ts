import { describe, expect, it, vi } from "vitest"
import { RunEventLog } from "./run-event-log"

class MemoryR2Object {
  constructor(private readonly value: string, readonly etag?: string) {}
  async text() { return this.value }
  async json<T>() { return JSON.parse(this.value) as T }
}

class MemoryR2Bucket {
  readonly objects = new Map<string, string>()
  private readonly etags = new Map<string, string>()
  private nextEtag = 1

  async get(key: string) {
    const value = this.objects.get(key)
    return value === undefined ? null : new MemoryR2Object(value, this.etags.get(key))
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, _options?: unknown) {
    this.objects.set(key, typeof value === "string" ? value : String(value))
    this.etags.set(key, String(this.nextEtag++))
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

    const attemptLog = bucket.objects.get("runs/_attempt-logs/run-obs-001/CONTRACT/attempt-1.log")
    expect(attemptLog).toContain("=== STAGE: CONTRACT  ATTEMPT: 1")
    expect(attemptLog).toContain("===STAGE_RESULT===")
    expect(attemptLog).toContain('"status":"pass"')
  })

  it("persists a canonical run artifact manifest and phase records", async () => {
    const bucket = new MemoryR2Bucket()
    const log = new RunEventLog(bucket as unknown as R2Bucket)

    await log.emit({
      runId: "run-artifacts-001",
      workflowId: "wf-artifacts-001",
      type: "run_started",
      emitter: "harness-bridge",
      timestamp: "2026-05-18T17:00:00.000Z",
      data: { harnessKey: "harnesses/pi-author-smoke-json.harness.yaml", objectiveBytes: 128 },
    })
    await log.emit({
      runId: "run-artifacts-001",
      workflowId: "wf-artifacts-001",
      type: "harness_loaded",
      emitter: "harness-bridge",
      timestamp: "2026-05-18T17:00:01.000Z",
      data: {
        harnessKey: "harnesses/pi-author-smoke-json.harness.yaml",
        harnessName: "PI_AUTHOR_SMOKE_JSON",
        executionNodes: ["SMOKE"],
        workerNames: ["pi", "pi-author"],
      },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      attemptNumber: 1,
      type: "stage_started",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T17:00:02.000Z",
      data: {
        worker: "pi-author",
        role: "SmokeJsonWriter",
        declaredInputs: [],
        declaredOutputs: ["SmokeJsonArtifact"],
      },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      attemptNumber: 1,
      type: "container_dispatch_retried",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T17:00:02.500Z",
      data: {
        worker: "pi",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 1000,
        reason: "The container is not running, consider calling start()",
      },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      attemptNumber: 1,
      type: "container_dispatch_recovered",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T17:00:02.900Z",
      data: {
        worker: "pi",
        attempt: 2,
        maxAttempts: 3,
        reason: "The container is not running, consider calling start()",
      },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      attemptNumber: 1,
      type: "worker_executed",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T17:00:03.000Z",
      data: {
        status: "pass",
        artifacts: ["SmokeJsonArtifact"],
        elapsedMs: 1200,
        message: "SMOKE complete observation=runs/run-artifacts-001/artifacts/__observability/SMOKE.container-observation.json",
      },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      attemptNumber: 1,
      type: "gate_evaluated",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T17:00:04.000Z",
      data: {
        allPassed: true,
        results: [
          { gateName: "exists", passed: true },
          { gateName: "json_field_equals", passed: true },
        ],
      },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      attemptNumber: 1,
      type: "stage_completed",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T17:00:05.000Z",
      data: { action: "complete", status: "pass", artifacts: ["SmokeJsonArtifact"] },
    })
    await log.emit({
      runId: "run-artifacts-001",
      stageName: "SMOKE",
      type: "harness_complete",
      emitter: "run-coordinator",
      timestamp: "2026-05-18T17:00:06.000Z",
      data: { overall: "pass", finalExecutionNode: "SMOKE" },
    })

    const manifest = await log.getManifest("run-artifacts-001")
    expect(manifest).toMatchObject({
      schemaVersion: "1.0",
      runId: "run-artifacts-001",
      workflowId: "wf-artifacts-001",
      status: "completed",
      rootKey: "runs/run-artifacts-001/",
      summaryKey: "runs/run-artifacts-001/events/_summary.json",
      eventPrefix: "runs/run-artifacts-001/events/",
      harness: {
        key: "harnesses/pi-author-smoke-json.harness.yaml",
        name: "PI_AUTHOR_SMOKE_JSON",
        executionNodes: ["SMOKE"],
        workerNames: ["pi", "pi-author"],
      },
    })
    expect(manifest?.phases).toMatchObject({
      intent: { key: "runs/run-artifacts-001/00_intent/intent.json" },
      plan: { key: "runs/run-artifacts-001/01_plan/harness.json" },
      execution: { key: "runs/run-artifacts-001/02_execution/execution.json" },
      traces: { key: "runs/run-artifacts-001/03_traces/trace-index.json" },
      eval: { key: "runs/run-artifacts-001/04_eval/eval.json" },
      report: { key: "runs/run-artifacts-001/05_report/report.json" },
    })
    expect(manifest?.stages).toContainEqual(expect.objectContaining({
      name: "SMOKE",
      worker: "pi-author",
      role: "SmokeJsonWriter",
      status: "pass",
      attempts: 1,
      artifacts: ["SmokeJsonArtifact"],
      observationKeys: ["runs/run-artifacts-001/artifacts/__observability/SMOKE.container-observation.json"],
      containerDispatchRetries: [
        {
          status: "retry_scheduled",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1000,
          reason: "The container is not running, consider calling start()",
          at: "2026-05-18T17:00:02.500Z",
        },
        {
          status: "recovered",
          attempt: 2,
          maxAttempts: 3,
          reason: "The container is not running, consider calling start()",
          at: "2026-05-18T17:00:02.900Z",
        },
      ],
      gateResults: [
        { gateName: "exists", passed: true },
        { gateName: "json_field_equals", passed: true },
      ],
    }))
    expect(manifest?.artifacts).toEqual([
      {
        name: "SmokeJsonArtifact",
        key: "runs/run-artifacts-001/artifacts/SmokeJsonArtifact",
        stage: "SMOKE",
        producedAt: "2026-05-18T17:00:05.000Z",
      },
    ])
    expect(manifest?.diagnostics.observations).toEqual([
      "runs/run-artifacts-001/artifacts/__observability/SMOKE.container-observation.json",
    ])
    expect(bucket.objects.has("runs/run-artifacts-001/00_intent/intent.json")).toBe(true)
    expect(bucket.objects.has("runs/run-artifacts-001/01_plan/harness.json")).toBe(true)
    expect(bucket.objects.has("runs/run-artifacts-001/02_execution/execution.json")).toBe(true)
    expect(bucket.objects.has("runs/run-artifacts-001/03_traces/trace-index.json")).toBe(true)
    expect(bucket.objects.has("runs/run-artifacts-001/04_eval/eval.json")).toBe(true)
    expect(bucket.objects.has("runs/run-artifacts-001/05_report/report.json")).toBe(true)
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

  it("retries run_started active index writes after R2 precondition races", async () => {
    const bucket = new MemoryR2Bucket()
    const rawPut = bucket.put.bind(bucket)
    const put = vi.fn(async (
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
      options?: unknown,
    ) => {
      if (key === "runs/_active-index.json" && put.mock.calls.filter((call) => call[0] === key).length <= 2) {
        const err = new Error("PreconditionFailed")
        Object.assign(err, { name: "PreconditionFailed", status: 412 })
        throw err
      }
      return rawPut(key, value, options)
    })
    bucket.put = put
    const log = new RunEventLog(bucket as unknown as R2Bucket)

    await expect(log.emit({
      runId: "run-active-race",
      workflowId: "wf-active-race",
      type: "run_started",
      emitter: "harness-bridge",
      timestamp: "2026-05-18T16:00:00.000Z",
      data: {},
    })).resolves.toBeUndefined()

    const activeIndex = await log.getActiveIndex()
    expect(activeIndex.runs).toContainEqual(expect.objectContaining({
      runId: "run-active-race",
      lastEventAt: "2026-05-18T16:00:00.000Z",
    }))
    expect(put.mock.calls.filter((call) => call[0] === "runs/_active-index.json")).toHaveLength(3)
  })
})
