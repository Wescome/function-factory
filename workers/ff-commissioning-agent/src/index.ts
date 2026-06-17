/**
 * ff-commissioning-agent — Worker entry point
 *
 * Exports CommissioningAgentDO and routes fetch requests to it.
 * The DO is addressed by orgId: idFromName('commissioning-agent:{orgId}').
 */

export { CommissioningAgentDO } from '@factory/commissioning-agent'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // GET /agents/commissioning/{orgId}/signal/{sessionId} — poll endpoint
    if (request.method === 'GET') {
      const pollMatch = url.pathname.match(/^\/agents\/commissioning\/([^/]+)\/signal\/(.+)$/)
      if (pollMatch) {
        const orgId = pollMatch[1]
        const sessionId = pollMatch[2]
        if (!orgId || !sessionId) {
          return new Response('Missing orgId or sessionId in path', { status: 400 })
        }
        const id = env.COMMISSIONING_AGENT.idFromName('commissioning-agent:' + orgId)
        const stub = env.COMMISSIONING_AGENT.get(id)
        return stub.fetch(new Request('https://do/signal/' + sessionId, { method: 'GET' }))
      }
    }

    // Extract orgId from path: /agents/commissioning/{orgId}/**
    const pathMatch = url.pathname.match(/^\/agents\/commissioning\/([^/]+)(.*)$/)
    if (pathMatch) {
      const orgId = pathMatch[1]
      if (!orgId) {
        return new Response('Missing orgId in path', { status: 400 })
      }
      const subPath = pathMatch[2] ?? '/'
      const id = env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${orgId}`)
      const stub = env.COMMISSIONING_AGENT.get(id)
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = subPath || '/'
      return stub.fetch(new Request(forwardUrl.toString(), request))
    }
    return new Response('Not found', { status: 404 })
  },
}

interface Env {
  COMMISSIONING_AGENT: DurableObjectNamespace
}
