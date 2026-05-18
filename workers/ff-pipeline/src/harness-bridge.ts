/**
 * harness-bridge.ts — event-driven CF adapter for the NLAH harness runtime.
 *
 * This module is the seam between a CF Workflow (`step.do('init-harness')`)
 * and the `RunCoordinator` Durable Object that drives the per-run state
 * machine. It DOES NOT block waiting for run completion — the Workflow
 * suspends via `step.waitForEvent('harness-complete', { timeout: '7 days' })`
 * after `startHarnessRun` returns.
 *
 * Specification: IS-HARNESS-DSL-v1 §2 and ADR-009 §4 Phase 3.
 *
 * Call sequence inside startHarnessRun:
 *
 *   1. Load the harness YAML from R2 (`WORKSPACE_BUCKET`).
 *   2. Parse + compile via NLAH's `loadHarness({ yaml }) + compileHarness`.
 *   3. Run `runHarnessCompletenessVerification` (Factory governance gate).
 *      If it fails, THROW — the Workflow step fails closed and no DO is
 *      initialised.
 *   4. Build the initial `HarnessState` via NLAH's pure `initHarness`.
 *   5. POST `/init` to the per-run RunCoordinator DO (keyed by
 *      `functionRunId`) with `{ compiled, initialState, workflowId }`.
 *   6. The DO dispatches the start stage to `HARNESS_QUEUE`; the
 *      harness-dispatcher Worker picks it up.
 *
 * No filesystem. No `node:fs`. No blocking on stage execution.
 */

import {
  compileHarness,
  gateRegistry,
  initHarness,
  loadHarness,
  type CompiledHarness,
  type HarnessState,
} from "@factory/nlah"
import { runHarnessCompletenessVerification } from "@factory/verification"
import { buildCfWorkerRegistry } from "./cf-workers"
import type { HarnessBridgeEnv, HarnessJob } from "./harness-env"
import { emitRunEvent } from "./observability/run-event-log"

export interface StartHarnessRunResult {
  runId: string
}

/**
 * Start a new harness run. Called from inside a Workflow `step.do()`.
 *
 * @param harnessKey  R2 object key for the harness YAML
 *                    (e.g. `harnesses/coding-adapter.harness.yaml`).
 * @param env         Worker environment with bindings declared in
 *                    `HarnessBridgeEnv` (WORKSPACE_BUCKET, RUN_COORDINATOR,
 *                    HARNESS_QUEUE, FACTORY_PIPELINE).
 * @param job         The HarnessJob describing this run. `functionRunId`
 *                    keys the RunCoordinator DO; `objective` is injected
 *                    into `HarnessState.taskText` via initHarness().
 *
 * @throws when:
 *   - The harness YAML is missing from R2.
 *   - The YAML fails NLAH's compile step (compiler errors propagate).
 *   - `runHarnessCompletenessVerification` returns `overall: 'fail'`.
 *     The thrown error carries the failure code and details.
 *   - The DO `/init` POST returns a non-2xx response.
 */
export async function startHarnessRun(
  harnessKey: string,
  env: HarnessBridgeEnv,
  job: HarnessJob,
): Promise<StartHarnessRunResult> {
  // ── 1. Load harness YAML from R2 ────────────────────────────────────────
  const obj = await env.WORKSPACE_BUCKET.get(harnessKey)
  if (!obj) {
    throw new Error(`Harness YAML not found in R2: ${harnessKey}`)
  }
  const yamlText = await obj.text()
  await emitRunEvent(env, {
    runId: job.functionRunId,
    workflowId: job.workflowInstanceId ?? job.functionRunId,
    type: "run_started",
    emitter: "harness-bridge",
    data: { harnessKey, objectiveBytes: job.objective.length },
  })

  // ── 2. Parse + compile ──────────────────────────────────────────────────
  // NLAH's loadHarness accepts a `{ yaml: string }` source (contribution #1d)
  // so we never need a filesystem path in CF.
  const spec = await loadHarness({ yaml: yamlText })
  const compiled: CompiledHarness = compileHarness(spec)

  // ── 3. Harness completeness verification (Factory governance gate) ──────
  // Build the live worker registry from env so completeness verification
  // knows which workers are actually bound at this deployment. WorkerRegistry
  // always includes "deterministic"; CF container bindings add "pi", "aider",
  // "claude-code" when present. Fail closed if the registry cannot resolve
  // every worker name declared in the harness stages.
  const workerNames: string[] = buildCfWorkerRegistry(env).names()
  const report = await runHarnessCompletenessVerification(
    compiled,
    gateRegistry,
    { workerNames },
  )
  if (report.overall !== "pass") {
    const failureCode = report.failure_code ?? "UNKNOWN_FAILURE"
    const detail = report.details.join("; ")
    throw new Error(
      `Harness completeness check failed: ${failureCode}: ${detail}`,
    )
  }
  await emitRunEvent(env, {
    runId: job.functionRunId,
    workflowId: job.workflowInstanceId ?? job.functionRunId,
    type: "harness_loaded",
    emitter: "harness-bridge",
    data: {
      harnessKey,
      harnessName: compiled.spec.harness.name,
      executionNodes: Object.keys(compiled.spec.stages),
      workerNames,
      watchdogThresholdsMs: watchdogThresholdsMs(compiled),
    },
  })

  // ── 4. Initialise HarnessState (pure) ───────────────────────────────────
  const initialState: HarnessState = initHarness(compiled, {
    taskText: job.objective,
    runId: job.functionRunId,
  })

  await seedInitialArtifacts(env, job.functionRunId, job.seedArtifacts)

  // ── 5. POST /init to the per-run RunCoordinator DO ──────────────────────
  // Stores compiled + initialState + workflowId in DO storage and dispatches
  // the start stage to HARNESS_QUEUE.
  const doId = env.RUN_COORDINATOR.idFromName(job.functionRunId)
  const stub = env.RUN_COORDINATOR.get(doId)

  const workflowId = job.workflowInstanceId ?? job.functionRunId

  const initResponse = await stub.fetch("https://run-coordinator/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      compiled,
      initialState,
      workflowId,
      // taskText is persisted separately in the DO under harness:taskText
      // because NLAH's runtime discards it from HarnessState (see
      // /Users/wes/nlah/src/runtime.ts:154). The dispatcher re-reads it
      // via /get-compiled.
      taskText: job.objective,
    }),
  })

  if (!initResponse.ok) {
    const body = await initResponse.text().catch(() => "<no body>")
    throw new Error(
      `RunCoordinator /init failed (${initResponse.status}): ${body}`,
    )
  }
  await emitRunEvent(env, {
    runId: job.functionRunId,
    workflowId,
    type: "run_coordinator_initialized",
    emitter: "harness-bridge",
    data: { firstExecutionNode: initialState.currentStage },
  })

  return { runId: job.functionRunId }
}

function watchdogThresholdsMs(compiled: CompiledHarness): Record<string, number> {
  const runtime = compiled.spec.runtime as Record<string, unknown> | undefined
  const raw = runtime?.stage_watchdog_minutes
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [name, minutes] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
      out[name] = minutes * 60 * 1000
    }
  }
  return out
}

async function seedInitialArtifacts(
  env: HarnessBridgeEnv,
  runId: string,
  seedArtifacts: Record<string, string> | undefined,
): Promise<void> {
  if (!seedArtifacts) return
  for (const [name, content] of Object.entries(seedArtifacts)) {
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("/") || name.includes("..")) {
      throw new Error(`unsafe seed artifact name: ${name}`)
    }
    if (typeof content !== "string") {
      throw new Error(`seed artifact content must be a string: ${name}`)
    }
    try {
      await env.WORKSPACE_BUCKET.put(
        `runs/${runId}/artifacts/${name}`,
        content,
        { httpMetadata: { contentType: "text/plain; charset=utf-8" } },
      )
      await emitRunEvent(env, {
        runId,
        type: "seed_written",
        emitter: "harness-bridge",
        data: { artifact: name, bytes: content.length },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await emitRunEvent(env, {
        runId,
        type: "seed_failed",
        emitter: "harness-bridge",
        data: { artifact: name, bytes: content.length },
        error: { message },
      })
      throw err
    }
  }
}
