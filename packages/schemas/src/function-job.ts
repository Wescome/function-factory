/**
 * FunctionJob — the job descriptor handed to the Factory pipeline that
 * identifies a single Function execution run.
 *
 * Pre-IS-HARNESS-DSL-v1, FunctionJob lived only as a type reference in
 * specs/reference/FULL-PI-DEPLOYMENT-ARCHITECTURE.md (ADR-002 container
 * contract). IS-HARNESS-DSL-v1 §2 requires FunctionJob to carry an
 * optional `harnessKey` so pipeline.ts can route harness-driven runs to
 * `startHarnessRun` instead of the synthesis graph.
 *
 * This module formalises the minimum shape required to:
 *
 *   1. Key a RunCoordinator DO (`functionRunId`).
 *   2. Seed `HarnessState.taskText` (`objective`).
 *   3. Select the harness topology to compile (`harnessKey`).
 *   4. Address the suspended Workflow on completion (`workflowInstanceId`).
 *
 * Container-mode fields (executor, mode, plan, repo, fileScope, etc.) from
 * ADR-002 are intentionally NOT included here yet — they belong to a
 * container-job extension that will sit alongside FunctionJob when the
 * container fallback path is wired. The harness path does not need them.
 *
 * `harnessKey` is OPTIONAL. When absent, the pipeline routes through the
 * existing synthesis graph (legacy path). When present, the pipeline
 * routes through `startHarnessRun` (IS-HARNESS-DSL-v1 path).
 */

import { z } from "zod"

export const FunctionJob = z.object({
  /** Stable run identity. Keys the RunCoordinator DO. */
  functionRunId: z.string().min(1),

  /**
   * Task text injected into `HarnessState.taskText` via initHarness().
   * Workers receive this through their `StageContext`.
   */
  objective: z.string().min(1),

  /**
   * R2 key for the harness YAML to load. When present, the pipeline
   * routes this job through the harness runtime instead of the
   * synthesis graph. When absent, the synthesis graph runs as before.
   */
  harnessKey: z.string().min(1).optional(),

  /**
   * Optional override for the Workflow instance ID that should receive
   * the `harness-complete` event. Defaults to `functionRunId` on the
   * harness path (see harness-env.ts).
   */
  workflowInstanceId: z.string().min(1).optional(),
})

export type FunctionJob = z.infer<typeof FunctionJob>
