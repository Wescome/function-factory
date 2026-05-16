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
 *   POST /init             — receives { compiled, initialState, workflowId }.
 *                            Stores everything; enqueues the start stage on
 *                            HARNESS_QUEUE.
 *   POST /stage-complete   — receives { stageName, workerOutput, gateResults,
 *                            workerThrew? } from the dispatcher. Calls
 *                            advanceHarness() (pure). Dispatches the next
 *                            stage or notifies the Workflow on terminal state.
 *   GET  /get-compiled     — returns { compiled, state } so the dispatcher
 *                            can resolve stage spec + state without putting
 *                            a CompiledHarness blob on every queue message.
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
import type {
  HarnessBridgeEnv,
  RunCoordinatorInitPayload,
  StageCompletePayload,
} from "../harness-env"

// DO storage keys. Disjoint from any existing coordinator DO's keys so the
// rollback note in ADR-009 §8 holds: graph-runner state and harness state
// never share a namespace.
const KEY_COMPILED = "harness:compiled"
const KEY_STATE = "harness:state"
const KEY_WORKFLOW_ID = "harness:workflowId"
const KEY_RESULT = "harness:result"

export class RunCoordinator extends DurableObject<HarnessBridgeEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    try {
      if (request.method === "POST" && url.pathname === "/init") {
        return await this.handleInit(request)
      }
      if (request.method === "POST" && url.pathname === "/stage-complete") {
        return await this.handleStageComplete(request)
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

  // ── /init ───────────────────────────────────────────────────────────────
  private async handleInit(request: Request): Promise<Response> {
    const payload = (await request.json()) as RunCoordinatorInitPayload
    if (!payload?.compiled || !payload.initialState || !payload.workflowId) {
      return new Response(
        JSON.stringify({ error: "missing compiled, initialState, or workflowId" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }

    // Persist before dispatching so a queue redelivery can recover.
    await this.ctx.storage.put(KEY_COMPILED, payload.compiled)
    await this.ctx.storage.put(KEY_STATE, payload.initialState)
    await this.ctx.storage.put(KEY_WORKFLOW_ID, payload.workflowId)

    // Dispatch the start stage to HARNESS_QUEUE. The dispatcher Worker
    // picks up from there.
    await this.env.HARNESS_QUEUE.send({
      runId: payload.initialState.runId,
      stageName: payload.initialState.currentStage,
    })

    return new Response(
      JSON.stringify({
        ok: true,
        runId: payload.initialState.runId,
        firstStage: payload.initialState.currentStage,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }

  // ── /get-compiled ───────────────────────────────────────────────────────
  // Returns the compiled harness + current state for the dispatcher.
  private async handleGetCompiled(): Promise<Response> {
    const compiled = await this.ctx.storage.get<CompiledHarness>(KEY_COMPILED)
    const state = await this.ctx.storage.get<HarnessState>(KEY_STATE)
    if (!compiled || !state) {
      return new Response(
        JSON.stringify({ error: "run not initialised" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      )
    }
    return new Response(JSON.stringify({ compiled, state }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
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

    const state = await this.ctx.storage.get<HarnessState>(KEY_STATE)
    const compiled = await this.ctx.storage.get<CompiledHarness>(KEY_COMPILED)
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
        await this.env.HARNESS_QUEUE.send({
          runId: state.runId,
          stageName: advance.stage,
        })
        return new Response(
          JSON.stringify({ ok: true, action: advance.action, nextStage: advance.stage }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      case "complete":
      case "fail": {
        await this.ctx.storage.put(KEY_RESULT, advance.result)
        await this.notifyWorkflowComplete(advance.result)
        return new Response(
          JSON.stringify({ ok: true, action: advance.action, result: advance.result }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
    }
  }

  /**
   * Notify the suspended Workflow that the harness has reached a terminal
   * state. Matches the established sendEvent pattern from
   * workers/ff-pipeline/src/index.ts:1431–1435 (synthesis-complete).
   *
   * On sendEvent failure we persist the result to DO storage so a later
   * recovery path (poll /get-result, or a HARNESS_RESULTS relay queue when
   * added) can deliver it.
   */
  private async notifyWorkflowComplete(result: HarnessRunResult): Promise<void> {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[RunCoordinator] sendEvent harness-complete failed for ${workflowId}: ${message}`,
      )
      // Result already persisted at KEY_RESULT; recovery path can read it.
    }
  }
}
