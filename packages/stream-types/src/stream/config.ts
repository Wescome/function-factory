// stream/config.ts - WGSP §11.2 We-Gradient streaming behavior per maturity level
// Determines what data parts are streamed and their persistence mode.

// ---------------------------------------------------------------------------
// Stream part modes (persistence semantics)
// ---------------------------------------------------------------------------

export type StreamPartMode =
  | "disabled"
  | "transient"
  | "persistent"
  | "persistent-summary"
  | "persistent-full"
  | "persistent-key"
  | "persistent-all";

// ---------------------------------------------------------------------------
// Configuration shape for all 7 data part types + evidence
// ---------------------------------------------------------------------------

export interface WeGradientStreamConfig {
  workorder: StreamPartMode;
  governance: StreamPartMode;
  planvalidation: StreamPartMode;
  execution: StreamPartMode;
  escalation: StreamPartMode;
  reasoning: StreamPartMode;
  drift: StreamPartMode;
  evidence: StreamPartMode;
}

// ---------------------------------------------------------------------------
// Default configs for We-Gradient levels 0-5 (WGSP §11.2)
// ---------------------------------------------------------------------------

const LEVEL_0: WeGradientStreamConfig = {
  workorder: "disabled",
  governance: "disabled",
  planvalidation: "disabled",
  execution: "disabled",
  escalation: "disabled",
  reasoning: "disabled",
  drift: "disabled",
  evidence: "disabled",
};

const LEVEL_1: WeGradientStreamConfig = {
  workorder: "disabled",
  governance: "disabled",
  planvalidation: "disabled",
  execution: "disabled",
  escalation: "disabled",
  reasoning: "disabled",
  drift: "disabled",
  evidence: "disabled",
};

const LEVEL_2: WeGradientStreamConfig = {
  workorder: "persistent",
  governance: "transient",
  planvalidation: "disabled",
  execution: "persistent-summary",
  escalation: "persistent",
  reasoning: "transient",
  drift: "disabled",
  evidence: "persistent-key",
};

const LEVEL_3: WeGradientStreamConfig = {
  workorder: "persistent",
  governance: "transient",
  planvalidation: "disabled",
  execution: "persistent-summary",
  escalation: "persistent",
  reasoning: "transient",
  drift: "disabled",
  evidence: "persistent-key",
};

const LEVEL_4: WeGradientStreamConfig = {
  workorder: "persistent",
  governance: "persistent",
  planvalidation: "persistent",
  execution: "persistent-full",
  escalation: "persistent",
  reasoning: "persistent",
  drift: "transient",
  evidence: "persistent-all",
};

const LEVEL_5: WeGradientStreamConfig = {
  workorder: "persistent",
  governance: "persistent",
  planvalidation: "persistent",
  execution: "persistent-full",
  escalation: "persistent",
  reasoning: "persistent",
  drift: "transient",
  evidence: "persistent-all",
};

const CONFIGS: readonly WeGradientStreamConfig[] = [
  LEVEL_0,
  LEVEL_1,
  LEVEL_2,
  LEVEL_3,
  LEVEL_4,
  LEVEL_5,
];

/**
 * Returns the default stream config for a We-Gradient maturity level.
 * Levels outside 0-5 are clamped to the nearest boundary.
 */
export function default_stream_config(level: number): WeGradientStreamConfig {
  const clamped = Math.max(0, Math.min(5, Math.floor(level)));
  return CONFIGS[clamped]!;
}
