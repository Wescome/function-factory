/**
 * @factory/linear-sync — Worker entrypoint
 *
 * Cloudflare Worker. Routes incoming POST requests to the appropriate
 * projection handler. Label and state caches are populated once per
 * worker lifecycle (warm start) or on demand.
 *
 * Routes:
 *   POST /sync/atoms        — P1 atom projection (create) or P2 state sync (update)
 *   POST /sync/divergences  — P3 divergence projection
 *   POST /sync/health       — P4 health document upsert
 *   POST /sync/escalation   — escalation issue creation
 *   POST /sync/hypothesis   — add hypothesis comment to divergence issue
 *   POST /sync/divergence-closed — mark divergence Done + commit SHA comment
 *   GET  /health            — liveness check
 */

import type { Env } from './env.js'
import { LinearClient } from './linear-client.js'
import { logSyncError } from './error-log.js'
import { handleAtomSync } from './projections/p1-atom-sync.js'
import { handleTraceStateSync } from './projections/p2-trace-state.js'
import { handleDivergenceSync } from './projections/p3-divergence.js'
import { handleHealthSync } from './projections/p4-health-document.js'
import { handleEscalationSync } from './escalation-sync.js'
import type { AtomSyncRequest } from './projections/p1-atom-sync.js'
import type { TraceSyncRequest } from './projections/p2-trace-state.js'
import type { DivergenceSyncRequest } from './projections/p3-divergence.js'
import type { HealthSyncRequest } from './projections/p4-health-document.js'
import type { EscalationSyncRequest } from './escalation-sync.js'
import { getBinding, markBindingSynced } from './binding-store.js'

// ── Bootstrap cache ─────────────────────────────────────────────────────────

/**
 * Populate label and workflow-state caches from Linear.
 * Cached in FACTORY_LINEAR_KV; refreshed on cold start if KV misses.
 */
async function buildCaches(
  env: Env,
  client: LinearClient,
): Promise<{
  labelCache: Map<string, string>
  stateCache: Map<string, string>
}> {
  const labelCache = new Map<string, string>()
  const stateCache = new Map<string, string>()

  // Try KV first
  const kvLabels = await env.FACTORY_LINEAR_KV.get('__label_cache__', 'json') as Record<string, string> | null
  const kvStates = await env.FACTORY_LINEAR_KV.get('__state_cache__', 'json') as Record<string, string> | null

  if (kvLabels) {
    for (const [k, v] of Object.entries(kvLabels)) labelCache.set(k, v)
  } else {
    const labels = await client.getIssueLabels(env.LINEAR_TEAM_ID)
    for (const label of labels) labelCache.set(label.name, label.id)
    await env.FACTORY_LINEAR_KV.put('__label_cache__', JSON.stringify(Object.fromEntries(labelCache)), { expirationTtl: 3600 })
  }

  if (kvStates) {
    for (const [k, v] of Object.entries(kvStates)) stateCache.set(k, v)
  } else {
    const states = await client.getWorkflowStates(env.LINEAR_TEAM_ID)
    for (const state of states) stateCache.set(state.name, state.id)
    await env.FACTORY_LINEAR_KV.put('__state_cache__', JSON.stringify(Object.fromEntries(stateCache)), { expirationTtl: 3600 })
  }

  return { labelCache, stateCache }
}

// ── Hypothesis sync ────────────────────────────────────────────────────────

interface HypothesisSyncRequest {
  divergenceId: string
  hypothesisText: string
  hypothesisNodeId: string
}

async function handleHypothesisSync(
  req: HypothesisSyncRequest,
  env: Env,
  client: LinearClient,
): Promise<Response> {
  const binding = await getBinding(env.FACTORY_ARTIFACTS_DB, req.divergenceId)
  if (!binding) {
    return jsonResponse({ error: `No binding for divergenceId: ${req.divergenceId}` }, 404)
  }

  try {
    await client.commentCreate({
      issueId: binding.linear_issue_internal_id,
      body: `**Hypothesis** (\`${req.hypothesisNodeId}\`):\n\n${req.hypothesisText}`,
    })
    await markBindingSynced(env.FACTORY_ARTIFACTS_DB, req.divergenceId, 'ok')
    return jsonResponse({ ok: true })
  } catch (err) {
    await logSyncError(env.FACTORY_OPS_DB, {
      factoryArtifactId: req.divergenceId,
      errorType: 'hypothesis_comment_failed',
      errorDetail: String(err),
      endpoint: '/sync/hypothesis',
    })
    return jsonResponse({ error: String(err) }, 500)
  }
}

// ── Divergence-closed sync ─────────────────────────────────────────────────

interface DivergenceClosedRequest {
  divergenceId: string
  commitSha?: string
  resolution?: string
}

async function handleDivergenceClosed(
  req: DivergenceClosedRequest,
  env: Env,
  client: LinearClient,
  stateCache: Map<string, string>,
): Promise<Response> {
  const binding = await getBinding(env.FACTORY_ARTIFACTS_DB, req.divergenceId)
  if (!binding) {
    return jsonResponse({ error: `No binding for divergenceId: ${req.divergenceId}` }, 404)
  }

  try {
    const doneStateId = stateCache.get('Done')
    if (doneStateId) {
      await client.issueUpdate(binding.linear_issue_internal_id, { stateId: doneStateId })
    }

    if (req.commitSha) {
      await client.commentCreate({
        issueId: binding.linear_issue_internal_id,
        body: `Resolved by commit: \`${req.commitSha}\`${req.resolution ? `\n\n${req.resolution}` : ''}`,
      })
    }

    await markBindingSynced(env.FACTORY_ARTIFACTS_DB, req.divergenceId, 'ok')
    return jsonResponse({ ok: true })
  } catch (err) {
    await logSyncError(env.FACTORY_OPS_DB, {
      factoryArtifactId: req.divergenceId,
      errorType: 'divergence_close_failed',
      errorDetail: String(err),
      endpoint: '/sync/divergence-closed',
    })
    return jsonResponse({ error: String(err) }, 500)
  }
}

// ── Worker ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'GET' && path === '/health') {
      return jsonResponse({ ok: true, service: '@factory/linear-sync' })
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }

    const client = new LinearClient(env.LINEAR_API_KEY)
    const { labelCache, stateCache } = await buildCaches(env, client)

    try {
      switch (path) {
        case '/sync/atoms': {
          // Distinguish P1 (creation) from P2 (state update) by presence of `atoms` array
          const b = body as Record<string, unknown>
          if (Array.isArray(b['atoms'])) {
            // P1 — atom projection
            const result = await handleAtomSync(
              body as AtomSyncRequest,
              env,
              client,
              labelCache,
              stateCache,
            )
            return jsonResponse(result)
          } else {
            // P2 — trace state sync
            const result = await handleTraceStateSync(
              body as TraceSyncRequest,
              env,
              client,
              labelCache,
              stateCache,
            )
            return jsonResponse(result)
          }
        }

        case '/sync/divergences': {
          const result = await handleDivergenceSync(
            body as DivergenceSyncRequest,
            env,
            client,
            labelCache,
          )
          return jsonResponse(result)
        }

        case '/sync/health': {
          const result = await handleHealthSync(
            body as HealthSyncRequest,
            env,
            client,
            env.LINEAR_PROJECT_ID,
          )
          return jsonResponse(result)
        }

        case '/sync/escalation': {
          const result = await handleEscalationSync(
            body as EscalationSyncRequest,
            env,
            client,
            labelCache,
          )
          return jsonResponse(result)
        }

        case '/sync/hypothesis': {
          return handleHypothesisSync(
            body as HypothesisSyncRequest,
            env,
            client,
          )
        }

        case '/sync/divergence-closed': {
          return handleDivergenceClosed(
            body as DivergenceClosedRequest,
            env,
            client,
            stateCache,
          )
        }

        default:
          return jsonResponse({ error: `Unknown route: ${path}` }, 404)
      }
    } catch (err) {
      await logSyncError(env.FACTORY_OPS_DB, {
        errorType: 'unhandled_error',
        errorDetail: String(err),
        endpoint: path,
      }).catch(() => { /* best-effort */ })
      return jsonResponse({ error: 'Internal server error' }, 500)
    }
  },

  /**
   * Scheduled handler — midnight UTC cron triggers health history append.
   * Triggered by the wrangler cron schedule.
   */
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const client = new LinearClient(env.LINEAR_API_KEY)

    // Read the latest health snapshot from D1 and push to history doc
    const latest = await env.FACTORY_OPS_DB
      .prepare('SELECT payload_json FROM health_snapshots ORDER BY produced_at DESC LIMIT 1')
      .first<{ payload_json: string }>()

    if (!latest) return

    const req = JSON.parse(latest.payload_json) as HealthSyncRequest
    await handleHealthSync(req, env, client, env.LINEAR_PROJECT_ID, true)
  },
} satisfies ExportedHandler<Env>

// ── Util ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
