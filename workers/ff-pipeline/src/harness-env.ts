/**
 * harness-env.ts — typed Env shape and HarnessJob shape for the event-driven
 * harness path (Phase 3 / Phase 4 of IS-HARNESS-DSL-v1).
 *
 * Kept separate from `types.ts` (PipelineEnv) so the harness path can evolve
 * its bindings independently. `HarnessBridgeEnv` is intentionally narrow —
 * only the bindings touched by harness-bridge.ts, run-coordinator.ts, and
 * harness-dispatcher.ts appear here.
 *
 * NOTE: At deploy time these bindings live on the same Worker as the existing
 * pipeline.ts Workflow, so the consolidated runtime Env is
 * `PipelineEnv & HarnessBridgeEnv`. Callers that need both should intersect
 * the two interfaces.
 */

import type { CompiledHarness, HarnessState } from "@factory/nlah"

/**
 * The job descriptor passed to `startHarnessRun`. Modeled after FunctionJob
 * (packages/schemas) but kept minimal here — the bridge only needs the
 * fields it actually consumes. When FunctionJob is formalised in
 * packages/schemas, HarnessJob can be replaced by `Pick<FunctionJob, ...>`.
 */
export interface HarnessJob {
  /** Stable run identity. Used to key the RunCoordinator DO. */
  functionRunId: string

  /**
   * The task text injected into `HarnessState.taskText` via initHarness().
   * Workers receive this through their `StageContext`; gates may read it
   * through the synthesized RuntimeState view.
   */
  objective: string

  /**
   * R2 key for the harness YAML to load. Authoritative source-of-truth
   * for the harness topology for this run.
   */
  harnessKey: string

  /**
   * The CF Workflow instance ID this run reports completion back to via
   * `FACTORY_PIPELINE.get(workflowId).sendEvent({type:'harness-complete'})`.
   * Defaults to `functionRunId` when omitted (the common case).
   */
  workflowInstanceId?: string

  /**
   * Optional text artifacts to place in the run artifact namespace before
   * the first stage dispatch. Used by production smoke harnesses that need a
   * pre-seeded workspace or fixture artifact available as a first-stage input.
   */
  seedArtifacts?: Record<string, string>
}

/**
 * The CF Workflow event-dispatch surface used by the RunCoordinator to
 * notify the suspended Workflow on terminal state. Matches the shape used
 * at workers/ff-pipeline/src/index.ts:1431–1435 against the production
 * FACTORY_PIPELINE binding.
 */
export interface WorkflowInstanceLike {
  id: string
  status(): Promise<unknown>
  sendEvent(event: { type: string; payload: unknown }): Promise<void>
}

export interface FactoryPipelineBinding {
  get(id: string): Promise<WorkflowInstanceLike>
  create(opts: { id?: string; params: unknown }): Promise<{ id: string }>
}

/**
 * One message on the HARNESS_QUEUE. Carries only the run + stage identity;
 * the harness-dispatcher Worker fetches `CompiledHarness` and current
 * `HarnessState` from the RunCoordinator DO by runId to keep queue payloads
 * small.
 */
export interface HarnessQueueMessage {
  runId: string
  stageName: string
}

/**
 * The shape POSTed by the RunCoordinator DO to itself on /init (and read
 * back from /get-compiled by the dispatcher).
 *
 * `taskText` is persisted separately under `harness:taskText` because the
 * live NLAH `HarnessState` (see /Users/wes/nlah/src/runtime.ts) discards it
 * via `void context.taskText` in `initHarness`. The dispatcher reads it
 * back from `/get-compiled` and threads it into `buildStageContextForRun`.
 */
export interface RunCoordinatorInitPayload {
  compiled: CompiledHarness
  initialState: HarnessState
  workflowId: string
  taskText: string
}

/**
 * The shape POSTed to the RunCoordinator DO at /stage-complete by the
 * harness-dispatcher after a stage's worker + gates have run.
 */
export interface StageCompletePayload {
  stageName: string
  workerOutput: {
    createdArtifacts: string[]
    message?: string
  }
  gateResults: Array<{
    gateName: string
    passed: boolean
    failureClass?: string
    detail?: string
  }>
  workerThrew?: { message: string }
}

/**
 * Container worker fetcher binding. CF service bindings expose a
 * `fetch(req: Request): Promise<Response>` interface. Marked optional so
 * the harness-completeness gate at startHarnessRun time can detect missing
 * Container bindings and fail closed with MISSING_WORKER_BINDING.
 */
export type ContainerBinding = { fetch: (req: Request) => Promise<Response> }

/**
 * Env additions for the harness path. Layered onto the existing
 * `PipelineEnv` at runtime (the wrangler.jsonc bindings on the
 * same Worker apply to both).
 */
export interface HarnessBridgeEnv {
  /** R2 bucket holding harness YAMLs + run artifacts. */
  WORKSPACE_BUCKET: R2Bucket

  /** Durable Object namespace for the RunCoordinator (one DO per run). */
  RUN_COORDINATOR: DurableObjectNamespace

  /** Queue for stage dispatch — one message per stage start/retry. */
  HARNESS_QUEUE: Queue<HarnessQueueMessage>

  /** Existing Workflow binding — used to deliver harness-complete events. */
  FACTORY_PIPELINE: FactoryPipelineBinding

  /**
   * Pi container worker. CF Containers in wrangler 4 are DO-backed — this is
   * a DurableObjectNamespace. `buildCfWorkerRegistry` gets a singleton stub
   * via `idFromName("pi")` and wraps it as a ContainerBinding so the adapter
   * layer stays unchanged.
   */
  PI_CONTAINER?: DurableObjectNamespace

  /** Aider container worker. Required when the registry binds `aider`. */
  AIDER_CONTAINER?: ContainerBinding

  /** Claude Code container worker. Required when the registry binds `claude-code`. */
  CLAUDE_CODE_CONTAINER?: ContainerBinding

  /** ofox.ai API key — passed into the pi Container as OPENROUTER_API_KEY at start(). */
  OFOX_API_KEY: string

  /** Primary model identifier passed to pi via --model flag. */
  PI_MODEL?: string

  /**
   * Ordered comma-separated model candidates for Pi filesystem-authoring
   * Agent Calls. This is execution-contract route metadata: the dispatcher
   * sends the ordered plan to the worker, and the worker records which route
   * satisfied or failed the tool-capability probe.
   */
  PI_FILESYSTEM_MODEL_CANDIDATES?: string

  /** Generic ordered comma-separated Pi fallback candidates. */
  PI_MODEL_CANDIDATES?: string
}
