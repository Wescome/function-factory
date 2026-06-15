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
