// mappers/execution.mapper.ts - Maps kernel invocation types to WGSP ExecutionDataPart

import type { InvocationRequest, InvocationResult } from "../kernel/invocation";
import type { ExecutionDataPart, ExecutionStep, TemporalState } from "../stream/data-parts";

/**
 * Creates a single-step ExecutionDataPart from an InvocationRequest and optional result.
 * For multi-step plans, the caller should assemble full step arrays externally.
 */
export function to_execution_data_part(
  request: InvocationRequest,
  result: InvocationResult | null,
  step_index: number,
  total_steps: number,
  plan_hash: string,
  plan_start_time: string,
): ExecutionDataPart {
  const now = new Date();
  const start = new Date(plan_start_time);
  const elapsed_ms = now.getTime() - start.getTime();

  const step: ExecutionStep = {
    step_index,
    tool_id: request.tool,
    tool_label: request.tool.replace(/\./g, " "),
    status: result == null
      ? "RUNNING"
      : result.status === "SUCCEEDED"
        ? "COMPLETED"
        : result.status === "RETRYING"
          ? "RUNNING"
          : "FAILED",
    invocation_id: request.invocation_id,
    started_at: plan_start_time,
    completed_at: result != null ? now.toISOString() : null,
    output_summary: result?.output_ref ?? null,
  };

  const temporal: TemporalState = {
    plan_start_time,
    elapsed_ms,
    estimated_remaining_ms: 0,
    tightest_deadline: null,
    deadline_margin_ms: null,
  };

  return {
    work_order_id: request.work_order_id,
    plan_hash,
    phase: result != null && result.status === "SUCCEEDED" && step_index >= total_steps - 1
      ? "COMPLETE"
      : "EXECUTING",
    current_step_index: step_index,
    total_steps,
    steps: [step],
    temporal,
    compensation_sub_state: null,
    timestamp: now.toISOString(),
  };
}
