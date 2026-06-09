import {
  RoutingObservation,
  type RoutingObservation as RoutingObservationType,
  type RunTranscript,
} from "./types.js"
import { routingObservationKey } from "./storage-keys.js"

export function deriveRoutingObservations(transcript: RunTranscript): RoutingObservationType[] {
  return transcript.model_role_telemetry.map((telemetry) => {
    const key = routingObservationKey({
      runId: transcript.run_id,
      taskKind: telemetry.task_kind ?? telemetry.role,
      model: telemetry.model,
    })
    return RoutingObservation.parse({
      _key: key,
      run_id: transcript.run_id,
      task_kind: telemetry.task_kind ?? telemetry.role,
      model: telemetry.model,
      outcome: telemetry.outcome ?? transcript.final_verdict.status,
      latency_ms: telemetry.latency_ms,
      token_usage: telemetry.token_usage,
      source_refs: transcript.source_refs,
      created_at: transcript.created_at,
    })
  })
}
