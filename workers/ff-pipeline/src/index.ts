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
  async fetch(request: Request, env: PipelineEnv): Promise<Response> {
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

    return new Response('ff-pipeline: use /test-do, /test-do-live, or /test-fetch', { status: 404 })
  },
}
