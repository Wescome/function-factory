/**
 * run-coordinator.ts — Durable Object that drives a single harness run.
 *
 * One DO per FunctionRun (keyed by `functionRunId`). Holds:
 *   - `compiled`     : the immutable CompiledHarness for the run.
 *   - `harnessState` : the live HarnessState (advances on each stage completion).
 *   - `workflowId`   : the CF Workflow instance to notify on terminal state.
 *
 * It exposes three HTTP endpoints (called by the bridge and dispatcher; the DO
 * never consumes its own queue — that would self-fetch-deadlock, see MEMORY):
 *
 *   POST /init             — receives { compiled, initialState, workflowId,
 *                            taskText }. Stores everything atomically;
 *                            enqueues the start stage on HARNESS_QUEUE.
 *                            `taskText` is persisted separately because NLAH's
 *                            HarnessState discards it via `void context.taskText`
 *                            in initHarness (see /Users/wes/nlah/src/runtime.ts:154).
 *   POST /stage-complete   — receives { stageName, workerOutput, gateResults,
 *                            workerThrew? } from the dispatcher. Calls
 *                            advanceHarness() (pure). Dispatches the next
 *                            stage or notifies the Workflow on terminal state.
 *   GET  /get-compiled     — returns { compiled, state, taskText } so the
 *                            dispatcher can resolve stage spec + state + task
 *                            text without putting a CompiledHarness blob on
 *                            every queue message.
 *
 * Specification: IS-HARNESS-DSL-v1 §3 and ADR-009 §4 Phase 3.
 */

import {
  advanceHarness,
  type CompiledHarness,
  type HarnessAdvance,
  type HarnessRunResult,
  type HarnessState,
  type StageResult,
  type WorkerOutput,
} from "@factory/nlah"
import { DurableObject } from "cloudflare:workers"
import { emitRunEvent } from "../observability/run-event-log"

interface HarnessQueueMessage {
  runId: string
  stageName: string
  attemptNumber?: number
}

interface RunCoordinatorEnv {
  HARNESS_QUEUE: Queue<HarnessQueueMessage>
  FACTORY_PIPELINE: {
    get(id: string): Promise<WorkflowInstance>
  }
  WORKSPACE_BUCKET?: R2Bucket | unknown
}

interface RunCoordinatorInitPayload {
  compiled: CompiledHarness
  initialState: HarnessState
  workflowId: string
  taskText: string
}

interface StageCompletePayload {
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
  workerThrew?: {
    message: string
    failureClass?: string
  }
}

interface OperatorDispatchPayload {
  runId: string
  stageName: string
  action: "retry-stage" | "redispatch-stage"
  idempotencyKey: string
  operator?: string
  reason?: string
}

// DO storage keys. Disjoint from any legacy coordinator DO keys (ADR-009 §8).
const KEY_COMPILED = "harness:compiled"
const KEY_STATE = "harness:state"
const KEY_WORKFLOW_ID = "harness:workflowId"
const KEY_TASK_TEXT = "harness:taskText"
const KEY_RESULT = "harness:result"
const KEY_DISPATCHED = "harness:dispatched"
const KEY_NOTIFY_ATTEMPTS = "harness:notifyAttempts"
const KEY_NOTIFY_ABANDONED = "harness:notifyAbandoned"
const OPERATOR_DISPATCH_PREFIX = "harness:operatorDispatch:"
const NOTIFY_RETRY_DELAY_MS = 30_000
const MAX_NOTIFY_ATTEMPTS = 100

export class RunCoordinator extends DurableObject<RunCoordinatorEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    try {
      if (request.method === "POST" && url.pathname === "/init") {
        return await this.handleInit(request)
      }
      if (request.method === "POST" && url.pathname === "/stage-complete") {
        return await this.handleStageComplete(request)
      }
      if (request.method === "POST" && url.pathname === "/force-complete") {
        return await this.handleForceComplete(request)
      }
      if (request.method === "POST" && url.pathname === "/operator-dispatch") {
        return await this.handleOperatorDispatch(request)
      }
      if (request.method === "GET" && url.pathname === "/get-compiled") {
        return await this.handleGetCompiled()
      }
      return new Response("not found", { status: 404 })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[RunCoordinator] error on ${request.method} ${url.pathname}: ${message}`)
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  override async alarm(): Promise<void> {
    const result = await this.ctx.storage.get<HarnessRunResult>(KEY_RESULT)
    if (!result) {
      console.error("[RunCoordinator] alarm fired but no terminal result is persisted")
      await this.ctx.storage.deleteAlarm()
      return
    }
    const [state, attempts, workflowId] = await Promise.all([
      this.ctx.storage.get<HarnessState>(KEY_STATE),
      this.ctx.storage.get<number>(KEY_NOTIFY_ATTEMPTS),
      this.ctx.storage.get<string>(KEY_WORKFLOW_ID),
    ])
    const runId = state?.runId ?? "unknown"
    if ((attempts ?? 0) >= MAX_NOTIFY_ATTEMPTS) {
      await this.ctx.storage.deleteAlarm()
      await this.permanentlyAbandonWorkflowNotification(
        runId,
        result,
        workflowId ?? "unknown",
        attempts ?? MAX_NOTIFY_ATTEMPTS,
      )
      return
    }
    await this.notifyWorkflowComplete(runId, result)
  }

  // ── /init ───────────────────────────────────────────────────────────────
  private async handleInit(request: Request): Promise<Response> {
    const payload = (await request.json()) as RunCoordinatorInitPayload
    if (
      !payload?.compiled ||
      !payload.initialState ||
      !payload.workflowId ||
      typeof payload.taskText !== "string"
    ) {
      return new Response(
        JSON.stringify({
          error: "missing compiled, initialState, workflowId, or taskText",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }

    // Idempotency guard — CF Workflow retries call /init multiple times.
    const [existingState, alreadyDispatched] = await Promise.all([
      this.ctx.storage.get<HarnessState>(KEY_STATE),
      this.ctx.storage.get<string>(KEY_DISPATCHED),
    ])

    if (existingState && alreadyDispatched) {
      // True replay: state persisted AND queue already sent. No-op.
      return new Response(
        JSON.stringify({ ok: true, runId: existingState.runId, replayed: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    // Persist before dispatching so a queue redelivery can recover. Batch
    // into one atomic put so a DO crash between writes cannot leave state
    // partial — CF DO storage supports multi-key puts.
    await this.ctx.storage.put({
      [KEY_COMPILED]: payload.compiled,
      [KEY_STATE]: payload.initialState,
      [KEY_WORKFLOW_ID]: payload.workflowId,
      [KEY_TASK_TEXT]: payload.taskText,
    })

    // Dispatch the start stage to HARNESS_QUEUE. The dispatcher Worker
    // picks up from there. Send AFTER the atomic write completes so the
    // dispatcher can always find consistent state on /get-compiled.
    await this.env.HARNESS_QUEUE.send({
      runId: payload.initialState.runId,
      stageName: payload.initialState.currentStage,
      attemptNumber: 1,
    })
    await emitRunEvent(this.env, {
      runId: payload.initialState.runId,
      workflowId: payload.workflowId,
      stageName: payload.initialState.currentStage,
      attemptNumber: 1,
      type: "stage_dispatched",
      emitter: "run-coordinator",
      data: { action: "init" },
    })

    await this.ctx.storage.put(KEY_DISPATCHED, "1")

    return new Response(
      JSON.stringify({
        ok: true,
        runId: payload.initialState.runId,
        firstStage: payload.initialState.currentStage,
        ...(existingState && !alreadyDispatched ? { resumed: true } : {}),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }

  // ── /get-compiled ───────────────────────────────────────────────────────
  // Returns the compiled harness + current state + taskText for the
  // dispatcher. `taskText` lives outside HarnessState because NLAH's
  // runtime discards it via `void context.taskText` (see
  // /Users/wes/nlah/src/runtime.ts:154); we round-trip it through DO
  // storage so the dispatcher can thread it into the worker context.
  private async handleGetCompiled(): Promise<Response> {
    const compiled = await this.ctx.storage.get<CompiledHarness>(KEY_COMPILED)
    const state = await this.ctx.storage.get<HarnessState>(KEY_STATE)
    const taskText = await this.ctx.storage.get<string>(KEY_TASK_TEXT)
    if (!compiled || !state) {
      return new Response(
        JSON.stringify({ error: "run not initialised" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      )
    }
    return new Response(
      JSON.stringify({ compiled, state, taskText: taskText ?? "" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  }

  // ── /stage-complete ─────────────────────────────────────────────────────
  private async handleStageComplete(request: Request): Promise<Response> {
    const payload = (await request.json()) as StageCompletePayload
    if (!payload?.stageName) {
      return new Response(
        JSON.stringify({ error: "missing stageName" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }

    const [state, compiled, existingResult] = await Promise.all([
      this.ctx.storage.get<HarnessState>(KEY_STATE),
      this.ctx.storage.get<CompiledHarness>(KEY_COMPILED),
      this.ctx.storage.get<HarnessRunResult>(KEY_RESULT),
    ])
    if (existingResult) {
      return new Response(
        JSON.stringify({ ok: true, action: "already-complete", result: existingResult }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (!state || !compiled) {
      return new Response(
        JSON.stringify({ error: "run state missing — was /init called?" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )
    }

    // Build the NLAH StageResult and call the pure advanceHarness.
    const workerOutput: WorkerOutput = {
      createdArtifacts: payload.workerOutput.createdArtifacts,
      ...(payload.workerOutput.message ? { message: payload.workerOutput.message } : {}),
    }

    const stageResult: StageResult = {
      stageName: payload.stageName,
      workerOutput,
      gateResults: payload.gateResults.map((gate) => ({
        gateName: gate.gateName,
        passed: gate.passed,
        ...(gate.failureClass ? { failureClass: gate.failureClass } : {}),
        ...(gate.detail ? { detail: gate.detail } : {}),
      })),
    }

    // workerThrew is surfaced as a synthetic failed gate so advanceHarness
    // routes through its retry/fail path. NLAH 0.1's StageResult doesn't
    // model a worker exception explicitly; contribution #1c is expected to
    // formalise this. Until then, the synthetic-gate pattern preserves
    // the failure semantics without forking the pure function.
    if (payload.workerThrew) {
      stageResult.gateResults.unshift({
        gateName: "worker_executed",
        passed: false,
        detail: `worker threw: ${payload.workerThrew.message}`,
        ...(payload.workerThrew.failureClass ? { failureClass: payload.workerThrew.failureClass } : {}),
      })
    }

    const advance: HarnessAdvance = advanceHarness(compiled, state, stageResult)

    // Persist new state when present (every action variant in HarnessAdvance
    // carries newState — see /Users/wes/nlah/src/runtime.ts).
    if (advance.newState) {
      await this.ctx.storage.put(KEY_STATE, advance.newState)
    }

    switch (advance.action) {
      case "dispatch":
      case "retry":
      case "return": {
        // Use newState.runId rather than the pre-advance state.runId so the
        // queue message is consistent with the freshly persisted state.
        // In practice runId never mutates across advance() — but reading
        // from advance.newState makes that contract explicit and survives
        // any future change to the pure function.
        const attemptNumber = inferAttemptNumber(advance.newState, advance.stage)
        await this.env.HARNESS_QUEUE.send({
          runId: advance.newState.runId,
          stageName: advance.stage,
          attemptNumber,
        })
        await emitRunEvent(this.env, {
          runId: advance.newState.runId,
          stageName: advance.stage,
          attemptNumber,
          type: "stage_dispatched",
          emitter: "run-coordinator",
          data: { action: advance.action, fromExecutionNode: payload.stageName },
        })
        return new Response(
          JSON.stringify({ ok: true, action: advance.action, nextStage: advance.stage }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      case "complete":
      case "fail": {
        await this.ctx.storage.put(KEY_RESULT, advance.result)
        await emitRunEvent(this.env, {
          runId: advance.newState.runId,
          stageName: advance.result.finalStage,
          type: "harness_complete",
          emitter: "run-coordinator",
          data: {
            overall: advance.result.overall,
            finalExecutionNode: advance.result.finalStage,
            reason: advance.result.reason,
            failureClass: advance.result.failureClass,
          },
        })
        await this.notifyWorkflowComplete(advance.newState.runId, advance.result)
        return new Response(
          JSON.stringify({ ok: true, action: advance.action, result: advance.result }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      default: {
        // Exhaustiveness check — TypeScript proves all HarnessAdvance
        // variants are handled above. If a new action is added upstream
        // and not handled here, the compiler errors at this assignment.
        const _exhaustive: never = advance
        throw new Error(
          `unreachable advance action: ${JSON.stringify(_exhaustive)}`,
        )
      }
    }
  }

  // ── /force-complete ────────────────────────────────────────────────────
  private async handleForceComplete(request: Request): Promise<Response> {
    const payload = (await request.json()) as {
      runId?: string
      result?: HarnessRunResult
      reason?: string
    }
    if (!payload?.result) {
      return new Response(
        JSON.stringify({ error: "missing result" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }

    const [existingResult, state] = await Promise.all([
      this.ctx.storage.get<HarnessRunResult>(KEY_RESULT),
      this.ctx.storage.get<HarnessState>(KEY_STATE),
    ])
    if (existingResult) {
      await this.notifyWorkflowComplete(payload.runId ?? state?.runId ?? "unknown", existingResult)
      return new Response(
        JSON.stringify({ ok: true, action: "already-complete", result: existingResult }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    await this.ctx.storage.put(KEY_RESULT, payload.result)
    if (state) {
      await this.ctx.storage.put(KEY_STATE, {
        ...state,
        status: "failed",
      } satisfies HarnessState)
    }
    await emitRunEvent(this.env, {
      runId: payload.runId ?? state?.runId ?? "unknown",
      stageName: payload.result.finalStage,
      type: "harness_complete",
      emitter: "run-coordinator",
      data: {
        overall: payload.result.overall,
        finalExecutionNode: payload.result.finalStage,
        reason: payload.result.reason,
        failureClass: payload.result.failureClass,
        forced: true,
        forceReason: payload.reason,
      },
    })
    await this.notifyWorkflowComplete(payload.runId ?? state?.runId ?? "unknown", payload.result)
    return new Response(
      JSON.stringify({ ok: true, action: "force-complete", result: payload.result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }

  // ── /operator-dispatch ─────────────────────────────────────────────────
  private async handleOperatorDispatch(request: Request): Promise<Response> {
    const payload = (await request.json()) as OperatorDispatchPayload
    if (
      !payload?.runId ||
      !payload.stageName ||
      (payload.action !== "retry-stage" && payload.action !== "redispatch-stage") ||
      !payload.idempotencyKey
    ) {
      return new Response(
        JSON.stringify({ error: "missing runId, stageName, action, or idempotencyKey" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }

    const [compiled, state, existingResult] = await Promise.all([
      this.ctx.storage.get<CompiledHarness>(KEY_COMPILED),
      this.ctx.storage.get<HarnessState>(KEY_STATE),
      this.ctx.storage.get<HarnessRunResult>(KEY_RESULT),
    ])
    if (!compiled || !state) {
      return new Response(
        JSON.stringify({ error: "run state missing — was /init called?" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )
    }
    if (payload.runId !== state.runId) {
      return new Response(
        JSON.stringify({ error: "runId does not match coordinator state", runId: state.runId }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )
    }
    if (existingResult || state.status !== "running") {
      return new Response(
        JSON.stringify({ error: "run is already terminal", runId: state.runId, status: state.status }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )
    }
    if (!compiled.spec.stages[payload.stageName]) {
      return new Response(
        JSON.stringify({ error: `unknown stage in compiled harness: ${payload.stageName}` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      )
    }
    if (payload.stageName !== state.currentStage) {
      return new Response(
        JSON.stringify({
          error: "stage is not current",
          runId: state.runId,
          requestedStage: payload.stageName,
          currentStage: state.currentStage,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )
    }

    const key = `${OPERATOR_DISPATCH_PREFIX}${payload.idempotencyKey}`
    const existing = await this.ctx.storage.get<{
      runId: string
      stageName: string
      action: string
      attemptNumber: number
      enqueuedAt: string
    }>(key)
    if (existing) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: "already-dispatched",
          runId: existing.runId,
          stageName: existing.stageName,
          attemptNumber: existing.attemptNumber,
          effect: { attempted: true, ok: true, deduped: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    const completedAttempts = state.stageAttempts?.[payload.stageName] ?? 0
    const attemptNumber = payload.action === "retry-stage"
      ? Math.max(1, completedAttempts + 1)
      : Math.max(1, completedAttempts)
    await this.env.HARNESS_QUEUE.send({
      runId: state.runId,
      stageName: payload.stageName,
      attemptNumber,
    })
    const record = {
      runId: state.runId,
      stageName: payload.stageName,
      action: payload.action,
      attemptNumber,
      enqueuedAt: new Date().toISOString(),
    }
    await this.ctx.storage.put(key, record)
    await emitRunEvent(this.env, {
      runId: state.runId,
      stageName: payload.stageName,
      attemptNumber,
      type: "stage_dispatched",
      emitter: "run-coordinator",
      data: {
        action: payload.action === "retry-stage" ? "operator_retry" : "operator_redispatch",
        operator: payload.operator,
        reason: payload.reason,
        idempotencyKey: payload.idempotencyKey,
      },
    })
    return new Response(
      JSON.stringify({
        ok: true,
        action: payload.action,
        runId: state.runId,
        stageName: payload.stageName,
        attemptNumber,
        effect: { attempted: true, ok: true, enqueued: true, deduped: false },
      }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    )
  }

  /**
   * Notify the suspended Workflow that the harness has reached a terminal
   * state. Matches the established sendEvent pattern from
   * workers/ff-pipeline/src/index.ts:1431–1435 (synthesis-complete).
   *
   * On sendEvent failure we persist the result to DO storage so a later
   * recovery path (poll /get-result, or a HARNESS_RESULTS relay queue when
   * added) can deliver it, AND emit a Tier-1 infra signal so the Governor
   * can see that a terminal result was produced but did not reach the
   * Workflow. The signal subtype follows the
   * `[INFRA SIGNAL] infra:<event>` console pattern used elsewhere in
   * ff-pipeline (e.g. index.ts:1378, harness-dispatcher.ts:129).
   */
  private async notifyWorkflowComplete(
    runId: string,
    result: HarnessRunResult,
  ): Promise<void> {
    const workflowId = await this.ctx.storage.get<string>(KEY_WORKFLOW_ID)
    if (!workflowId) {
      console.error("[RunCoordinator] notifyWorkflowComplete: no workflowId in storage")
      return
    }
    try {
      const workflow = await this.env.FACTORY_PIPELINE.get(workflowId)
      await workflow.sendEvent({
        type: "harness-complete",
        payload: result,
      })
      await emitRunEvent(this.env, {
        runId,
        stageName: result.finalStage,
        type: "workflow_notified",
        emitter: "run-coordinator",
        data: { workflowId, overall: result.overall },
      })
      await this.ctx.storage.delete(KEY_NOTIFY_ATTEMPTS)
      await this.ctx.storage.deleteAlarm()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const attempts = (await this.ctx.storage.get<number>(KEY_NOTIFY_ATTEMPTS)) ?? 0
      const nextAttempts = attempts + 1
      await this.ctx.storage.put(KEY_NOTIFY_ATTEMPTS, nextAttempts)
      if (nextAttempts >= MAX_NOTIFY_ATTEMPTS) {
        await this.ctx.storage.deleteAlarm()
        await this.permanentlyAbandonWorkflowNotification(runId, result, workflowId, nextAttempts, message)
        return
      }
      await this.ctx.storage.setAlarm(Date.now() + NOTIFY_RETRY_DELAY_MS)
      await emitRunEvent(this.env, {
        runId,
        stageName: result.finalStage,
        type: "workflow_notify_failed",
        emitter: "run-coordinator",
        data: { workflowId, attempts: nextAttempts, failureClass: "infrastructure_error" },
        error: { message },
      })
      // Tier-1 signal: workflow sendEvent failed. Result is persisted at
      // KEY_RESULT; a future HARNESS_RESULTS relay queue or a poll endpoint
      // can drain it. This matches the console-only signal pattern in
      // index.ts:1626 / harness-dispatcher.ts:129 — HarnessBridgeEnv does
      // not carry an Arango binding, so structured ingestSignal happens at
      // a Worker-side dead-letter consumer when one is added.
      console.error(
        `[INFRA SIGNAL] infra:harness-complete-sendevent-failed: runId=${runId} workflowId=${workflowId} error=${message}`,
      )
      console.error(
        `[RunCoordinator] sendEvent harness-complete failed for ${workflowId}: ${message}`,
      )
      // Result already persisted at KEY_RESULT; recovery path can read it.
    }
  }

  private async permanentlyAbandonWorkflowNotification(
    runId: string,
    result: HarnessRunResult,
    workflowId: string,
    attempts: number,
    message = "maximum harness-complete notification attempts exhausted",
  ): Promise<void> {
    const alreadyAbandoned = await this.ctx.storage.get<string>(KEY_NOTIFY_ABANDONED)
    if (alreadyAbandoned) return
    await this.ctx.storage.put(KEY_NOTIFY_ABANDONED, new Date().toISOString())
    await emitRunEvent(this.env, {
      runId,
      stageName: result.finalStage,
      type: "workflow_notify_failed",
      emitter: "run-coordinator",
      data: {
        workflowId,
        attempts,
        failureClass: "infrastructure_error",
        permanentlyAbandoned: true,
      },
      error: { message },
    })
    console.error(
      `[INFRA SIGNAL] infra:harness-complete-permanently-abandoned: runId=${runId} workflowId=${workflowId} attempts=${attempts} error=${message}`,
    )
  }
}

function inferAttemptNumber(state: HarnessState, stageName: string): number {
  const attempts = state.stageAttempts as Record<string, number> | undefined
  const value = attempts?.[stageName]
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, value) : 1
}
