// mappers/drift.mapper.ts - Constructs WGSP DriftDataPart from metric comparison

import type { DriftDataPart, DriftSignalCategory } from "../stream/data-parts";

/** Input shape for constructing a drift alert */
export interface DriftInput {
  alert_id: string;
  signal_category: DriftSignalCategory;
  metric: string;
  current_value: number;
  baseline_value: number;
  threshold: number;
  contributing_invocations?: string[];
  automated_response?: { action: string; details: string } | null;
}

/**
 * Constructs a WGSP DriftDataPart from metric comparison data.
 * Severity is computed automatically: CRITICAL if current exceeds 2x threshold.
 */
export function to_drift_data_part(input: DriftInput): DriftDataPart {
  const deviation = Math.abs(input.current_value - input.baseline_value);
  const severity = deviation >= input.threshold * 2 ? "CRITICAL" : "WARNING";

  return {
    alert_id: input.alert_id,
    signal_category: input.signal_category,
    metric: input.metric,
    current_value: input.current_value,
    baseline_value: input.baseline_value,
    threshold: input.threshold,
    severity,
    contributing_invocations: input.contributing_invocations ?? [],
    automated_response: input.automated_response ?? null,
    timestamp: new Date().toISOString(),
  };
}
