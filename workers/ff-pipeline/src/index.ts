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

    if (url.pathname === '/test-do') {
      const id = env.COORDINATOR.idFromName('test-diag')
      const stub = env.COORDINATOR.get(id)
      const testWg = { _key: 'WG-TEST', title: 'test', atoms: [], invariants: [], dependencies: [] }
      try {
        const result = await stub.synthesize(testWg, { dryRun: true })
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/test-fetch') {
      try {
        const res = await fetch('https://api.ofox.ai/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(30_000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OFOX_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v4-flash',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
          }),
        })
        const data = await res.json()
        return new Response(JSON.stringify(data, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/test-do-live') {
      const id = env.COORDINATOR.idFromName('test-live-diag')
      const stub = env.COORDINATOR.get(id)
      const testWg = { _key: 'WG-TEST-LIVE', title: 'test', atoms: [{ id: 'atom-1', type: 'impl', description: 'hello world function' }], invariants: [], dependencies: [] }
      try {
        const result = await stub.synthesize(testWg, { dryRun: false })
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

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

          await workflow.sendEvent('synthesis-complete', {
            verdict: result.verdict,
            tokenUsage: result.tokenUsage,
            repairCount: result.repairCount,
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          await workflow.sendEvent('synthesis-complete', {
            verdict: { decision: 'fail', confidence: 1.0, reason: `Trigger error: ${errorMessage}` },
            tokenUsage: 0,
            repairCount: 0,
          })
        }
      })())

      return new Response(JSON.stringify({ accepted: true, workGraphId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('ff-pipeline: use /test-do, /test-do-live, /test-fetch, or POST /trigger-synthesis', { status: 404 })
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
        await workflow.sendEvent('synthesis-complete', {
          verdict: result.verdict,
          tokenUsage: result.tokenUsage,
          repairCount: result.repairCount,
        })

        msg.ack()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        // max_retries: 2 in wrangler config = 3 total attempts (1 initial + 2 retries)
        if (msg.attempts >= 3) {
          // Max retries exhausted — send failure event so Workflow doesn't hang
          try {
            const workflow = await env.FACTORY_PIPELINE.get(workflowId)
            await workflow.sendEvent('synthesis-complete', {
              verdict: { decision: 'fail', confidence: 1.0, reason: `Queue consumer error after ${msg.attempts} attempts: ${errorMessage}` },
              tokenUsage: 0,
              repairCount: 0,
            })
          } catch {
            // If even the failure event can't be sent, log and move on
            console.error(`Failed to send failure event for workflow ${workflowId}: ${errorMessage}`)
          }
          msg.ack() // Remove from queue even though it failed
        } else {
          msg.retry()
        }
      }
    }
  },
}
