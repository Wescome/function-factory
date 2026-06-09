import type { HarnessRunResult } from "@factory/nlah"
import { RunEventLog } from "./run-event-log"

const DEFAULT_STUCK_THRESHOLD_MS = 30 * 60 * 1000

const DEFAULT_STAGE_THRESHOLDS_MS: Record<string, number> = {
  SEED: 5 * 60 * 1000,
  CONTRACT: 15 * 60 * 1000,
  MAP: 20 * 60 * 1000,
  PATCH: 30 * 60 * 1000,
  VERIFY: 60 * 60 * 1000,
}

interface WatchdogEnv {
  WORKSPACE_BUCKET: R2Bucket
  RUN_COORDINATOR: DurableObjectNamespace
}

export async function scanForStuckRuns(env: WatchdogEnv, now = Date.now()): Promise<void> {
  const log = new RunEventLog(env.WORKSPACE_BUCKET)
  const index = await log.getActiveIndex()

  for (const entry of index.runs) {
    const summary = await log.getSummary(entry.runId)
    if (!summary || summary.status !== "running") {
      await log.removeActiveRun(entry.runId)
      continue
    }

    const lastEventAtMs = Date.parse(summary.lastEventAt)
    if (!Number.isFinite(lastEventAtMs)) continue

    const threshold = thresholdForExecutionNode(summary.currentStage, summary.watchdogThresholdsMs)
    if (now - lastEventAtMs <= threshold) continue

    const executionNodeName = summary.currentStage ?? entry.currentStage ?? "unknown"
    const result: HarnessRunResult = {
      overall: "fail",
      finalStage: executionNodeName,
      reason: `Run ${entry.runId} stuck: no progress since ${summary.lastEventAt}.`,
      failureClass: "watchdog_stuck",
    }

    await log.emit({
      runId: entry.runId,
      stageName: executionNodeName,
      type: "stuck_detected",
      emitter: "watchdog",
      data: {
        lastEventAt: summary.lastEventAt,
        thresholdMs: threshold,
        failureClass: "watchdog_stuck",
      },
    })

    try {
      const doId = env.RUN_COORDINATOR.idFromName(entry.runId)
      const stub = env.RUN_COORDINATOR.get(doId)
      const response = await stub.fetch(new Request("https://run-coordinator/force-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: entry.runId, result, reason: "watchdog" }),
      }))
      if (!response.ok) {
        const body = await response.text().catch(() => "<no body>")
        throw new Error(`RunCoordinator /force-complete failed (${response.status}): ${body}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[watchdog] force-complete failed run=${entry.runId} executionNode=${executionNodeName}: ${message}`)
    }
  }
}

function thresholdForExecutionNode(name: string | undefined, overrides?: Record<string, number>): number {
  if (!name) return DEFAULT_STUCK_THRESHOLD_MS
  if (overrides?.[name]) return overrides[name]
  return DEFAULT_STAGE_THRESHOLDS_MS[name] ?? DEFAULT_STUCK_THRESHOLD_MS
}
