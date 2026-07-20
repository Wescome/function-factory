export { MediationAgentDO } from '@factory/mediation-agent'

import type { Env as MediationDOEnv } from '@factory/mediation-agent'
type Env = MediationDOEnv & { MEDIATION_AGENT: DurableObjectNamespace }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(
        JSON.stringify({ worker: 'ff-mediation-agent', status: 'ok' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const match = url.pathname.match(/^\/agents\/mediation\/([^/]+)(\/.*)?$/)
    if (match) {
      const repoId = match[1]
      const subPath = match[2] ?? '/'
      const id = env.MEDIATION_AGENT.idFromName('mediation-agent:' + repoId)
      const stub = env.MEDIATION_AGENT.get(id)
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = subPath
      return stub.fetch(new Request(forwardUrl.toString(), request))
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
