/**
 * ExecutionLog schema. Output artifact of Stage 6 harness_execute.
 *
 * Every harness_execute invocation produces one ExecutionLog even when
 * the adapter is unavailable. The per-node records cover exactly the set
 * of WorkGraphNodes in the source WorkGraph (no duplicates, no omissions).
 *
 * Per PRD-META-HARNESS-EXECUTE §"Schema additions required". The
 * transitionHint field described in the PRD is deferred until the
 * FunctionLifecycleTransitionHint schema is defined upstream.
 */

import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const ExecutionNodeStatus = z.enum([
  "completed",
  "failed",
  "skipped",
  "simulated",
  "unknown",
])
export type ExecutionNodeStatus = z.infer<typeof ExecutionNodeStatus>

export const ExecutionSummaryStatus = z.enum([
  "completed",
  "failed",
  "adapter_unavailable",
  "partial",
])
export type ExecutionSummaryStatus = z.infer<typeof ExecutionSummaryStatus>

export const ExecutionNodeRecord = z.object({
  nodeId: z.string().min(1),
  status: ExecutionNodeStatus,
  outcome: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  rationale: z.string().min(1),
})
export type ExecutionNodeRecord = z.infer<typeof ExecutionNodeRecord>

export const ExecutionLog = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("EL-"),
    "ExecutionLog IDs must start with EL-"
  ),
  workGraphId: ArtifactId,
  adapterId: z.string().min(1),
  timestamp: z.string().datetime(),
  status: ExecutionSummaryStatus,
  nodes: z.array(ExecutionNodeRecord).default([]),
})
export type ExecutionLog = z.infer<typeof ExecutionLog>
