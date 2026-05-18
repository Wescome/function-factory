import type { HarnessRunResult } from "@factory/nlah"
import type { HarnessBridgeEnv, HarnessQueueMessage } from "./harness-env"

export async function consumeHarnessDlq(
  batch: MessageBatch<HarnessQueueMessage>,
  env: HarnessBridgeEnv,
): Promise<void> {
  for (const msg of batch.messages) {
    const { runId, stageName: executionNodeName } = msg.body
    try {
      const result: HarnessRunResult = {
        overall: "fail",
        finalStage: executionNodeName,
        reason: `Execution node ${executionNodeName} dead-lettered after queue retries exhausted.`,
        failureClass: "dlq_exhausted",
      }
      const doId = env.RUN_COORDINATOR.idFromName(runId)
      const stub = env.RUN_COORDINATOR.get(doId)
      const response = await stub.fetch(new Request("https://run-coordinator/force-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, result, reason: "dlq" }),
      }))
      if (!response.ok) {
        throw new Error(`RunCoordinator /force-complete failed (${response.status}) for ${runId}/${executionNodeName}`)
      }
      console.error(
        `[INFRA SIGNAL] infra:harness-dlq-recovered: runId=${runId} executionNode=${executionNodeName} sent force-complete`,
      )
      msg.ack()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[INFRA SIGNAL] infra:harness-dlq-recovery-failed: runId=${runId} executionNode=${executionNodeName} error=${message}`,
      )
      if (msg.attempts >= 1) {
        msg.ack()
      } else {
        msg.retry()
      }
    }
  }
}
