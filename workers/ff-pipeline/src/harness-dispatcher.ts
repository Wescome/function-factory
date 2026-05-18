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
import { CfArtifactManager } from "./cf-artifact-manager"
import { buildCfWorkerRegistry, buildStageContextFromJob } from "./cf-workers"
import { buildCfGateRegistry } from "./cf-gates"
import { compileOutputContracts } from "./contract-compiler"

const MAX_RETRIES = 3

/**
 * Cap on the size of `workerThrew.message` written into the
 * StageCompletePayload. CF queue messages are bounded (currently 128 KiB)
 * and an unbounded error message — for example a stack trace embedded in
 * an LLM response — could push a payload past that limit AND blow the
 * DO storage value cap on the persisted state.
 */
const MAX_WORKER_ERROR_MESSAGE_BYTES = 4096
const DEFAULT_PI_MODEL_ID = "openrouter/openai/gpt-5.4"
const DEFAULT_FILESYSTEM_MODEL_CANDIDATES = [
  "openrouter/openai/gpt-5.4",
  "openrouter/anthropic/claude-sonnet-4.6",
  "openrouter/google/gemini-3.1-pro-preview",
  "openrouter/x-ai/grok-4.20",
]

type RoutedPiModel = {
  id: string
  provider: string
  model: string
  routeKind: string
  resolvedVia: string
  fallback?: {
    id: string
    provider: string
    model: string
  }
  candidates?: Array<{
    id: string
    provider: string
    model: string
    resolvedVia: string
  }>
}

type PiExecutionRoute = {
  surface: "rpc"
  requiredCapabilities: string[]
  resolvedVia: string
}

type RoutedWorkerInput = WorkerInput & {
  runId?: string
  model?: RoutedPiModel
  execution?: PiExecutionRoute
  outputContracts?: import("./contract-compiler").OutputContract[]
  maxRepairRounds?: number
}

function parseModelId(id: string): Pick<RoutedPiModel, "id" | "provider" | "model"> {
  const [provider, ...rest] = id.split("/")
  const model = rest.join("/")
  if (!provider || !model) {
    throw new Error(`invalid pi model id: ${id}`)
  }
  return { id, provider, model }
}

function parseModelList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function dedupeModelIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function routeKindForRole(role: string): string {
  const lower = role.toLowerCase()
  if (lower.includes("plan")) return "planner"
  if (lower.includes("code") || lower.includes("patch")) return "coder"
  if (lower.includes("critic") || lower.includes("review")) return "critic"
  if (lower.includes("test") || lower.includes("verify")) return "tester"
  if (lower.includes("govern")) return "governor"
  return "worker"
}

function resolvePiModelRoute(stage: StageSpec, env: HarnessBridgeEnv): RoutedPiModel {
  const selectedId = env.PI_MODEL ?? DEFAULT_PI_MODEL_ID
  const filesystemCandidateIds = dedupeModelIds([
    selectedId,
    ...(
      env.PI_FILESYSTEM_MODEL_CANDIDATES
        ? parseModelList(env.PI_FILESYSTEM_MODEL_CANDIDATES)
        : parseModelList(env.PI_MODEL_CANDIDATES).length > 0
          ? parseModelList(env.PI_MODEL_CANDIDATES)
          : DEFAULT_FILESYSTEM_MODEL_CANDIDATES
    ),
  ])
  const selected = parseModelId(selectedId)
  return {
    ...selected,
    routeKind: routeKindForRole(stage.role),
    resolvedVia: env.PI_MODEL ? "config-default" : "env-default",
    fallback: parseModelId(DEFAULT_PI_MODEL_ID),
    ...(requiresAutonomousFilesystemTools(stage)
      ? {
          candidates: filesystemCandidateIds.map((id, index) => ({
            ...parseModelId(id),
            resolvedVia: index === 0
              ? (env.PI_MODEL ? "config-default" : "env-default")
              : env.PI_FILESYSTEM_MODEL_CANDIDATES
                ? "filesystem-candidates-env"
                : env.PI_MODEL_CANDIDATES
                  ? "model-candidates-env"
                  : "runtime-default-candidate",
          })),
        }
      : {}),
  }
}

function requiresAutonomousFilesystemTools(stage: StageSpec): boolean {
  return stage.outputs.some((name) =>
    name === "CandidatePatch"
    || name === "VerifierReport"
    || name === "FinalPatch"
    || name === "PRSummary"
  )
}

function resolvePiExecutionRoute(stage: StageSpec): PiExecutionRoute {
  if (!requiresAutonomousFilesystemTools(stage)) {
    return {
      surface: "rpc",
      requiredCapabilities: [],
      resolvedVia: "stage-contract",
    }
  }
  return {
    surface: "rpc",
    requiredCapabilities: ["filesystem_tools"],
    resolvedVia: "stage-contract",
  }
}

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
   * `taskText` is round-tripped through the RunCoordinator DO storage
   * because NLAH's `HarnessState` does NOT carry it (the live signature
   * at /Users/wes/nlah/src/runtime.ts:154 discards taskText via
   * `void context.taskText`). Returns a value of `unknown` here because
   * NLAH's StageContext is authored in upstream contribution #1b; binding
   * to it concretely is deferred to cf-workers.ts.
   */
  buildStageContextForRun(args: {
    state: HarnessState
    compiled: CompiledHarness
    stage: StageSpec
    artifacts: ArtifactManager
    taskText: string
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
    const deps = buildDefaultDispatcherDeps(env)
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
  // ── 1. Fetch CompiledHarness + HarnessState + taskText from the DO ────
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
  const { compiled, state, taskText } = (await compiledResp.json()) as {
    compiled: CompiledHarness
    state: HarnessState
    taskText?: string
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
    // `taskText` is sourced from RunCoordinator DO storage (KEY_TASK_TEXT)
    // rather than HarnessState because NLAH's runtime discards it (see
    // /Users/wes/nlah/src/runtime.ts:154). Default to empty string when
    // an older DO state predates the field — the bridge ALWAYS sends it
    // for new runs, so this only matters during a rolling deploy window.
    taskText: taskText ?? "",
  })

  // ── 3. Resolve worker + run it ─────────────────────────────────────────
  let workerOutput: WorkerOutput | null = null
  let workerThrew: { message: string } | undefined

  console.log(`[harness-dispatcher] worker.start run=${message.runId} stage=${message.stageName} worker=${stage.worker}`)
  const t0 = Date.now()

  try {
    const adapter = deps.resolveWorkerAdapter(stage.worker, env)
    const stateView = synthesizeRuntimeStateView(state, compiled)
    const outputContracts = compileOutputContracts(stage, compiled)
    const maxRepairRounds = compiled.spec.runtime?.max_repair_rounds ?? 1
    const workerInput: RoutedWorkerInput = {
      runId: message.runId,
      stageName: message.stageName,
      roleName: stage.role,
      context: stageContext as WorkerInput["context"],
      state: stateView as WorkerInput["state"],
      declaredInputs: stage.inputs,
      declaredOutputs: stage.outputs,
      outputContracts,
      maxRepairRounds,
      ...(stage.worker === "pi" ? {
        model: resolvePiModelRoute(stage, env),
        execution: resolvePiExecutionRoute(stage),
      } : {}),
    }
    workerOutput = await adapter.execute(workerInput, artifacts)
    console.log(`[harness-dispatcher] worker.complete run=${message.runId} stage=${message.stageName} artifacts=${JSON.stringify(workerOutput.createdArtifacts)} elapsedMs=${Date.now() - t0}`)
  } catch (err) {
    // Truncate to keep DO storage + queue payload bounded — see comment on
    // MAX_WORKER_ERROR_MESSAGE_BYTES above.
    const raw = err instanceof Error ? err.message : String(err)
    console.error(`[harness-dispatcher] worker.threw run=${message.runId} stage=${message.stageName} error=${raw.slice(0, 500)} elapsedMs=${Date.now() - t0}`)
    workerThrew = {
      message: raw.slice(0, MAX_WORKER_ERROR_MESSAGE_BYTES),
    }
  }

  // ── 4. Evaluate gates against produced artifacts ───────────────────────
  // Gates run only when the worker did not throw. If the worker threw,
  // the gate set is empty and the RunCoordinator's synthetic
  // `worker_executed` gate handles the failure path.
  //
  // `gate.all` and `gate.any` have DIFFERENT semantics and CANNOT be
  // flattened into a single array:
  //   - all-gates: pass iff EVERY member passes (boolean AND).
  //   - any-gates: pass iff AT LEAST ONE member passes (boolean OR);
  //                pass vacuously when no any-gates are declared.
  // We evaluate each group separately, decide the overall verdict from
  // the two booleans, and emit one synthetic anchor gate carrying that
  // verdict alongside the per-member results so the RunCoordinator's
  // failure path (which looks at gateResults.find(!passed)) sees the
  // right answer when any-gates rescue the stage.
  const gateResults: StageCompletePayload["gateResults"] = []
  if (!workerThrew && workerOutput) {
    const stateView = synthesizeRuntimeStateView(state, compiled)
    const all = stage.gate?.all ?? []
    const any = stage.gate?.any ?? []

    const evaluateExpressions = async (
      expressions: unknown[],
      bucket: "all" | "any",
    ): Promise<StageCompletePayload["gateResults"]> => {
      const out: StageCompletePayload["gateResults"] = []
      for (let i = 0; i < expressions.length; i++) {
        const expr = expressions[i]
        const fallbackId = `${message.stageName}-${bucket}-gate-${i}`
        try {
          const contract = normalizeGateContract(expr, fallbackId)
          const gate = deps.gateRegistry[contract.uses]
          if (!gate) {
            out.push({
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
          out.push(mapGateResult(record))
        } catch (gateErr) {
          const detail = gateErr instanceof Error ? gateErr.message : String(gateErr)
          const name = extractGateName(expr) ?? fallbackId
          out.push({ gateName: name, passed: false, detail })
        }
      }
      return out
    }

    const allResults = await evaluateExpressions(all as unknown[], "all")
    const anyResults = await evaluateExpressions(any as unknown[], "any")

    const allPassed = allResults.every((r) => r.passed)
    // Vacuously true when no any-gates declared (matches the all/any spec).
    const anyPassed = anyResults.length === 0 || anyResults.some((r) => r.passed)
    const gatePassed = allPassed && anyPassed

    // RunCoordinator interprets `gateResults.find(!passed)` as "gate failure"
    // when calling advanceHarness. To preserve `gate.any` semantics we MUST
    // ensure `gateResults.every(passed) === gatePassed`:
    //
    //   - all-results are always emitted as-is (their failures are real).
    //   - any-results are emitted as-is ONLY when the any-bucket failed
    //     (so the failures surface). When the any-bucket passed (one member
    //     passed), we project any-results to all-passing so a sibling any
    //     failure does not falsely trip the overall failure path.
    //
    // We also append a synthetic anchor gate per bucket so the trace records
    // the composed verdict even when individual records are rewritten.
    gateResults.push(...allResults)

    if (any.length > 0) {
      if (anyPassed) {
        // Mark each any-member as passed for the overall verdict, but
        // preserve its individual outcome in `detail` so the trace stays
        // honest. Without this, a stage with `any: [A, B]` where A passes
        // and B fails would report `passed:false` overall because B's
        // failure surfaces in find(!passed).
        for (const r of anyResults) {
          gateResults.push({
            gateName: r.gateName,
            passed: true,
            ...(r.failureClass ? { failureClass: r.failureClass } : {}),
            ...(r.passed
              ? r.detail
                ? { detail: r.detail }
                : {}
              : {
                  detail:
                    `member failed but any-bucket satisfied: ` +
                    (r.detail ?? "no detail"),
                }),
          })
        }
      } else {
        // Any-bucket failed: surface every member failure verbatim.
        gateResults.push(...anyResults)
      }
      // Synthetic anchor recording the composed verdict for traceability.
      gateResults.push({
        gateName: `${message.stageName}-gate-overall`,
        passed: gatePassed,
        detail:
          `gate composition: all=${allPassed} (${allResults.length} members) ` +
          `any=${anyPassed} (${anyResults.length} members)`,
      })
    }
  }

  // ── 5. POST /stage-complete back to the RunCoordinator DO ──────────────
  const gatesSummary = gateResults.map((g) => `${g.gateName}:${g.passed ? 'pass' : 'fail'}`).join(',')
  console.log(`[harness-dispatcher] gates.results run=${message.runId} stage=${message.stageName} gates=[${gatesSummary}] workerThrew=${!!workerThrew}`)

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
    console.error(`[harness-dispatcher] stage-complete.failed run=${message.runId} stage=${message.stageName} status=${completeResp.status} body=${body.slice(0, 500)}`)
    throw new Error(
      `RunCoordinator /stage-complete failed (${completeResp.status}): ${body}`,
    )
  }
  const completeBody = await completeResp.json().catch(() => ({})) as Record<string, unknown>
  console.log(`[harness-dispatcher] stage-complete.ok run=${message.runId} stage=${message.stageName} action=${completeBody.action} nextStage=${completeBody.nextStage ?? '(terminal)'}`)
}

/**
 * Build the default dependency wiring used by the queue consumer at
 * deploy time. The CfArtifactManager wiring is live (cf-artifact-manager.ts,
 * IS-HARNESS-DSL-v1 §4). CF-side worker adapters and the StageContext
 * builder live in cf-workers.ts (IS-HARNESS-DSL-v1 §5 / §3.1 step 4) and
 * remain stubbed here until that file lands — those stubs throw, which is
 * the intended bound failure if the harness path runs without complete
 * wiring.
 *
 * `env` is required so the artifact manager can be bound to the run's
 * R2 bucket. The dispatcher's queue handler always has `env` in scope, so
 * threading it through is a no-cost change.
 */
export function buildDefaultDispatcherDeps(env: HarnessBridgeEnv): HarnessDispatcherDeps {
  return {
    resolveWorkerAdapter(workerName, envForLookup) {
      if (!workerName || !workerName.trim()) {
        throw new Error(
          "harness-dispatcher: stage spec missing `worker` field; cannot resolve adapter",
        )
      }
      // Build a fresh registry per resolution. Cheap (it just constructs a
      // few adapter wrappers around env bindings) and avoids holding a
      // registry reference across the deps object's lifetime. The registry
      // throws `unknown worker: <name>` when the binding is absent — this
      // is the MISSING_WORKER_BINDING bound-failure path per
      // IS-HARNESS-DSL-v1 §5.
      const registry = buildCfWorkerRegistry(envForLookup)
      return registry.get(workerName)
    },
    buildArtifactManager: (runId) =>
      new CfArtifactManager(
        env.WORKSPACE_BUCKET,
        `runs/${runId}/artifacts/`,
      ),
    buildStageContextForRun: ({ state, stage, artifacts, taskText }) =>
      buildStageContextFromJob({
        taskText,
        runId: state.runId,
        stageName: state.currentStage,
        declaredInputs: stage.inputs,
        declaredOutputs: stage.outputs,
        artifacts,
      }),
    gateRegistry: buildCfGateRegistry(defaultGateRegistry),
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

function mapGateResult(record: GateResult | { gate: string; passed: boolean; message?: string; failureClass?: string }): StageCompletePayload["gateResults"][number] {
  // Normalise from NLAH's GateEvalRecord (gates.ts) OR the runtime
  // GateResult shape (runtime.ts) into our wire shape. failureClass is the
  // semantic failure category (e.g. missing_artifact, verifier_rejects) that
  // advanceHarness uses for on_failure/failure_taxonomy lookup.
  const r = record as Partial<GateResult> & Partial<{ gate: string; message: string; failureClass: string }>
  const gateName = (r.gateName as string | undefined) ?? (r.gate as string | undefined) ?? "unknown"
  const detail = (r.detail as string | undefined) ?? (r.message as string | undefined)
  const failureClass = r.failureClass as string | undefined
  return {
    gateName,
    passed: r.passed === true,
    ...(failureClass ? { failureClass } : {}),
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
