/**
 * Public types for @factory/harness-bridge.
 *
 * HarnessAdapter is the pluggable boundary- given a WorkGraphNode and
 * opaque adapter configuration, produce the executable fragment of an
 * ExecutionNodeRecord (status + optional outcome + rationale). The
 * harness orchestrator wraps each result with nodeId and timing.
 *
 * HarnessAdapterRegistry is a Map keyed by canonical adapter identifier
 * (e.g., "dry-run"). The registry is a constructor-time dependency of
 * harnessExecute, not a global.
 */

import type { WorkGraphNode } from "@factory/schemas"
import type { ExecutionNodeRecord } from "@factory/schemas"
import type { z } from "zod"

type WorkGraphNodeT = z.infer<typeof WorkGraphNode>

export interface AdapterNodeOutcome {
  readonly status: ExecutionNodeRecord["status"]
  readonly outcome?: ExecutionNodeRecord["outcome"]
  readonly rationale: ExecutionNodeRecord["rationale"]
}

export interface HarnessAdapter {
  readonly id: string
  execute(
    node: WorkGraphNodeT,
    config: Readonly<Record<string, unknown>>
  ): Promise<AdapterNodeOutcome>
}

export type HarnessAdapterRegistry = ReadonlyMap<string, HarnessAdapter>
