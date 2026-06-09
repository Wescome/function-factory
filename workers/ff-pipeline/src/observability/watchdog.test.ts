import { describe, expect, it, vi } from "vitest"
import { RunEventLog } from "./run-event-log"
import { scanForStuckRuns } from "./watchdog"

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

describe("scanForStuckRuns", () => {
  it("force-completes stale active runs and records watchdog failure", async () => {
    const bucket = new MemoryR2Bucket()
    const log = new RunEventLog(bucket as unknown as R2Bucket)
    await log.emit({
      runId: "run-stale-001",
      type: "run_started",
      emitter: "harness-bridge",
      timestamp: "2026-05-18T14:00:00.000Z",
      data: {},
    })
    await log.emit({
      runId: "run-stale-001",
      stageName: "CONTRACT",
      attemptNumber: 1,
      type: "stage_started",
      emitter: "harness-dispatcher",
      timestamp: "2026-05-18T14:01:00.000Z",
      data: {},
    })

    const forceCompleteFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    const env = {
      WORKSPACE_BUCKET: bucket,
      RUN_COORDINATOR: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: forceCompleteFetch })),
      },
    }

    await scanForStuckRuns(env as never, Date.parse("2026-05-18T14:20:01.000Z"))

    expect(forceCompleteFetch).toHaveBeenCalledOnce()
    const calls = forceCompleteFetch.mock.calls as unknown as Array<[Request]>
    const request = calls[0]![0]
    expect(new URL(request.url).pathname).toBe("/force-complete")
    const payload = await request.json() as { result: { failureClass?: string; finalStage?: string } }
    expect(payload.result).toMatchObject({
      finalStage: "CONTRACT",
      failureClass: "watchdog_stuck",
    })

    const summary = await log.getSummary("run-stale-001")
    expect(summary).toMatchObject({
      status: "stuck",
      errorClass: "watchdog_stuck",
      lastEventType: "stuck_detected",
    })
  })
})
