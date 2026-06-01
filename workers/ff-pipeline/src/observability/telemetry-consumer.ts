import type { PipelineEnv } from "../types.js"

export interface TelemetryEvent {
  trace_id: string
  span_id: string
  parent_span_id?: string
  name: string
  service: string
  start_time_ms: number
  duration_ms: number
  outcome: "success" | "error" | "timeout"
  error?: string
  attrs: Record<string, string | number | boolean>
}

function writeAnalytics(event: TelemetryEvent, env: PipelineEnv): void {
  if (!env.FACTORY_METRICS) return
  const blobs = [
    event.trace_id,
    event.span_id,
    event.parent_span_id ?? "",
    event.name,
    event.service,
    event.outcome,
    event.error ?? "",
    JSON.stringify(event.attrs),
  ]
  env.FACTORY_METRICS.writeDataPoint({
    blobs,
    doubles: [event.start_time_ms, event.duration_ms],
    indexes: [event.outcome],
  })
}

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return typeof v.trace_id === "string" && typeof v.span_id === "string" && typeof v.name === "string"
}

export async function handleTelemetryBatch(
  batch: MessageBatch,
  env: PipelineEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.FACTORY_METRICS) {
    throw new Error("telemetry_sinks_unconfigured")
  }
  for (const message of batch.messages) {
    const body = message.body
    if (Array.isArray(body)) {
      for (const entry of body) {
        if (isTelemetryEvent(entry)) writeAnalytics(entry, env)
      }
    } else if (isTelemetryEvent(body)) {
      writeAnalytics(body, env)
    }
    message.ack()
  }
  ctx.waitUntil(Promise.resolve())
}
