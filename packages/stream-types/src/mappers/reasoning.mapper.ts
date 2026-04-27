// mappers/reasoning.mapper.ts - Constructs WGSP ReasoningDataPart from intent context

import type { ReasoningDataPart, ToolConsideration } from "../stream/data-parts";

/** Input shape for constructing a reasoning trace */
export interface ReasoningInput {
  trace_id: string;
  work_order_id: string;
  granularity?: "STRUCTURED" | "PARSED" | "OPAQUE";
  tools_considered?: ToolConsideration[];
  constraints_referenced?: string[];
  plan_justification: string;
  confidence_signals?: Record<string, number>;
}

/**
 * Constructs a WGSP ReasoningDataPart from an intent context.
 * Pure function with sensible defaults for optional fields.
 */
export function to_reasoning_data_part(input: ReasoningInput): ReasoningDataPart {
  return {
    trace_id: input.trace_id,
    work_order_id: input.work_order_id,
    granularity: input.granularity ?? "STRUCTURED",
    tools_considered: input.tools_considered ?? [],
    constraints_referenced: input.constraints_referenced ?? [],
    plan_justification: input.plan_justification,
    confidence_signals: input.confidence_signals ?? {},
    timestamp: new Date().toISOString(),
  };
}
