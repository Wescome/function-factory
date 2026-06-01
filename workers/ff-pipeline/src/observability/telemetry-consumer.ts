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

function mapToHoneycomb(event: TelemetryEvent): Record<string, unknown> {
  return {
    "trace.trace_id": event.trace_id,
    "trace.span_id": event.span_id,
    ...(event.parent_span_id ? { "trace.parent_id": event.parent_span_id } : {}),
    name: event.name,
    duration_ms: event.duration_ms,
    "service.name": event.service,
    outcome: event.outcome,
    ...(event.error ? { error: event.error } : {}),
    ...event.attrs,
  }
}

async function postToHoneycomb(events: TelemetryEvent[], env: PipelineEnv): Promise<void> {
  if (!env.HONEYCOMB_API_KEY || events.length === 0) return
  const response = await fetch("https://api.honeycomb.io/1/batch/function-factory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Honeycomb-Team": env.HONEYCOMB_API_KEY,
    },
    body: JSON.stringify(events.map(mapToHoneycomb)),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`honeycomb_sink_failed:${response.status}`)
  }
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
  _ctx: ExecutionContext,
): Promise<void> {
  if (!env.FACTORY_METRICS && !env.HONEYCOMB_API_KEY) {
    throw new Error("telemetry_sinks_unconfigured")
  }
  const events: TelemetryEvent[] = []
  for (const message of batch.messages) {
    const body = message.body
    if (Array.isArray(body)) {
      for (const entry of body) {
        if (isTelemetryEvent(entry)) {
          events.push(entry)
          writeAnalytics(entry, env)
        }
      }
    } else if (isTelemetryEvent(body)) {
      events.push(body)
      writeAnalytics(body, env)
    }
    message.ack()
  }

  if (events.length === 0) return
  await postToHoneycomb(events, env)
}

export const telemetryConsumerInternals = {
  mapToHoneycomb,
}
