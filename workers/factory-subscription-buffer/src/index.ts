/**
 * factory-subscription-buffer — CF Worker host
 *
 * Hosts the SubscriptionEventBufferDO Durable Object and provides an HTTP
 * proxy layer that authenticates external requests and routes them to the
 * correct DO instance by sessionId.
 *
 * Referenced as script_name: "factory-subscription-buffer" by factory-gateway
 * and factory-graphql workers.
 */

import { SubscriptionEventBufferDO } from '@factory/subscription-buffer'

export { SubscriptionEventBufferDO }

// ── Env ───────────────────────────────────────────────────────────────────────

interface Env {
  SUBSCRIPTION_EVENT_BUFFER: DurableObjectNamespace
  SUB_BUFFER_KV: KVNamespace
  SUB_BUFFER_PRODUCER_SECRET: SecretsStoreSecret
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth(req: Request, env: Env): Promise<Response | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const token = auth.slice('Bearer '.length)
  const secret = await env.SUB_BUFFER_PRODUCER_SECRET.get()
  if (token !== secret) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

// ── Route helper ──────────────────────────────────────────────────────────────

/**
 * Parse /buffer/:sessionId/<rest> from the request URL.
 * Returns null if the path does not match or sessionId is empty.
 */
function parseBufferPath(url: URL): { sessionId: string; rest: string } | null {
  // pathname starts with /buffer/
  const match = url.pathname.match(/^\/buffer\/([^/]+)(\/.*)?$/)
  if (!match) return null
  const sessionId = match[1]!
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null
  const rest = match[2] ?? '/'
  return { sessionId, rest }
}

// ── Proxy helpers ─────────────────────────────────────────────────────────────

function stubFor(env: Env, sessionId: string): DurableObjectStub {
  const id = env.SUBSCRIPTION_EVENT_BUFFER.idFromName('sub-buffer:' + sessionId)
  return env.SUBSCRIPTION_EVENT_BUFFER.get(id)
}

/**
 * Proxy a non-WebSocket request to the DO.
 * Reconstructs the URL as 'https://do' + doPath + search.
 */
async function proxyToDoHttp(
  stub: DurableObjectStub,
  req: Request,
  doPath: string,
  search: string,
): Promise<Response> {
  const doUrl = 'https://do' + doPath + search
  const doReq = new Request(doUrl, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  })
  return stub.fetch(doReq)
}

// ── Default export ────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // Health check — no auth required
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true })
    }

    // All /buffer/* routes
    if (url.pathname.startsWith('/buffer/')) {
      const authErr = await checkAuth(req, env)
      if (authErr) return authErr

      const parsed = parseBufferPath(url)
      if (!parsed) {
        return new Response(JSON.stringify({ error: 'missing sessionId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { sessionId, rest } = parsed
      const stub = stubFor(env, sessionId)
      const search = url.search  // preserves ?last_seq, ?streams, etc.

      // GET /buffer/:sessionId/head  → DO GET /head
      if (req.method === 'GET' && rest === '/head') {
        return proxyToDoHttp(stub, req, '/head', search)
      }

      // GET /buffer/:sessionId/meta  → DO GET /head  (observability alias)
      if (req.method === 'GET' && rest === '/meta') {
        return proxyToDoHttp(stub, req, '/head', search)
      }

      // GET /buffer/:sessionId/replay  → DO GET /replay  (preserve ?last_seq)
      if (req.method === 'GET' && rest === '/replay') {
        return proxyToDoHttp(stub, req, '/replay', search)
      }

      // GET /buffer/:sessionId/ws  → DO GET /ws  (WebSocket upgrade passthrough)
      // Reconstruct with normalized path so DO sees /ws, not /buffer/:sessionId/ws
      if (req.method === 'GET' && rest === '/ws') {
        return stub.fetch(new Request('https://do/ws' + search, req))
      }

      // POST /buffer/:sessionId/event  → DO POST /event
      if (req.method === 'POST' && rest === '/event') {
        return proxyToDoHttp(stub, req, '/event', search)
      }

      // POST /buffer/:sessionId/terminate  → DO POST /terminate
      if (req.method === 'POST' && rest === '/terminate') {
        return proxyToDoHttp(stub, req, '/terminate', search)
      }

      // Matched /buffer/:sessionId/* but no known sub-route
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Fallback 404
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
