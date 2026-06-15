/**
 * ff-architect-agent — Worker entry point
 *
 * Exports ArchitectAgentDO and routes fetch requests to it.
 * The DO is a singleton: idFromName('architect-agent:factory').
 *
 * Routes:
 *   /agents/architect/**  → ArchitectAgentDO (all methods)
 *   /health               → ArchitectAgentDO /health
 */

export { ArchitectAgentDO } from '@factory/architect-agent'

import type { Env } from '@factory/architect-agent'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health shortcut — proxy to singleton DO
    if (url.pathname === '/health' && request.method === 'GET') {
      const id = env.ARCHITECT_AGENT.idFromName('architect-agent:factory')
      const stub = env.ARCHITECT_AGENT.get(id)
      return stub.fetch(request)
    }

    // Primary routing: /agents/architect/**
    const pathMatch = url.pathname.match(/^\/agents\/architect(.*)$/)
    if (pathMatch) {
      const subPath = pathMatch[1] ?? '/'
      const id = env.ARCHITECT_AGENT.idFromName('architect-agent:factory')
      const stub = env.ARCHITECT_AGENT.get(id)
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = subPath || '/'
      return stub.fetch(new Request(forwardUrl.toString(), request))
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
