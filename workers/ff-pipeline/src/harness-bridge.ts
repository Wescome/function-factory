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
import type { HarnessBridgeEnv, HarnessJob } from "./harness-env"

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

  // ── 2. Parse + compile ──────────────────────────────────────────────────
  // NLAH's loadHarness accepts a `{ yaml: string }` source (contribution #1d)
  // so we never need a filesystem path in CF.
  const spec = await loadHarness({ yaml: yamlText })
  const compiled: CompiledHarness = compileHarness(spec)

  // ── 3. Harness completeness verification (Factory governance gate) ──────
  // Pass an empty workerNames set so the MISSING_WORKER_BINDING check runs
  // and fails closed for any harness that references a worker. Until
  // cf-workers.ts lands and the real worker registry is wired here, every
  // harness with a `worker:` declared in any stage will trip this check
  // — that is the correct behaviour: we MUST fail closed when the
  // dispatcher cannot actually resolve the named worker, rather than
  // letting a run proceed past /init only to throw at dispatch time.
  const workerNames: string[] = []
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

  // ── 4. Initialise HarnessState (pure) ───────────────────────────────────
  const initialState: HarnessState = initHarness(compiled, {
    taskText: job.objective,
    runId: job.functionRunId,
  })

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

  return { runId: job.functionRunId }
}
