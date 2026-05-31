import { describe, expect, it, vi } from "vitest"
import type { PipelineEnv } from "../types.js"
import { handleTelemetryBatch, telemetryConsumerInternals, type TelemetryEvent } from "./telemetry-consumer.js"

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
  it("is a no-op without sinks and never throws", async () => {
    const ack = vi.fn()
    const batch = {
      queue: "telemetry-queue",
      messages: [{ body: event(), ack }],
    } as unknown as MessageBatch
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    await expect(handleTelemetryBatch(batch, {} as PipelineEnv, ctx)).resolves.toBeUndefined()
    expect(ack).toHaveBeenCalledTimes(1)
  })

  it("maps Honeycomb trace magic fields", () => {
    const mapped = telemetryConsumerInternals.mapToHoneycomb(event())
    expect(mapped["trace.trace_id"]).toBe("t-1")
    expect(mapped["trace.span_id"]).toBe("s-1")
    expect(mapped["trace.parent_id"]).toBe("p-1")
    expect(mapped["service.name"]).toBe("gascity")
    expect(mapped["name"]).toBe("molecule.start")
  })
})
