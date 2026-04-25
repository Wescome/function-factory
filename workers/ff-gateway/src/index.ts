/**
 * @module ff-gateway
 *
 * The Factory's single public endpoint. All external requests enter here.
 * Routes to internal Workers (gates, query) via Service Bindings.
 * Protected by Cloudflare Access in production.
 *
 * Phase 2 routes:
 *   GET  /health           → system health
 *   GET  /specs/:collection/:key → spec lookup
 *   GET  /specs/:collection      → list specs
 *   GET  /lineage/:collection/:key → lineage traversal
 *   GET  /impact/:collection/:key  → impact analysis
 *   POST /gate/1           → Gate 1 evaluation
 *   GET  /gate-status/:gate/:id → gate status lookup
 *   GET  /trust/:id        → trust score
 *   GET  /crps/pending      → pending CRPs (ACE inbox)
 *   GET  /mrps/pending      → pending MRPs (ACE inbox)
 *   GET  /mentorscript      → active MentorScript rules
 *
 * Phase 3 routes:
 *   POST /pipeline          → trigger FactoryPipeline Workflow
 *   POST /approve/:id       → send approval event to paused Workflow
 *   GET  /pipeline/:id      → Workflow instance status
 *
 * Future phases add:
 *   POST /webhook/ci-result → CI feedback (Phase 7)
 */

import type { GatewayEnv } from './env'

// Re-export QueryService as named entrypoint for Service Binding
export { default as QueryService } from './query'

export default {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method
    const path = url.pathname

    try {
      // ── Health ──
      if (method === 'GET' && path === '/health') {
        const health = await env.QUERY.getSystemHealth()
        return json(health)
      }

      // ── Spec CRUD (read-only) ──
      if (method === 'GET' && path.startsWith('/specs/')) {
        const parts = path.slice('/specs/'.length).split('/')
        const collection = parts[0]
        const key = parts[1]

        if (!collection) return json({ error: 'Missing collection' }, 400)

        if (key) {
          const spec = await env.QUERY.getSpec(collection, key)
          if (!spec) return json({ error: 'Not found' }, 404)
          return json(spec)
        }

        // List with pagination
        const limit = parseInt(url.searchParams.get('limit') ?? '25')
        const offset = parseInt(url.searchParams.get('offset') ?? '0')
        const result = await env.QUERY.listSpecs(collection, { limit, offset })
        return json(result)
      }

      // ── Lineage ──
      if (method === 'GET' && path.startsWith('/lineage/')) {
        const parts = path.slice('/lineage/'.length).split('/')
        const collection = parts[0]
        const key = parts[1]
        if (!collection || !key) {
          return json({ error: 'Usage: /lineage/:collection/:key' }, 400)
        }
        const maxDepth = parseInt(url.searchParams.get('depth') ?? '10')
        const lineage = await env.QUERY.traceLineage(collection, key, maxDepth)
        return json({ startId: `${collection}/${key}`, lineage })
      }

      // ── Impact analysis ──
      if (method === 'GET' && path.startsWith('/impact/')) {
        const parts = path.slice('/impact/'.length).split('/')
        const collection = parts[0]
        const key = parts[1]
        if (!collection || !key) {
          return json({ error: 'Usage: /impact/:collection/:key' }, 400)
        }
        const maxDepth = parseInt(url.searchParams.get('depth') ?? '5')
        const impact = await env.QUERY.traceImpact(collection, key, maxDepth)
        return json({ startId: `${collection}/${key}`, impact })
      }

      // ── Gate 1 ──
      if (method === 'POST' && path === '/gate/1') {
        const workGraph = await request.json()
        const report = await env.GATES.evaluateGate1(workGraph)
        const status = report.passed ? 200 : 422
        return json(report, status)
      }

      // ── Gate status ──
      if (method === 'GET' && path.startsWith('/gate-status/')) {
        const parts = path.slice('/gate-status/'.length).split('/')
        const gate = parts[0]
        const id = parts[1]
        if (!gate || !id) {
          return json({ error: 'Usage: /gate-status/:gate/:artifactId' }, 400)
        }
        const status = await env.QUERY.getGateStatus(parseInt(gate), id)
        if (!status) return json({ error: 'Not found' }, 404)
        return json(status)
      }

      // ── Trust scores ──
      if (method === 'GET' && path.startsWith('/trust/')) {
        const id = path.slice('/trust/'.length)
        const score = await env.QUERY.getTrustScore(id)
        if (!score) return json({ error: 'Not found' }, 404)
        return json(score)
      }

      // ── SDLC artifacts (ACE inbox) ──
      if (method === 'GET' && path === '/crps/pending') {
        const crps = await env.QUERY.listPendingCRPs()
        return json({ items: crps, count: crps.length })
      }

      if (method === 'GET' && path === '/mrps/pending') {
        const mrps = await env.QUERY.listPendingMRPs()
        return json({ items: mrps, count: mrps.length })
      }

      if (method === 'GET' && path === '/mentorscript') {
        const rules = await env.QUERY.listMentorRules()
        return json({ items: rules, count: rules.length })
      }

      // ── Pipeline (Phase 3) ──

      if (method === 'POST' && path === '/pipeline') {
        const body = await request.json() as Record<string, unknown>
        if (!body.signal) {
          return json({ error: 'Missing "signal" field in request body' }, 400)
        }
        const instance = await env.PIPELINE.create({
          params: {
            signal: body.signal,
            dryRun: body.dryRun ?? false,
          },
        })
        return json({
          instanceId: instance.id,
          status: 'started',
          statusUrl: `/pipeline/${instance.id}`,
          approveUrl: `/approve/${instance.id}`,
        }, 201)
      }

      if (method === 'POST' && path.startsWith('/approve/')) {
        const instanceId = path.slice('/approve/'.length)
        if (!instanceId) {
          return json({ error: 'Missing instance ID' }, 400)
        }
        const body = await request.json() as Record<string, unknown>
        const decision = body.decision ?? 'approved'
        const reason = body.reason as string | undefined
        const by = request.headers.get('cf-access-authenticated-user-email')
          ?? body.by as string
          ?? 'unknown'
        const instance = await env.PIPELINE.get(instanceId)
        await instance.sendEvent('architect-approval', {
          payload: { decision, reason, by },
        })
        return json({ instanceId, event: 'architect-approval', decision, by })
      }

      if (method === 'GET' && path.startsWith('/pipeline/')) {
        const instanceId = path.slice('/pipeline/'.length)
        if (!instanceId) {
          return json({ error: 'Missing instance ID' }, 400)
        }
        const instance = await env.PIPELINE.get(instanceId)
        const status = await instance.status()
        return json(status)
      }

      // ── 404 ──
      return json({
        error: 'Not found',
        availableRoutes: [
          'GET  /health',
          'GET  /specs/:collection/:key',
          'GET  /specs/:collection',
          'GET  /lineage/:collection/:key',
          'GET  /impact/:collection/:key',
          'POST /gate/1',
          'GET  /gate-status/:gate/:id',
          'GET  /trust/:id',
          'GET  /crps/pending',
          'GET  /mrps/pending',
          'GET  /mentorscript',
          'POST /pipeline',
          'POST /approve/:id',
          'GET  /pipeline/:id',
        ],
      }, 404)

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error'
      console.error('Gateway error:', message)
      return json({ error: message }, 500)
    }
  },
}

// ── Helpers ──

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
