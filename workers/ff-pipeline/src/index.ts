export { FactoryPipeline } from './pipeline'
export { SynthesisCoordinator } from './coordinator'

export { ingestSignal } from './stages/ingest-signal'
export { synthesizePressure } from './stages/synthesize-pressure'
export { mapCapability } from './stages/map-capability'
export { proposeFunction } from './stages/propose-function'
export { semanticReview } from './stages/semantic-review'
export { compilePRD, PASS_NAMES } from './stages/compile'

export { callModel } from './model-bridge'

export type {
  PipelineEnv,
  PipelineParams,
  PipelineResult,
  SignalInput,
  Gate1Report,
  SemanticReviewResult,
} from './types'

import type { PipelineEnv } from './types'

export default {
  async fetch(request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // ── Synthesis trigger: external route that bridges Workflow <-> DO ──
    if (url.pathname === '/trigger-synthesis' && request.method === 'POST') {
      const body = await request.json() as {
        workflowId?: string
        workGraphId?: string
        workGraph?: Record<string, unknown>
        dryRun?: boolean
      }

      if (!body.workflowId || !body.workGraphId || !body.workGraph) {
        return new Response(JSON.stringify({ error: 'Missing required fields: workflowId, workGraphId, workGraph' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Fire-and-forget: DO work + event sending happens in background
      const workflow = await env.FACTORY_PIPELINE.get(body.workflowId)
      const workGraphId = body.workGraphId
      const workGraph = body.workGraph
      const dryRun = body.dryRun ?? false

      ctx.waitUntil((async () => {
        try {
          const doId = env.COORDINATOR.idFromName(`synth-${workGraphId}`)
          const stub = env.COORDINATOR.get(doId)
          const doResponse = await stub.fetch(new Request('https://do/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workGraph, dryRun }),
          }))

          const result = await doResponse.json() as {
            verdict: { decision: string; confidence: number; reason: string }
            tokenUsage: number
            repairCount: number
          }

          await workflow.sendEvent({
            type: 'synthesis-complete',
            payload: {
              verdict: result.verdict,
              tokenUsage: result.tokenUsage,
              repairCount: result.repairCount,
            },
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          await workflow.sendEvent({
            type: 'synthesis-complete',
            payload: {
              verdict: { decision: 'fail', confidence: 1.0, reason: `Trigger error: ${errorMessage}` },
              tokenUsage: 0,
              repairCount: 0,
            },
          })
        }
      })())

      return new Response(JSON.stringify({ accepted: true, workGraphId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('ff-pipeline: POST /trigger-synthesis or use Queue consumer', { status: 404 })
  },

  async queue(batch: MessageBatch, env: PipelineEnv, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {
      const { workflowId, workGraphId, workGraph, dryRun } = msg.body as {
        workflowId: string
        workGraphId: string
        workGraph: Record<string, unknown>
        dryRun?: boolean
      }

      try {
        // Call DO via stub.fetch (works outside step.do)
        const doId = env.COORDINATOR.idFromName(`synth-${workGraphId}`)
        const stub = env.COORDINATOR.get(doId)
        const doResponse = await stub.fetch(new Request('https://do/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workGraph, dryRun: dryRun ?? false }),
        }))

        const result = await doResponse.json() as {
          verdict: { decision: string; confidence: number; reason: string }
          tokenUsage: number
          repairCount: number
        }

        // Send synthesis result back to the waiting Workflow
        const workflow = await env.FACTORY_PIPELINE.get(workflowId)
        await workflow.sendEvent({
          type: 'synthesis-complete',
          payload: {
            verdict: result.verdict,
            tokenUsage: result.tokenUsage,
            repairCount: result.repairCount,
          },
        })

        msg.ack()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        // max_retries: 2 in wrangler config = 3 total attempts (1 initial + 2 retries)
        if (msg.attempts >= 3) {
          // Max retries exhausted — send failure event so Workflow doesn't hang
          try {
            const workflow = await env.FACTORY_PIPELINE.get(workflowId)
            await workflow.sendEvent({
              type: 'synthesis-complete',
              payload: {
                verdict: { decision: 'fail', confidence: 1.0, reason: `Queue consumer error after ${msg.attempts} attempts: ${errorMessage}` },
                tokenUsage: 0,
                repairCount: 0,
              },
            })
          } catch (sendErr) {
            // Log the ACTUAL sendEvent error, not the original error — the sendEvent
            // failure reason (e.g. invalid_event_type, workflow not running) is what
            // matters for debugging why the workflow hangs.
            const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
            console.error(`Failed to send failure event for workflow ${workflowId}: sendEvent error: ${sendErrMsg} (original error: ${errorMessage})`)
          }
          msg.ack() // Remove from queue even though it failed
        } else {
          msg.retry()
        }
      }
    }
  },
}
