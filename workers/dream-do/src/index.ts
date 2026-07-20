/**
 * ff-dream — Worker entry point
 *
 * Exports DreamDO (the singleton PassTemplate manager) and a minimal
 * fetch handler for operator tooling (FF Terminal / ff CLI).
 *
 * Singleton key: env.DREAM_DO.idFromName('factory-singleton')
 *
 * GAP-013: DreamDO singleton
 */

export { DreamDO } from './dream-do.js'

interface Env {
  DREAM_DO: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // All operator routes are prefixed /dream/**
    const match = url.pathname.match(/^\/dream(.*)$/)
    if (!match) {
      return new Response('Not found', { status: 404 })
    }

    const id   = env.DREAM_DO.idFromName('factory-singleton')
    const stub = env.DREAM_DO.get(id)

    // Forward to the DO's HTTP handler
    const forwarded = new Request(request.url, request)
    return stub.fetch(forwarded)
  },
}
