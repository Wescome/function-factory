import { describe, expect, it, vi } from "vitest"
import type { PipelineEnv } from "../types.js"
import { handleTelemetryBatch, type TelemetryEvent } from "./telemetry-consumer.js"

function event(): TelemetryEvent {
  return {
    trace_id: "t-1",
    span_id: "s-1",
    parent_span_id: "p-1",
    name: "molecule.start",
    service: "gascity",
    start_time_ms: 1,
    duration_ms: 2,
    outcome: "success",
    attrs: { city: "factory", attempt: 1 },
  }
}

describe("telemetry-consumer", () => {
  it("fails fast when sinks are unconfigured", async () => {
    const ack = vi.fn()
    const batch = {
      queue: "telemetry-queue",
      messages: [{ body: event(), ack }],
    } as unknown as MessageBatch
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    await expect(handleTelemetryBatch(batch, {} as PipelineEnv, ctx)).rejects.toThrow("telemetry_sinks_unconfigured")
  })
})
