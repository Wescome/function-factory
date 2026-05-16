/**
 * harness-dispatcher.ts — Worker queue consumer for `HARNESS_QUEUE`.
 *
 * This is a SEPARATE Worker entrypoint, not the RunCoordinator DO consuming
 * its own queue. CF DOs that consume queues which dispatch back to the same
 * DO produce a self-fetch deadlock — documented in MEMORY for Phase 3/4 and
 * called out by IS-HARNESS-DSL-v1 §3.1.
 *
 * Per-message flow:
 *
 *   1. Pull `{ runId, stageName }` off HARNESS_QUEUE.
 *   2. GET `/get-compiled` on the RunCoordinator DO for this run; receive
 *      `{ compiled, state }`. (Avoids putting CompiledHarness blobs on
 *      every queue message.)
 *   3. Resolve the stage spec on `compiled.spec.stages[stageName]`.
 *   4. Build a `CfArtifactManager` for the run prefix.
 *   5. Resolve the WorkerAdapter via the CF worker registry using
 *      `stage.worker`.
 *   6. Build StageContext (pre-hydrated; no filesystem) + WorkerInput.
 *   7. Invoke adapter.execute(); capture workerOutput or workerThrew.
 *   8. Evaluate stage gates against produced artifacts (gateRegistry on
 *      a synthesized RuntimeState view).
 *   9. POST `/stage-complete` to the RunCoordinator DO with the
 *      `StageCompletePayload` shape.
 *  10. Ack the queue message; on retryable failure (≤ max_retries) call
 *      msg.retry(); on exhaustion ack and emit `infra:queue-retry-exhausted`.
 *
 * Specification: IS-HARNESS-DSL-v1 §3.1, ADR-009 §4 Phase 3.
 *
 * Extension points (deferred to follow-up files cf-workers.ts and
 * cf-artifact-manager.ts):
 *
 *   - `resolveWorkerAdapter`     — returns a WorkerAdapter for a worker name.
 *   - `buildArtifactManager`     — returns an ArtifactManager for the run.
 *   - `buildStageContextForRun`  — builds the StageContext without FS access.
 *
 * These are passed via `HarnessDispatcherDeps` so this file stays
 * dispatch-only and can be unit-tested in isolation. The `default` export
 * wires them up via `buildDefaultDispatcherDeps` which throws until the
 * follow-up files land — that throw is the bound failure when the
 * harness path runs without the Container/Artifact wiring in place.
 */

import {
  gateRegistry as defaultGateRegistry,
  normalizeGateContract,
  type ArtifactManager,
  type CompiledHarness,
  type GateFn,
  type GateResult,
  type HarnessState,
  type StageSpec,
  type WorkerAdapter,
  type WorkerInput,
  type WorkerOutput,
} from "@factory/nlah"
import type {
  HarnessBridgeEnv,
  HarnessQueueMessage,
  StageCompletePayload,
} from "./harness-env"

const MAX_RETRIES = 3

/**
 * Dependencies the dispatcher needs from the rest of the system. Held as
 * an explicit shape so cf-workers.ts and cf-artifact-manager.ts can supply
 * concrete implementations without coupling this file to them.
 */
export interface HarnessDispatcherDeps {
  /**
   * Resolve a WorkerAdapter for a stage's `worker:` value. Throws if no
   * adapter is registered for that worker name. The dispatcher catches
   * the throw and surfaces it as `workerThrew` on the StageResult.
   */
  resolveWorkerAdapter(workerName: string | undefined, env: HarnessBridgeEnv): WorkerAdapter

  /**
   * Build the artifact manager for this run. Typically a CfArtifactManager
   * bound to WORKSPACE_BUCKET with prefix `artifacts/{runId}`.
   */
  buildArtifactManager(runId: string, compiled: CompiledHarness, env: HarnessBridgeEnv): ArtifactManager

  /**
   * Build the per-stage StageContext. CF-friendly: no filesystem reads;
   * task text comes from HarnessState.taskText (injected at initHarness).
   * Returns a value of `unknown` here because NLAH's StageContext is
   * authored in upstream contribution #1b; binding to it concretely is
   * deferred to cf-workers.ts.
   */
  buildStageContextForRun(args: {
    state: HarnessState
    compiled: CompiledHarness
    stage: StageSpec
    artifacts: ArtifactManager
  }): Promise<unknown>

  /**
   * The gate registry to evaluate against. Defaults to NLAH's
   * `gateRegistry` from @factory/nlah; CF-side custom gates can be merged
   * in by the wiring layer (contribution #5 — `registerGate`).
   */
  gateRegistry: Record<string, GateFn>
}

/**
 * Entrypoint used by the CF queue consumer binding. Exported as the
 * module's default so `wrangler.jsonc` can point its harness-queue
 * consumer at this script.
 */
export default {
  async queue(
    batch: MessageBatch<HarnessQueueMessage>,
    env: HarnessBridgeEnv,
  ): Promise<void> {
    const deps = buildDefaultDispatcherDeps()
    for (const msg of batch.messages) {
      try {
        await dispatchOne(msg.body, env, deps)
        msg.ack()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(
          `[harness-dispatcher] dispatch failed for run=${msg.body.runId} stage=${msg.body.stageName}: ${message}`,
        )
        if (msg.attempts >= MAX_RETRIES) {
          // Tier-1 signal per index.ts:1444 precedent.
          console.error(
            `[INFRA SIGNAL] infra:queue-retry-exhausted: harness-queue message for ${msg.body.runId}/${msg.body.stageName} exhausted ${msg.attempts} attempts`,
          )
          msg.ack()
        } else {
          msg.retry()
        }
      }
    }
  },
}

/**
 * Process one HarnessQueueMessage end-to-end. Exposed for unit testing.
 */
export async function dispatchOne(
  message: HarnessQueueMessage,
  env: HarnessBridgeEnv,
  deps: HarnessDispatcherDeps,
): Promise<void> {
  // ── 1. Fetch CompiledHarness + HarnessState from the RunCoordinator DO ──
  const doId = env.RUN_COORDINATOR.idFromName(message.runId)
  const stub = env.RUN_COORDINATOR.get(doId)
  const compiledResp = await stub.fetch("https://run-coordinator/get-compiled", {
    method: "GET",
  })
  if (!compiledResp.ok) {
    throw new Error(
      `RunCoordinator /get-compiled failed (${compiledResp.status}) for run ${message.runId}`,
    )
  }
  const { compiled, state } = (await compiledResp.json()) as {
    compiled: CompiledHarness
    state: HarnessState
  }

  const stage: StageSpec | undefined = compiled.spec.stages[message.stageName]
  if (!stage) {
    throw new Error(`unknown stage in compiled harness: ${message.stageName}`)
  }

  // ── 2. Build artifact manager + stage context ──────────────────────────
  const artifacts = deps.buildArtifactManager(message.runId, compiled, env)
  const stageContext = await deps.buildStageContextForRun({
    state,
    compiled,
    stage,
    artifacts,
  })

  // ── 3. Resolve worker + run it ─────────────────────────────────────────
  let workerOutput: WorkerOutput | null = null
  let workerThrew: { message: string } | undefined

  try {
    const adapter = deps.resolveWorkerAdapter(stage.worker, env)
    const stateView = synthesizeRuntimeStateView(state, compiled)
    const workerInput: WorkerInput = {
      stageName: message.stageName,
      roleName: stage.role,
      context: stageContext as WorkerInput["context"],
      state: stateView,
      declaredInputs: stage.inputs,
      declaredOutputs: stage.outputs,
    }
    workerOutput = await adapter.execute(workerInput, artifacts)
  } catch (err) {
    workerThrew = {
      message: err instanceof Error ? err.message : String(err),
    }
  }

  // ── 4. Evaluate gates against produced artifacts ───────────────────────
  // Gates run only when the worker did not throw. If the worker threw,
  // the gate set is empty and the RunCoordinator's synthetic
  // `worker_executed` gate handles the failure path.
  const gateResults: StageCompletePayload["gateResults"] = []
  if (!workerThrew && workerOutput) {
    const stateView = synthesizeRuntimeStateView(state, compiled)
    const all = stage.gate?.all ?? []
    const any = stage.gate?.any ?? []
    const expressions: unknown[] = [...all, ...any]

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i]
      const fallbackId = `${message.stageName}-gate-${i}`
      try {
        const contract = normalizeGateContract(expr, fallbackId)
        const gate = deps.gateRegistry[contract.uses]
        if (!gate) {
          gateResults.push({
            gateName: contract.uses,
            passed: false,
            detail: `gate ${contract.uses} not registered`,
          })
          continue
        }
        const record = await gate(
          stateView as unknown as Parameters<GateFn>[0],
          artifacts,
          contract.args,
        )
        gateResults.push(mapGateResult(record))
      } catch (gateErr) {
        const message = gateErr instanceof Error ? gateErr.message : String(gateErr)
        const name = extractGateName(expr) ?? fallbackId
        gateResults.push({ gateName: name, passed: false, detail: message })
      }
    }
  }

  // ── 5. POST /stage-complete back to the RunCoordinator DO ──────────────
  const completePayload: StageCompletePayload = {
    stageName: message.stageName,
    workerOutput: workerOutput ?? { createdArtifacts: [] },
    gateResults,
    ...(workerThrew ? { workerThrew } : {}),
  }

  const completeResp = await stub.fetch("https://run-coordinator/stage-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(completePayload),
  })
  if (!completeResp.ok) {
    const body = await completeResp.text().catch(() => "<no body>")
    throw new Error(
      `RunCoordinator /stage-complete failed (${completeResp.status}): ${body}`,
    )
  }
}

/**
 * Build the default dependency wiring used by the queue consumer at
 * deploy time. CF-side worker adapters and the CfArtifactManager live in
 * follow-up files (cf-workers.ts, cf-artifact-manager.ts) that are out of
 * scope for this commit. Until those land, this factory throws — which is
 * the intended bound failure if the harness path runs without complete
 * wiring.
 */
export function buildDefaultDispatcherDeps(): HarnessDispatcherDeps {
  return {
    resolveWorkerAdapter() {
      throw new Error(
        "harness-dispatcher: resolveWorkerAdapter is not wired; build cf-workers.ts (IS-HARNESS-DSL-v1 §5) and inject HarnessDispatcherDeps explicitly",
      )
    },
    buildArtifactManager() {
      throw new Error(
        "harness-dispatcher: buildArtifactManager is not wired; build cf-artifact-manager.ts (IS-HARNESS-DSL-v1 §4) and inject HarnessDispatcherDeps explicitly",
      )
    },
    buildStageContextForRun() {
      throw new Error(
        "harness-dispatcher: buildStageContextForRun is not wired; build cf-workers.ts buildStageContext shim (IS-HARNESS-DSL-v1 §3.1 step 4) and inject HarnessDispatcherDeps explicitly",
      )
    },
    gateRegistry: defaultGateRegistry,
  }
}

/**
 * Adapter view of HarnessState in the shape NLAH gates expect (RuntimeState).
 * Only the fields gates read are populated; gates that rely on filesystem
 * fields (`taskPath`, `repoPath`, `runRoot`, `stateRoot`, `artifactRoot`)
 * are CF-incompatible and must be replaced by Container-side gates
 * registered via contribution #5.
 *
 * Returns an `unknown`-typed wrapper; the dispatcher casts it through to
 * the GateFn signature at the call site. This keeps the cast local rather
 * than leaking a synthetic RuntimeState type across the module boundary.
 */
function synthesizeRuntimeStateView(state: HarnessState, _compiled: CompiledHarness): unknown {
  return {
    runId: state.runId,
    currentState: state.currentStage,
    taskPath: "",
    repoPath: "",
    harnessPath: "",
    runRoot: "",
    stateRoot: "",
    artifactRoot: "",
    stageHistory: [],
    artifacts: {},
  }
}

function mapGateResult(record: GateResult | { gate: string; passed: boolean; message?: string }): StageCompletePayload["gateResults"][number] {
  // Normalise from NLAH's GateEvalRecord (gates.ts) OR the runtime
  // GateResult shape (runtime.ts) into our wire shape.
  const r = record as Partial<GateResult> & Partial<{ gate: string; message: string }>
  const gateName = (r.gateName as string | undefined) ?? (r.gate as string | undefined) ?? "unknown"
  const detail = (r.detail as string | undefined) ?? (r.message as string | undefined)
  return {
    gateName,
    passed: r.passed === true,
    ...(detail ? { detail } : {}),
  }
}

function extractGateName(expr: unknown): string | null {
  if (typeof expr === "string") return expr
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const obj = expr as Record<string, unknown>
    if (typeof obj["uses"] === "string") return obj["uses"]
    const keys = Object.keys(obj)
    if (keys.length === 1 && typeof keys[0] === "string") return keys[0]
  }
  return null
}
