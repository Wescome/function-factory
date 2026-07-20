export { FactoryPipeline } from './pipeline'
export { SynthesisCoordinator } from './coordinator'
export { validateCodeLanguage } from './coordinator/atom-executor'
export { AtomExecutor } from './coordinator/atom-executor-do'
export { RunCoordinator } from './coordinator/run-coordinator'
export { PiContainer } from './coordinator/pi-container'
export { Sandbox } from '@cloudflare/sandbox'

// KSP layer — @factory/gears + factory-graph DOs
export { CoordinatorDO, ThinkExecutor } from '@factory/gears'
export { FactoryArtifactGraphDO, FactoryBeadGraphDO } from '@factory/factory-graph'

export { ingestSignal } from './stages/ingest-signal'
export { generateFeedbackSignals } from './stages/generate-feedback'
export { generatePR } from './stages/generate-pr'
export { buildPROutcomeSignals, ingestPROutcomeSignals, normalizePROutcome } from './stages/pr-outcome-signal'
export { buildMergeReadinessPack, ingestMergeReadinessPack, toCanonicalMergeReadinessPack } from './merge-readiness-pack'
export { synthesizePressure } from './stages/synthesize-pressure'
export { mapCapability } from './stages/map-capability'
export { proposeFunction } from './stages/propose-function'
export { semanticReview } from './stages/semantic-review'
export { compileIntentSpecification, PASS_NAMES } from './stages/compile'

export { callModel } from './model-bridge'

export type {
  PipelineEnv,
  PipelineParams,
  PipelineResult,
  SignalInput,
  CoherenceVerificationReport,
  SemanticReviewResult,
} from './types'

export type {
  FeedbackContext,
  FeedbackSignal,
} from './stages/generate-feedback'

export type { ExtractionConfidence } from '@factory/file-context'

import type { PipelineEnv } from './types'
import { RunEventLog } from './observability/run-event-log'
import { queueHandler } from './queue-handler'
import { handleTriggerSynthesis } from './trigger-synthesis-handler'

function piContainerStub(env: PipelineEnv): DurableObjectStub | null {
  if (!env.PI_CONTAINER) return null
  return env.PI_CONTAINER.get(env.PI_CONTAINER.idFromName('pi'))
}

async function fetchPiContainerDiagnostic(
  env: PipelineEnv,
  path: '/__pi-container/status' | '/__pi-container/restart' | '/health' | '/__pi-container/fence',
  method: 'GET' | 'POST',
): Promise<Response> {
  const stub = piContainerStub(env)
  if (!stub) {
    return json({
      ok: false,
      error: 'PI_CONTAINER binding unavailable',
      timestamp: new Date().toISOString(),
    }, 503)
  }

  const response = await stub.fetch(new Request(`http://pi-container.local${path}`, { method }))
  const body = await response.text()
  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

// handlePiContainerExecute bridges a Gas City pi-rpc execution request to the PI
// container DO /execute endpoint (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-PI1/AC-PI4).
//
// The body may already be a WorkerInput (the Gas City Go provider applies the
// AC-PI1 field renames before posting) or an AC-RQ1 execution request envelope
// (snake_case). Either shape is accepted; the route normalizes to WorkerInput so
// the DO sees runId/stageName at the top level (readRunRequestMeta requires
// them). The container response is returned verbatim for Gas City to decompose
// into its response envelope (AC-PI2). No molecule verdict is produced here:
// providers report execution status only (AC-RS2).
async function handlePiContainerExecute(request: Request, env: PipelineEnv): Promise<Response> {
  const auth = authorizeOperatorControl(request, env)
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status === 403 ? 403 : auth.status)
  }

  const stub = piContainerStub(env)
  if (!stub) {
    return json({
      error: { code: 'PI_CONTAINER_UNAVAILABLE', message: 'PI_CONTAINER binding unavailable' },
      timestamp: new Date().toISOString(),
    }, 503)
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonRecord(request)
  } catch {
    return json({ error: { code: 'INVALID_REQUEST', message: 'request body must be JSON' } }, 400)
  }

  const { normalizePiContainerExecuteInput } = await import('./gascity/pi-container-execute.js')
  const workerInput = normalizePiContainerExecuteInput(body)
  if (!workerInput) {
    return json({
      error: { code: 'INVALID_REQUEST', message: 'execution request must carry a step/stage name and session/run id' },
    }, 422)
  }

  const response = await stub.fetch(new Request('http://pi-container.local/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workerInput),
  }))
  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

export default {
  async fetch(request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // ── Diagnostic: deployment/version metadata ──
    if (url.pathname === '/version' && request.method === 'GET') {
      return json({
        service: 'ff-pipeline',
        version: '0.1.0',
        environment: env.ENVIRONMENT,
        workerVersion: env.CF_VERSION_METADATA ?? null,
        timestamp: new Date().toISOString(),
      })
    }

    // ── Diagnostic: lightweight health check ──
    if (url.pathname === '/debug/health' && request.method === 'GET') {
      const arango = await checkArango(env)
      return json({
        service: 'ff-pipeline',
        status: arango ? 'healthy' : 'degraded',
        arango,
        aiBinding: !!env.AI,
        environment: env.ENVIRONMENT,
        timestamp: new Date().toISOString(),
      }, arango ? 200 : 503)
    }

    if (url.pathname === '/gascity/autonomy/status' && request.method === 'GET') {
      const { getGasCityAutonomyStatus } = await import('./gascity/autonomy-monitor.js')
      return json(await getGasCityAutonomyStatus(env))
    }

    if (url.pathname === '/gascity/telemetry/status' && request.method === 'GET') {
      const sinkConfigured = Boolean(env.FACTORY_METRICS)
      const queueConfigured = Boolean(env.TELEMETRY_QUEUE)
      const ok = sinkConfigured && queueConfigured
      return json({
        ok,
        queue: { telemetry_queue_bound: queueConfigured },
        sinks: {
          analytics_engine_bound: Boolean(env.FACTORY_METRICS),
        },
        timestamp: new Date().toISOString(),
      }, ok ? 200 : 503)
    }

    if (url.pathname === '/internal/do-health' && request.method === 'GET') {
      const auth = authorizeOperatorControl(request, env)
      if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 401 : auth.status)
      const { createClientFromEnv } = await import('@factory/db-client')
      const db = createClientFromEnv(env)
      const id = `SMOKE-ARANGO-HEALTH-${Date.now()}`
      await db.ensureCollection('memory_entries')
      await db.save('memory_entries', {
        _key: id,
        id,
        kind: 'arango-health-check',
        payload: { source_ref: 'internal', reason: 'smoke' },
        agent_id: 'ff-pipeline',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      const readBack = await db.get<Record<string, unknown>>('memory_entries', id)
      if (!readBack) return json({ ok: false, round_trip: 'fail', id }, 500)
      return json({ ok: true, round_trip: 'pass', id, store: 'arango' })
    }

    if (url.pathname === '/gascity/autonomy/run' && request.method === 'POST') {
      const auth = authorizeOperatorControl(request, env)
      if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 401 : auth.status)
      const body: Record<string, unknown> = await readJsonRecord(request).catch(() => ({}))
      const trigger = cleanString(body.trigger, '') === 'smoke' ? 'smoke' : 'manual'
      const { runGasCityAutonomyMonitor } = await import('./gascity/autonomy-monitor.js')
      try {
        return json(await runGasCityAutonomyMonitor(env, trigger), 202)
      } catch (err) {
        return json({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }, 500)
      }
    }

    // ── Admin: create/repair database + collections ──
    if (url.pathname === '/admin/init-db' && request.method === 'POST') {
      const auth = authorizeOperatorControl(request, env)
      if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 401 : auth.status)
      return handleInitDb(env)
    }

    // ── Diagnostic: Arango connectivity without credential exposure ──
    if (url.pathname === '/debug/arango' && request.method === 'GET') {
      const ok = await checkArango(env)
      return json({
        ok,
        status: ok ? 'healthy' : 'degraded',
        database: env.ARANGO_DATABASE,
        timestamp: new Date().toISOString(),
      }, ok ? 200 : 503)
    }

    // ── Diagnostic: Workers AI binding smoke test ──
    if (url.pathname === '/debug/ai-test' && request.method === 'GET') {
      if (!env.AI) {
        return json({
          ok: false,
          aiBinding: false,
          error: 'Workers AI binding unavailable',
          timestamp: new Date().toISOString(),
        }, 503)
      }

      const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
      try {
        const result = await env.AI.run(model, {
          messages: [
            { role: 'system', content: 'Return a tiny JSON object only.' },
            { role: 'user', content: '{"ping":true}' },
          ],
          max_tokens: 32,
          response_format: { type: 'json_object' },
        })
        const response = result.response
        return json({
          ok: true,
          aiBinding: true,
          model,
          responseType: typeof response,
          responseLength: typeof response === 'string' ? response.length : JSON.stringify(response).length,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        return json({
          ok: false,
          aiBinding: true,
          model,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }, 502)
      }
    }

    // ── Diagnostic: Pi singleton Container rollout/readiness state ──
    if (url.pathname === '/debug/pi-container/status' && request.method === 'GET') {
      return fetchPiContainerDiagnostic(env, '/__pi-container/status', 'GET')
    }

    if (url.pathname === '/debug/pi-container/health' && request.method === 'GET') {
      return fetchPiContainerDiagnostic(env, '/health', 'GET')
    }

    if (url.pathname === '/debug/pi-container/restart' && request.method === 'POST') {
      return fetchPiContainerDiagnostic(env, '/__pi-container/restart', 'POST')
    }

    if (url.pathname === '/smoke/e2e' && request.method === 'POST') {
      const { handleSmokeE2E } = await import('./smoke/smoke-e2e-handler.js')
      return handleSmokeE2E(request, env)
    }

    // KSP integration tests — Phase 8 steps 50–52
    if (url.pathname === '/ksp/test/loop' && request.method === 'POST') {
      const { handleKspLoopTest } = await import('./ksp-loop-test.js')
      return handleKspLoopTest(request, env)
    }

    if (url.pathname === '/ksp/test/fail-closed' && request.method === 'GET') {
      const { handleKspFailClosedTest } = await import('./ksp-loop-test.js')
      return handleKspFailClosedTest(request, env)
    }

    if (url.pathname.startsWith('/run-status/') && request.method === 'GET') {
      if (!env.WORKSPACE_BUCKET) {
        return json({ error: 'WORKSPACE_BUCKET binding unavailable' }, 503)
      }
      const runId = decodeURIComponent(url.pathname.slice('/run-status/'.length))
      if (!runId) return json({ error: 'missing runId' }, 400)
      const log = new RunEventLog(env.WORKSPACE_BUCKET as R2Bucket)
      if (url.searchParams.has('logs')) {
        const stageName = url.searchParams.get('logs') ?? ''
        if (!stageName) return json({ error: 'missing logs stage name' }, 400)
        const latest = await log.getLatestAttemptLog(runId, stageName)
        if (!latest) return json({ error: 'attempt log not found', runId, stageName }, 404)
        return new Response(latest.text, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Run-Log-Key': latest.key,
          },
        })
      }
      const summary = await log.getSummary(runId)
      if (!summary) return json({ error: 'run summary not found', runId }, 404)
      if (url.searchParams.get('events') === 'true') {
        const events = await log.getRecentEvents(runId, 20)
        return json({ summary, events })
      }
      return json(summary)
    }

    if (url.pathname.startsWith('/run-monitor/') && request.method === 'GET') {
      if (!env.WORKSPACE_BUCKET) {
        return json({ error: 'WORKSPACE_BUCKET binding unavailable' }, 503)
      }
      const runId = decodeURIComponent(url.pathname.slice('/run-monitor/'.length))
      if (!runId) return json({ error: 'missing runId' }, 400)
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const eventLimit = Number.isFinite(limit) ? Math.max(1, Math.min(250, Math.trunc(limit))) : 50
      const log = new RunEventLog(env.WORKSPACE_BUCKET as R2Bucket)
      const snapshot = await log.getMonitorSnapshot(runId, eventLimit)
      if (!snapshot) return json({ error: 'run monitor snapshot not found', runId }, 404)
      return json(snapshot)
    }

    if (url.pathname.startsWith('/run-interventions/') && request.method === 'POST') {
      return handleRunIntervention(request, env, url)
    }

    if (url.pathname.startsWith('/run-artifacts/') && request.method === 'GET') {
      if (!env.WORKSPACE_BUCKET) {
        return json({ error: 'WORKSPACE_BUCKET binding unavailable' }, 503)
      }
      const runId = decodeURIComponent(url.pathname.slice('/run-artifacts/'.length))
      if (!runId) return json({ error: 'missing runId' }, 400)
      const log = new RunEventLog(env.WORKSPACE_BUCKET as R2Bucket)
      const manifest = await log.getManifest(runId)
      if (!manifest) return json({ error: 'run artifact manifest not found', runId }, 404)
      return json(manifest)
    }

    // ── Synthesis trigger: external route that bridges Workflow <-> DO ──
    if (url.pathname === '/trigger-synthesis' && request.method === 'POST') {
      // Route body lives in ./trigger-synthesis-handler so it can be unit-tested
      // without importing this barrel (which re-exports DO classes that statically
      // pull in cloudflare:* protocol modules). See trigger-synthesis-handler.ts.
      return handleTriggerSynthesis(request, env, ctx)
    }

    // ── Synthesis callback: DO calls back when synthesis completes ──
    if (url.pathname === '/synthesis-callback' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          workflowId: string
          verdict: { decision: string; confidence: number; reason: string }
          tokenUsage: number
          repairCount: number
        }

        if (!body.workflowId) {
          return new Response(JSON.stringify({ error: 'Missing workflowId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const workflow = await env.FACTORY_PIPELINE.get(body.workflowId)
        await workflow.sendEvent({
          type: 'synthesis-complete',
          payload: {
            verdict: body.verdict,
            tokenUsage: body.tokenUsage,
            repairCount: body.repairCount,
          },
        })

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[Agent Call execution] /synthesis-callback error: ${errorMessage}`)
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Diagnostic: verify GITHUB_TOKEN from Worker's perspective ──
    if (url.pathname === '/debug/github-token' && request.method === 'GET') {
      const hasToken = !!env.GITHUB_TOKEN
      const tokenLength = env.GITHUB_TOKEN?.length ?? 0
      try {
        const res = await fetch('https://api.github.com/repos/Wescome/function-factory', {
          headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'ff-pipeline',
          },
        })
        return new Response(JSON.stringify({
          hasToken,
          tokenLength,
          githubStatus: res.status,
          githubOk: res.ok,
        }), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          hasToken,
          tokenLength,
          error: err instanceof Error ? err.message : String(err),
        }), { headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: Governor cycle status ──
    if (url.pathname === '/debug/governor' && request.method === 'GET') {
      try {
        const { createClientFromEnv } = await import('@factory/db-client')
        const db = createClientFromEnv(env)
        const assessments = await db.query<{ json: string }>(
          `SELECT json FROM documents WHERE collection='orientation_assessments' ORDER BY json_extract(json,'$.generated_at') DESC LIMIT 5`,
        ).then(rows => rows.map(r => {
          const d = JSON.parse(r.json) as Record<string, unknown>
          return { id: d._key, type: d.assessment_type, generated_at: d.generated_at, decisions: Array.isArray(d.decisions) ? d.decisions.length : 0, actions_taken: d.actions_taken }
        })).catch(() => [] as Record<string, unknown>[])
        const telemetry = await db.query<{ json: string }>(
          `SELECT json FROM documents WHERE collection='orl_telemetry' AND (json_extract(json,'$.schemaName')='GovernorAssessment' OR json_extract(json,'$.schemaName')='GovernanceCycleResult' OR json_extract(json,'$.schemaName')='_governance_cycle') ORDER BY json_extract(json,'$.timestamp') DESC LIMIT 5`,
        ).then(rows => rows.map(r => {
          const t = JSON.parse(r.json) as Record<string, unknown>
          return { timestamp: t.timestamp, success: t.success, failureMode: t.failureMode, schema: t.schemaName, verdict: t.verdict, operationalHealth: t.operationalHealth, trend: t.trend, error: t.error }
        })).catch(() => [] as Record<string, unknown>[])
        return new Response(JSON.stringify({ assessments, telemetry, cycleCount: assessments.length }, null, 2), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: Crystallizer observability — anchors, probes, drift ──
    if (url.pathname === '/debug/crystallizer' && request.method === 'GET') {
      try {
        const { createClientFromEnv } = await import('@factory/db-client')
        const db = createClientFromEnv(env)
        const signalId = url.searchParams.get('signal') ?? undefined

        const anchors = await (signalId
          ? db.query<{ json: string }>(
              `SELECT json FROM documents WHERE collection='intent_anchors' AND json_extract(json,'$.signal_id')=?`,
              [signalId],
            )
          : db.query<{ json: string }>(
              `SELECT json FROM documents WHERE collection='intent_anchors' ORDER BY key DESC LIMIT 20`,
            )
        ).then(rows => rows.map(r => JSON.parse(r.json) as Record<string, unknown>)).catch(() => [] as Record<string, unknown>[])

        const drift = await (signalId
          ? db.query<{ json: string }>(
              `SELECT json FROM documents WHERE collection='compilation_drift_ledger' AND json_extract(json,'$.signal_id')=? ORDER BY json_extract(json,'$.timestamp') DESC`,
              [signalId],
            ).then(rows => rows.map(r => {
              const d = JSON.parse(r.json) as Record<string, unknown>
              const probeResults = Array.isArray(d.probe_results) ? d.probe_results as Record<string, unknown>[] : []
              return { pass: d.pass_name, verdict: d.gate_verdict, remediations: d.remediation_count, violations: probeResults.filter(p => p.is_violation).length, anchors_probed: Array.isArray(d.anchors_probed) ? d.anchors_probed.length : 0, latency_ms: d.latency_ms, timestamp: d.timestamp, probe_results: d.probe_results }
            }))
          : db.query<{ json: string }>(
              `SELECT json FROM documents WHERE collection='compilation_drift_ledger' ORDER BY json_extract(json,'$.timestamp') DESC LIMIT 20`,
            ).then(rows => rows.map(r => {
              const d = JSON.parse(r.json) as Record<string, unknown>
              const probeResults = Array.isArray(d.probe_results) ? d.probe_results as Record<string, unknown>[] : []
              return { signal: d.signal_id, pass: d.pass_name, verdict: d.gate_verdict, remediations: d.remediation_count, violations: probeResults.filter(p => p.is_violation).length, timestamp: d.timestamp }
            }))
        ).catch(() => [] as Record<string, unknown>[])

        return new Response(JSON.stringify({ anchors, drift, query: { signalId } }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Diagnostic: manually trigger PR from a pipeline result ──
    if (url.pathname === '/debug/generate-pr' && request.method === 'POST') {
      try {
        const body = await request.json() as { pipelineId: string }
        if (!body.pipelineId || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
          return new Response(JSON.stringify({ error: 'Need pipelineId, GITHUB_APP_ID, and GITHUB_APP_PRIVATE_KEY' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        const workflow = await env.FACTORY_PIPELINE.get(body.pipelineId)
        const status = await workflow.status()
        const output = (status as any).output as Record<string, unknown> | null
        if (!output?.atomResults) {
          return new Response(JSON.stringify({ error: 'No atomResults in pipeline output', status: (status as any).status }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        const { generatePR } = await import('./stages/generate-pr.js')
        const result = await generatePR(
          {
            runId: body.pipelineId,
            signalTitle: `PR from pipeline ${body.pipelineId}`,
            proposalId: output.proposalId as string ?? 'unknown',
            executableSpecificationId: output.executableSpecificationId as string ?? 'unknown',
            atomResults: (output.atomResults ?? {}) as any,
            sourceRefs: [],
            confidence: (output.synthesisResult as any)?.verdict?.confidence ?? 0,
            ...(output.issueContract || output.issueContractArtifact ? { issueContract: (output.issueContract ?? output.issueContractArtifact) as { targetRepo?: string } } : {}),
          },
          env,
        )
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: read latest persisted Factory PR outcome signal ──
    if (url.pathname === '/debug/pr-outcome' && request.method === 'GET') {
      try {
        const pullNumber = Number(url.searchParams.get('pullNumber') ?? '')
        const executableSpecificationId = url.searchParams.get('executableSpecificationId') ?? ''
        if (!Number.isInteger(pullNumber) || pullNumber <= 0 || !executableSpecificationId) {
          return new Response(JSON.stringify({
            error: 'Missing required query params: pullNumber, executableSpecificationId',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/db-client')
        const db = createClientFromEnv(env)
        const rows = await db.query<{ json: string }>(
          `SELECT json FROM documents WHERE collection='specs_signals' AND json_extract(json,'$.source')='factory:pr-outcome' AND json_extract(json,'$.subtype') LIKE 'synthesis:pr-%' AND json_extract(json,'$.raw.pr.number')=? AND json_extract(json,'$.raw.executableSpecificationId')=? ORDER BY json_extract(json,'$.createdAt') DESC LIMIT 1`,
          [pullNumber, executableSpecificationId],
        )
        const signal = rows[0] ? JSON.parse(rows[0].json) as Record<string, unknown> : null
        return new Response(JSON.stringify({
          found: signal !== null,
          signal,
        }, null, 2), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: enqueue Factory PR outcome observation ──
    if (url.pathname === '/debug/pr-outcome' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          pullNumber?: number
          processNow?: boolean
          outcome?: import('./stages/pr-outcome-signal').PROutcomeInput
          lineage?: {
            pipelineId?: string
            signalId?: string
            pressureId?: string
            capabilityId?: string
            proposalId?: string
            executableSpecificationId?: string
          }
        }

        const lineage = body.lineage
          ? {
              pipelineId: body.lineage.pipelineId ?? '',
              ...(body.lineage.signalId ? { signalId: body.lineage.signalId } : {}),
              ...(body.lineage.pressureId ? { pressureId: body.lineage.pressureId } : {}),
              ...(body.lineage.capabilityId ? { capabilityId: body.lineage.capabilityId } : {}),
              proposalId: body.lineage.proposalId ?? '',
              executableSpecificationId: body.lineage.executableSpecificationId ?? '',
            }
          : undefined

        if (body.processNow === true) {
          const { createClientFromEnv } = await import('@factory/db-client')
          const { fetchPROutcomeFromGitHub, ingestPROutcomeSignals } = await import('./stages/pr-outcome-signal.js')

          const outcome = body.outcome ?? await (async () => {
            if (!body.pullNumber || !lineage?.pipelineId || !lineage.proposalId || !lineage.executableSpecificationId) {
              throw new Error('Missing required fields: pullNumber, lineage.pipelineId, lineage.proposalId, lineage.executableSpecificationId')
            }
            if (!env.GITHUB_TOKEN) {
              throw new Error('GITHUB_TOKEN binding unavailable')
            }
            return fetchPROutcomeFromGitHub({
              githubToken: env.GITHUB_TOKEN,
              repoOwner: 'Wescome',
              repoName: 'function-factory',
              pullNumber: body.pullNumber,
              lineage,
            })
          })()

          const db = createClientFromEnv(env)
          const records = await ingestPROutcomeSignals(outcome, db as never)
          return new Response(JSON.stringify({
            accepted: true,
            processed: true,
            pullNumber: outcome.pullRequest.number,
            executableSpecificationId: outcome.lineage.executableSpecificationId,
            records,
          }), { headers: { 'Content-Type': 'application/json' } })
        }

        if (!body.pullNumber || !body.lineage?.pipelineId || !body.lineage.proposalId || !body.lineage.executableSpecificationId) {
          return new Response(JSON.stringify({
            error: 'Missing required fields: pullNumber, lineage.pipelineId, lineage.proposalId, lineage.executableSpecificationId',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        if (!env.FEEDBACK_QUEUE) {
          return new Response(JSON.stringify({
            error: 'FEEDBACK_QUEUE binding unavailable',
          }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        }

        await env.FEEDBACK_QUEUE.send({
          type: 'pr-outcome',
          pullNumber: body.pullNumber,
          lineage: lineage!,
        })

        return new Response(JSON.stringify({
          accepted: true,
          pullNumber: body.pullNumber,
          executableSpecificationId: lineage!.executableSpecificationId,
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: scan known Factory PRs and enqueue outcome observations ──
    if (url.pathname === '/debug/pr-outcome-scan' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({})) as { limit?: number }
        const limit = Number.isInteger(body.limit) && body.limit! > 0
          ? Math.min(body.limit!, 50)
          : 10

        if (!env.FEEDBACK_QUEUE) {
          return new Response(JSON.stringify({
            error: 'FEEDBACK_QUEUE binding unavailable',
          }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/db-client')
        const db = createClientFromEnv(env)
        const rows = await db.query<{ json: string }>(
          `SELECT json FROM documents WHERE collection='specs_signals' AND json_extract(json,'$.source')='factory:pr-outcome' AND json_extract(json,'$.subtype') LIKE 'synthesis:pr-%' AND json_extract(json,'$.raw.pr.number') IS NOT NULL AND json_extract(json,'$.raw.pr.state')='OPEN' AND (json_extract(json,'$.raw.pr.merged') IS NULL OR json_extract(json,'$.raw.pr.merged')!=1) AND json_extract(json,'$.raw.pipelineId') IS NOT NULL AND json_extract(json,'$.raw.proposalId') IS NOT NULL AND json_extract(json,'$.raw.executableSpecificationId') IS NOT NULL AND key IN (SELECT key FROM documents WHERE collection='specs_signals' GROUP BY json_extract(json,'$.raw.pr.number') HAVING key=MAX(key)) ORDER BY json_extract(json,'$.createdAt') DESC LIMIT ?`,
          [limit],
        ).then(rows => rows.map(r => JSON.parse(r.json) as Record<string, unknown>))

        const candidates: Array<{ pullNumber: number; executableSpecificationId: string; lastSignalKey: string }> = []
        const skipped: Array<{ lastSignalKey: string; reason: string }> = []
        for (const row of rows) {
          const raw = row.raw as Record<string, unknown> | undefined
          const pr = raw?.pr as Record<string, unknown> | undefined
          const sourceRefs = Array.isArray(row.sourceRefs) ? row.sourceRefs.filter((ref): ref is string => typeof ref === 'string') : []
          const pullNumber = pr?.number
          const pipelineId = raw?.pipelineId
          const proposalId = raw?.proposalId
          const executableSpecificationId = raw?.executableSpecificationId
          const lastSignalKey = typeof row._key === 'string' ? row._key : 'unknown'

          if (
            typeof pullNumber !== 'number'
            || typeof pipelineId !== 'string'
            || typeof proposalId !== 'string'
            || typeof executableSpecificationId !== 'string'
          ) {
            skipped.push({ lastSignalKey, reason: 'missing required lineage or pullNumber' })
            continue
          }

          const idFromRefs = (prefix: string) => sourceRefs
            .find(ref => ref.startsWith(`${prefix}:`))
            ?.slice(prefix.length + 1)

          const lineage = {
            pipelineId,
            ...(idFromRefs('SIG') ? { signalId: idFromRefs('SIG') } : {}),
            ...(idFromRefs('PRS') ? { pressureId: idFromRefs('PRS') } : {}),
            ...(idFromRefs('BC') ? { capabilityId: idFromRefs('BC') } : {}),
            proposalId,
            executableSpecificationId,
          }

          await env.FEEDBACK_QUEUE.send({
            type: 'pr-outcome',
            pullNumber,
            lineage,
          })
          candidates.push({ pullNumber, executableSpecificationId, lastSignalKey })
        }

        return new Response(JSON.stringify({
          accepted: true,
          scanned: rows.length,
          enqueued: candidates.length,
          candidates,
          skipped,
        }, null, 2), { status: 202, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: pure Fidelity Verification evaluator ──
    if (url.pathname === '/debug/fidelity-verification' && request.method === 'POST') {
      return json({
        error: 'removed',
        reason: 'Synthesis-era Fidelity Verification was removed; Gas City fidelity is handled by POST /webhooks/gascity.',
      }, 410)
    }

    // ── Diagnostic: minimal Persistence Verification registration report ──
    if ((url.pathname === '/debug/persistence-verification' || url.pathname === '/debug/persistence-verification') && request.method === 'POST') {
      return json({
        error: 'removed',
        reason: 'Synthesis-era Persistence Verification registration is quarantined until a Gas City detector exists.',
      }, 410)
    }

    // ── Diagnostic: guarded lifecycle acceptance from persisted Fidelity Verification evidence ──
    if (url.pathname === '/debug/lifecycle-acceptance' && request.method === 'POST') {
      return json({
        error: 'removed',
        reason: 'Synthesis-era lifecycle acceptance was removed; Gas City lifecycle transitions are driven by POST /webhooks/gascity.',
      }, 410)
    }

    // ── Diagnostic: read-only FP -> FN identity split report ──
    if (url.pathname === '/debug/function-identity' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          proposalKey?: unknown
          functionId?: unknown
          mergeReadinessPackId?: unknown
        }
        if (typeof body.proposalKey !== 'string' || body.proposalKey.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: proposalKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (typeof body.functionId !== 'string' || body.functionId.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: functionId',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const proposalKey = body.proposalKey.trim()
        const functionId = body.functionId.trim()
        const mergeReadinessPackId = typeof body.mergeReadinessPackId === 'string' && body.mergeReadinessPackId.trim().length > 0
          ? body.mergeReadinessPackId.trim()
          : undefined
        const { createClientFromEnv } = await import('@factory/db-client')
        const { evaluateFunctionIdentity } = await import('./function-identity.js')
        const db = createClientFromEnv(env)
        const proposalDocument = await db.get<Record<string, unknown>>('specs_functions', proposalKey)
        const functionDocument = await db.get<Record<string, unknown>>('specs_functions', functionId)
        const mergeReadinessPack = mergeReadinessPackId
          ? await db.queryOne<{ json: string }>(
            `SELECT json FROM documents WHERE collection='merge_readiness_packs' AND (key=? OR json_extract(json,'$.id')=?) LIMIT 1`,
            [mergeReadinessPackId, mergeReadinessPackId],
          ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
          : null

        const report = evaluateFunctionIdentity({
          proposalKey,
          functionId,
          proposalDocument,
          functionDocument,
          mergeReadinessPack,
        })

        return new Response(JSON.stringify(report, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: guarded FP -> FN runtime materialization ──
    if (url.pathname === '/debug/function-identity-migration' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          proposalKey?: unknown
          functionId?: unknown
          mergeReadinessPackId?: unknown
          apply?: unknown
        }
        if (typeof body.proposalKey !== 'string' || body.proposalKey.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: proposalKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (typeof body.functionId !== 'string' || body.functionId.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: functionId',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const proposalKey = body.proposalKey.trim()
        const functionId = body.functionId.trim()
        const apply = body.apply === true
        const mergeReadinessPackId = typeof body.mergeReadinessPackId === 'string' && body.mergeReadinessPackId.trim().length > 0
          ? body.mergeReadinessPackId.trim()
          : undefined
        const { createClientFromEnv } = await import('@factory/db-client')
        const { evaluateFunctionIdentity } = await import('./function-identity.js')
        const db = createClientFromEnv(env)
        const proposalDocument = await db.get<Record<string, unknown>>('specs_functions', proposalKey)
        const functionDocument = await db.get<Record<string, unknown>>('specs_functions', functionId)
        const mergeReadinessPack = mergeReadinessPackId
          ? await db.queryOne<{ json: string }>(
            `SELECT json FROM documents WHERE collection='merge_readiness_packs' AND (key=? OR json_extract(json,'$.id')=?) LIMIT 1`,
            [mergeReadinessPackId, mergeReadinessPackId],
          ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
          : null

        const report = evaluateFunctionIdentity({
          proposalKey,
          functionId,
          proposalDocument,
          functionDocument,
          mergeReadinessPack,
        })

        if (!apply) {
          return new Response(JSON.stringify({
            applied: false,
            report,
          }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        if (!report.migrationPlan.safeToApply) {
          return new Response(JSON.stringify({
            error: 'Function identity migration is not safe to apply',
            applied: false,
            report,
          }, null, 2), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        if (!report.migrationPlan.required) {
          return new Response(JSON.stringify({
            applied: false,
            reason: 'Function identity migration is not required',
            report,
          }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        const createOperation = report.migrationPlan.operations.find((operation) => operation.action === 'create_function_document')
        if (!createOperation?.fields) {
          return new Response(JSON.stringify({
            error: 'Function identity migration plan does not include a create_function_document operation',
            applied: false,
            report,
          }, null, 2), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const appliedAt = new Date().toISOString()
        const functionRecord = {
          ...createOperation.fields,
          source_refs: [proposalKey],
          materializedFrom: proposalKey,
          materializedAt: appliedAt,
          migrationAppliedBy: 'ff-pipeline:debug-function-identity-migration',
        }
        await db.ensureCollection('specs_functions')
        await db.save('specs_functions', functionRecord)
        const lineageEdge = {
          type: 'materialized-from',
          createdAt: appliedAt,
          operation: 'create_function_document',
          responsible_context: 'ff-pipeline:debug-function-identity-migration',
        }
        await db.saveEdge(
          'lineage_edges',
          `specs_functions/${functionId}`,
          `specs_functions/${proposalKey}`,
          lineageEdge,
        )

        return new Response(JSON.stringify({
          applied: true,
          report,
          functionRecord,
          lineageEdge,
        }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: assemble MRP from latest persisted PR outcome ──
    if (url.pathname === '/debug/mrp-auto' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          audit?: unknown
          pullNumber?: unknown
          canonicalEvidenceKey?: unknown
          fidelityVerificationReportKey?: unknown
          createdAt?: string
        }

        if (!body.audit || typeof body.audit !== 'object') {
          return new Response(JSON.stringify({
            error: 'Missing required field: audit',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (!Number.isInteger(body.pullNumber) || (body.pullNumber as number) <= 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: pullNumber',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (typeof body.canonicalEvidenceKey !== 'string' || body.canonicalEvidenceKey.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: canonicalEvidenceKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const audit = body.audit as import('./merge-readiness-pack').SynthesisMaterializationAudit
        const executableSpecificationId = audit.executableSpecificationId
        if (typeof executableSpecificationId !== 'string' || executableSpecificationId.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'audit.executableSpecificationId is required',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/db-client')
        const {
          buildMergeReadinessPack,
          ingestMergeReadinessPack,
          toCanonicalMergeReadinessPack,
          withFidelityVerificationReportEvidence,
        } = await import('./merge-readiness-pack.js')
        const db = createClientFromEnv(env)
        const prOutcomeSignals = await db.query<{ json: string }>(
          `SELECT json FROM documents WHERE collection='specs_signals' AND json_extract(json,'$.source')='factory:pr-outcome' AND json_extract(json,'$.subtype') LIKE 'synthesis:pr-%' AND json_extract(json,'$.raw.pr.number')=? AND json_extract(json,'$.raw.executableSpecificationId')=? ORDER BY json_extract(json,'$.raw.observedAt') DESC, json_extract(json,'$.createdAt') DESC LIMIT 1`,
          [body.pullNumber, executableSpecificationId],
        )
        const prOutcomeSignal = prOutcomeSignals[0] ? JSON.parse(prOutcomeSignals[0].json) as Record<string, unknown> : null
        if (!prOutcomeSignal) {
          return new Response(JSON.stringify({
            error: `PR outcome signal not found for PR #${body.pullNumber} and ${executableSpecificationId}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }

        const evidenceKey = body.canonicalEvidenceKey.trim()
        const canonicalEvidenceRecord = await db.queryOne<{ json: string }>(
          `SELECT json FROM documents WHERE collection='merge_readiness_evidence' AND (key=? OR json_extract(json,'$.id')=?) LIMIT 1`,
          [evidenceKey, evidenceKey],
        ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
        if (!canonicalEvidenceRecord) {
          return new Response(JSON.stringify({
            error: `Canonical MRP evidence not found: ${evidenceKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        const fidelityVerificationReportKey = typeof body.fidelityVerificationReportKey === 'string' && body.fidelityVerificationReportKey.trim().length > 0
          ? body.fidelityVerificationReportKey.trim()
          : undefined
        const fidelityVerificationReportRecord = fidelityVerificationReportKey
          ? await db.queryOne<{ json: string }>(
            `SELECT json FROM documents WHERE collection='verification_reports' AND (key=? OR json_extract(json,'$.id')=?) LIMIT 1`,
            [fidelityVerificationReportKey, fidelityVerificationReportKey],
          ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
          : null
        if (fidelityVerificationReportKey && !fidelityVerificationReportRecord) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report not found: ${fidelityVerificationReportKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (fidelityVerificationReportKey && (fidelityVerificationReportRecord?.type !== 'fidelity-verification' || fidelityVerificationReportRecord.passed !== true)) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report has not passed: ${fidelityVerificationReportKey}`,
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const pack = buildMergeReadinessPack({
          audit,
          prOutcomeSignal: prOutcomeSignal as unknown as import('./merge-readiness-pack').PROutcomeSignalRecord,
          ...(body.createdAt ? { createdAt: body.createdAt } : {}),
        })
        const rawCanonicalEvidence = canonicalEvidenceRecord.canonicalEvidence ?? canonicalEvidenceRecord.evidence
        const canonicalEvidence = fidelityVerificationReportKey
          ? withFidelityVerificationReportEvidence(
            rawCanonicalEvidence as import('./merge-readiness-pack').CanonicalMRPEvidence,
            fidelityVerificationReportKey,
          )
          : rawCanonicalEvidence
        const canonical = toCanonicalMergeReadinessPack(
          pack,
          canonicalEvidence as import('./merge-readiness-pack').CanonicalMRPEvidence,
        )
        const persisted = await ingestMergeReadinessPack(pack, db)

        return new Response(JSON.stringify({
          persisted: true,
          id: pack.id,
          readinessVerdict: pack.readinessVerdict,
          verdict: (persisted as { verdict?: unknown }).verdict,
          prOutcomeSignalKey: prOutcomeSignal._key,
          canonicalEvidenceKey: evidenceKey,
          ...(fidelityVerificationReportKey ? {
            fidelityVerificationReportKey,
          } : {}),
          canonical,
          pack: persisted,
        }, null, 2), { status: 201, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: assemble and persist Merge-Readiness Pack evidence ──
    if (url.pathname === '/debug/mrp' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          audit?: unknown
          prOutcomeSignal?: unknown
          prOutcomeSignalKey?: string
          canonicalEvidence?: unknown
          canonicalEvidenceKey?: string
          fidelityVerificationReportKey?: string
          createdAt?: string
        }

        if (!body.audit) {
          return new Response(JSON.stringify({
            error: 'Missing required field: audit',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (!body.prOutcomeSignal && !body.prOutcomeSignalKey) {
          return new Response(JSON.stringify({
            error: 'Missing required field: prOutcomeSignal or prOutcomeSignalKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (body.canonicalEvidence && body.canonicalEvidenceKey) {
          return new Response(JSON.stringify({
            error: 'Provide only one of canonicalEvidence or canonicalEvidenceKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/db-client')
        const {
          buildMergeReadinessPack,
          ingestMergeReadinessPack,
          toCanonicalMergeReadinessPack,
          withFidelityVerificationReportEvidence,
        } = await import('./merge-readiness-pack.js')
        const db = createClientFromEnv(env)
        const prOutcomeSignal = body.prOutcomeSignal ?? await db.queryOne<{ json: string }>(
          `SELECT json FROM documents WHERE collection='specs_signals' AND key=? AND json_extract(json,'$.source')='factory:pr-outcome' LIMIT 1`,
          [body.prOutcomeSignalKey],
        ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
        const canonicalEvidenceRecord = body.canonicalEvidenceKey
          ? await db.queryOne<{ json: string }>(
            `SELECT json FROM documents WHERE collection='merge_readiness_evidence' AND (key=? OR json_extract(json,'$.id')=?) LIMIT 1`,
            [body.canonicalEvidenceKey, body.canonicalEvidenceKey],
          ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
          : null
        const fidelityVerificationReportKey = typeof body.fidelityVerificationReportKey === 'string' && body.fidelityVerificationReportKey.trim().length > 0
          ? body.fidelityVerificationReportKey.trim()
          : undefined
        const fidelityVerificationReportRecord = fidelityVerificationReportKey
          ? await db.queryOne<{ json: string }>(
            `SELECT json FROM documents WHERE collection='verification_reports' AND (key=? OR json_extract(json,'$.id')=?) LIMIT 1`,
            [fidelityVerificationReportKey, fidelityVerificationReportKey],
          ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)
          : null

        if (!prOutcomeSignal) {
          return new Response(JSON.stringify({
            error: `PR outcome signal not found: ${body.prOutcomeSignalKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (body.canonicalEvidenceKey && !canonicalEvidenceRecord) {
          return new Response(JSON.stringify({
            error: `Canonical MRP evidence not found: ${body.canonicalEvidenceKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (fidelityVerificationReportKey && !fidelityVerificationReportRecord) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report not found: ${fidelityVerificationReportKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (fidelityVerificationReportKey && (fidelityVerificationReportRecord?.type !== 'fidelity-verification' || fidelityVerificationReportRecord.passed !== true)) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report has not passed: ${fidelityVerificationReportKey}`,
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const pack = buildMergeReadinessPack({
          audit: body.audit as import('./merge-readiness-pack').SynthesisMaterializationAudit,
          prOutcomeSignal: prOutcomeSignal as import('./merge-readiness-pack').PROutcomeSignalRecord,
          ...(body.createdAt ? { createdAt: body.createdAt } : {}),
        })
        const rawCanonicalEvidence = body.canonicalEvidence
          ?? canonicalEvidenceRecord?.canonicalEvidence
          ?? canonicalEvidenceRecord?.evidence
        const canonicalEvidence = fidelityVerificationReportKey
          ? withFidelityVerificationReportEvidence(
            (rawCanonicalEvidence ?? {}) as import('./merge-readiness-pack').CanonicalMRPEvidence,
            fidelityVerificationReportKey,
          )
          : rawCanonicalEvidence
        const canonical = canonicalEvidence
          ? toCanonicalMergeReadinessPack(
            pack,
            canonicalEvidence as import('./merge-readiness-pack').CanonicalMRPEvidence,
          )
          : undefined
        const persisted = await ingestMergeReadinessPack(pack, db)

        return new Response(JSON.stringify({
          persisted: true,
          id: pack.id,
          readinessVerdict: pack.readinessVerdict,
          verdict: (persisted as { verdict?: unknown }).verdict,
          ...(fidelityVerificationReportKey ? {
            fidelityVerificationReportKey,
          } : {}),
          ...(canonical ? { canonical } : {}),
          pack: persisted,
        }, null, 2), { status: 201, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: persist sourced canonical Merge-Readiness evidence ──
    if (url.pathname === '/debug/mrp-evidence' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          key?: unknown
          canonicalEvidence?: unknown
          sourceRefs?: unknown
          createdAt?: string
        }
        if (typeof body.key !== 'string' || body.key.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: key',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (!body.canonicalEvidence || typeof body.canonicalEvidence !== 'object') {
          return new Response(JSON.stringify({
            error: 'Missing required field: canonicalEvidence',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        if (body.sourceRefs !== undefined && !Array.isArray(body.sourceRefs)) {
          return new Response(JSON.stringify({
            error: 'sourceRefs must be an array when provided',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/db-client')
        const db = createClientFromEnv(env)
        await db.ensureCollection('merge_readiness_evidence')
        const key = body.key.trim()
        const record = {
          _key: key,
          id: key,
          type: 'canonical_mrp_evidence',
          canonicalEvidence: body.canonicalEvidence,
          sourceRefs: body.sourceRefs ?? [],
          createdAt: body.createdAt ?? new Date().toISOString(),
        }
        const persisted = await db.save<Record<string, unknown>>('merge_readiness_evidence', record)

        return new Response(JSON.stringify({
          persisted: true,
          key,
          record: persisted,
        }, null, 2), { status: 201, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: read persisted Merge-Readiness Pack evidence ──
    if (url.pathname === '/debug/mrp' && request.method === 'GET') {
      try {
        const id = url.searchParams.get('id') ?? ''
        if (!id) {
          return new Response(JSON.stringify({
            error: 'Missing required query param: id',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/db-client')
        const db = createClientFromEnv(env)
        const pack = await db.queryOne<{ json: string }>(
          `SELECT json FROM documents WHERE collection='merge_readiness_packs' AND json_extract(json,'$.id')=? LIMIT 1`,
          [id],
        ).then(r => r ? JSON.parse(r.json) as Record<string, unknown> : null)

        return new Response(JSON.stringify({
          found: pack !== null,
          pack,
        }, null, 2), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Harness trigger: start a FactoryPipeline Workflow in harness mode ──
    // Accepts a FunctionJob with harnessKey. The Workflow is created with
    // id=functionRunId so the RunCoordinator DO can deliver harness-complete
    // via FACTORY_PIPELINE.get(functionRunId).sendEvent(...).
    if (url.pathname === '/trigger-harness' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          functionRunId?: string
          objective?: string
          harnessKey?: string
          workflowInstanceId?: string
          seedArtifacts?: Record<string, string>
        }

        if (!body.functionRunId || !body.objective || !body.harnessKey) {
          return new Response(JSON.stringify({
            error: 'Missing required fields: functionRunId, objective, harnessKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const job = {
          functionRunId: body.functionRunId,
          objective: body.objective,
          harnessKey: body.harnessKey,
          ...(body.workflowInstanceId ? { workflowInstanceId: body.workflowInstanceId } : {}),
          ...(body.seedArtifacts ? { seedArtifacts: body.seedArtifacts } : {}),
        }

        const created = await env.FACTORY_PIPELINE.create({
          id: body.functionRunId,
          params: { job },
        })

        return new Response(JSON.stringify({
          accepted: true,
          runId: body.functionRunId,
          workflowId: created.id,
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/dispatch-formula' && request.method === 'POST') {
      return handleDispatchFormula(request, env, ctx)
    }

    if (url.pathname === '/webhooks/gascity' && request.method === 'POST') {
      const { handleGasCityWebhook } = await import('./gascity/webhook-receiver.js')
      return handleGasCityWebhook(request, env)
    }

    if (url.pathname === '/skeleton-download' && request.method === 'GET') {
      return handleSkeletonDownload(request, env)
    }

    if (url.pathname === '/seed-dispatch-ep' && request.method === 'POST') {
      return handleSeedDispatchEp(request, env)
    }
    if (url.pathname === '/admin/seed-factory-artifacts' && request.method === 'POST') {
      return handleSeedFactoryArtifacts(request, env)
    }

    // ── Gas City pi-rpc provider → PI container execute bridge ──
    // The Gas City pi-rpc HarnessProvider (IS-GC-RUNTIME-PROVIDER-CONTRACT)
    // posts an execution request here; the route forwards it to the PI container
    // DO /execute and returns the container response for Gas City to translate
    // into its response envelope. Factory never calls the provider; Gas City
    // owns selection and operation (ADR-010 §1).
    if (url.pathname === '/__pi-container/execute' && request.method === 'POST') {
      return handlePiContainerExecute(request, env)
    }

    if (url.pathname === '/__pi-container/status' && request.method === 'GET') {
      return fetchPiContainerDiagnostic(env, '/__pi-container/status', 'GET')
    }

    if (url.pathname === '/__pi-container/fence' && request.method === 'GET') {
      const auth = authorizeOperatorControl(request, env)
      if (!auth.ok) return json({ error: auth.error }, auth.status)
      return fetchPiContainerDiagnostic(env, '/__pi-container/fence', 'GET')
    }

    if (url.pathname === '/__pi-container/restart' && request.method === 'POST') {
      const auth = authorizeOperatorControl(request, env)
      if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 403 : auth.status)
      return fetchPiContainerDiagnostic(env, '/__pi-container/restart', 'POST')
    }

    // ── Debug: seed a CoordinatorDO molecule directly (e2e atom-execution smoke) ──
    // The COORDINATOR_DO binding is optional in PipelineEnv, so this route is
    // guarded by its presence rather than the (non-existent) handler-wide wrapper.
    if (url.pathname === '/debug/seed-molecule' && request.method === 'POST' && env.COORDINATOR_DO) {
      const body = await request.json() as {
        graphId:      string   // execution-plan identifier — used to derive the coordinator runId
        graphVersion: string   // execution-plan version — used to derive the coordinator runId
        repoId:           string
        moleculeId:       string
        beads: Array<{
          id:        string
          gearId:    string
          nodeId:    string
          payload:   string
          dependsOn: string[]
        }>
      }
      const { createHash } = await import('node:crypto')
      const runId = createHash('sha256').update(body.graphId + body.graphVersion).digest('hex')
      const doId  = env.COORDINATOR_DO.idFromName(`coordinator:${runId}`)
      const stub  = env.COORDINATOR_DO.get(doId)
      // initRun first (idempotent)
      await stub.fetch(new Request('http://do/init', {
        method: 'POST',
        body:   JSON.stringify([runId, body.repoId]),
      }))
      // then seed beads
      await stub.fetch(new Request('http://do/seed', {
        method: 'POST',
        body:   JSON.stringify({ moleculeId: body.moleculeId, beads: body.beads }),
      }))
      return json({ ok: true, runId })
    }

    return new Response('ff-pipeline: POST /trigger-synthesis, POST /synthesis-callback, POST /trigger-harness, POST /dispatch-formula, POST /seed-dispatch-ep, POST /admin/seed-factory-artifacts, POST /__pi-container/execute, GET /run-status/:runId, GET /run-monitor/:runId, GET /run-artifacts/:runId, or use Queue consumer', { status: 404 })
  },

  async scheduled(event: ScheduledEvent, env: PipelineEnv, ctx: ExecutionContext): Promise<void> {
    const { runGovernanceCycle } = await import('./agents/governor-agent.js')
    ctx.waitUntil(runGovernanceCycle(env, 'cron'))
    const { runGasCityAutonomyMonitor } = await import('./gascity/autonomy-monitor.js')
    ctx.waitUntil(runGasCityAutonomyMonitor(env, 'cron'))
  },

  async queue(batch: MessageBatch, env: PipelineEnv, ctx: ExecutionContext): Promise<void> {
    // Queue routing/handling lives in ./queue-handler so it can be unit-tested
    // without importing this barrel (which re-exports DO/Workflow classes that
    // statically pull in cloudflare:* protocol modules). See queue-handler.ts.
    return queueHandler(batch, env, ctx)
  },
}

async function handleDispatchFormula(
  request: Request,
  env: PipelineEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const auth = authorizeOperatorControl(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 401 : auth.status)

    const body = await readJsonRecord(request)
    const epId = cleanString(body.epId, '')
    if (!epId) return json({ error: 'epId required' }, 400)

    const missing = missingGasCityEnvVars(env)
    if (missing.length > 0) {
      return json({ error: 'Gas City env vars not configured', missing }, 500)
    }

    const { createClientFromEnv } = await import('@factory/db-client')
    const { buildFormulaCompilerDeps } = await import('./compilers/formula-compiler-adapter.js')
    const { compileAndDispatchFormula } = await import('./compilers/formula-compiler.js')
    const arangoDb = createClientFromEnv(env)
    const ep = await arangoDb.get<Record<string, unknown>>('execution_packets', epId)
    if (!ep) return json({ error: 'EP not found', epId }, 404)

    const factoryAttempt = Number.isInteger(body.factoryAttempt) && (body.factoryAttempt as number) > 0
      ? body.factoryAttempt as number
      : 1
    const traceId = crypto.randomUUID()
    const priorEsId = cleanString(body.priorEsId, '')
    const formulaEnv = env as PipelineEnv & import('./compilers/formula-compiler.js').FormulaCompilerEnv
    const deps = buildFormulaCompilerDeps(arangoDb, formulaEnv)
    const result = await compileAndDispatchFormula({
      ep: ep as unknown as import('@factory/schemas').TrellisExecutionPacket,
      factoryAttempt,
      ...(priorEsId ? { priorEsId } : {}),
      traceId,
      env: formulaEnv,
      deps,
    })

    if (isFormulaCompilerHalt(result)) return json(result, 422)
    if (result.outcome === 'dispatched' || result.replay === true) {
      const { markFunctionDispatched } = await import('./gascity/autonomy-monitor.js')
      const epRecord = ep as Record<string, unknown>
      const functionId = cleanString(epRecord.functionId, '')
      if (functionId) {
        await markFunctionDispatched(arangoDb as never, {
          functionId,
          isId: cleanString(epRecord.intentSpecificationId, ''),
          esId: cleanString(epRecord.executableSpecificationId, ''),
          epId,
          formId: cleanString(result.form_id, ''),
          dispatchLogKey: cleanString(result.dispatch_log_key, ''),
          timestamp: new Date().toISOString(),
        })
      }
    }
    ctx.waitUntil(Promise.resolve())
    const responseTraceId = cleanString((result as { trace_id?: string }).trace_id, '') || traceId
    if (result.replay === true) return json({ accepted: true, trace_id: responseTraceId, ...result }, 200)
    return json({ accepted: true, trace_id: responseTraceId, ...result }, 202)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
}

const REQUIRED_GAS_CITY_ENV_VARS = [
  'GAS_CITY_BASE_URL',
  'GAS_CITY_CITY_NAME',
  'GAS_CITY_BEARER_TOKEN',
  'GAS_CITY_AGENT_NAME',
  'GAS_CITY_RIG',
  'GAS_CITY_RIG_ROOT',
  'GAS_CITY_WEBHOOK_URL',
] as const

function missingGasCityEnvVars(env: PipelineEnv): string[] {
  return REQUIRED_GAS_CITY_ENV_VARS.filter((key) => {
    const value = env[key]
    return typeof value !== 'string' || value.trim().length === 0
  })
}

function isFormulaCompilerHalt(
  result: import('./compilers/formula-compiler.js').FormulaCompilerResult,
): boolean {
  if (result.outcome !== 'failed') return false
  return result.error === 'missing_coherence_vr'
    || result.error === 'unregistered_adapter'
    || result.error === 'reserved_key_collision'
    || result.error === 'resume_missing_form'
    || result.error === 'form_key_collision'
    || result.error === 'form_determinism_violation'
}

/**
 * POST /seed-dispatch-ep — bootstrap helper for first live dispatch.
 *
 * Creates a minimal execution_packets row and a synthetic coherence VR so
 * /dispatch-formula has an EP to read. Requires OPERATOR_CONTROL_TOKEN.
 * Only for development/bootstrap use; remove after real pipeline EPs exist.
 */
async function handleSeedDispatchEp(request: Request, env: PipelineEnv): Promise<Response> {
  try {
    const auth = authorizeOperatorControl(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 401 : auth.status)

    const url = new URL(request.url)
    const force = (url.searchParams.get('force') ?? '').toLowerCase() === 'true'
    const body = await readJsonRecord(request)
    const fnId = cleanString(body.fnId, '') || 'FN-GC-DISPATCH-WIRE'
    const isId = cleanString(body.isId, '') || 'IS-GC-DISPATCH-WIRE'
    const esId = cleanString(body.esId, '') || 'ES-GC-DISPATCH-WIRE'
    const runId = cleanString(body.runId, '') || Date.now().toString(36).toUpperCase()
    const epId = `EP-${runId}`
    const task = cleanString(body.task, '') || `Implement ${isId}: wire POST /dispatch-formula to Gas City 3-call HTTP sequence.`
    const plannerPrompt = cleanString(body.plannerPrompt, '') || `Read ${esId} and produce a coding plan for: ${task}`
    const coderPrompt = cleanString(body.coderPrompt, '') || `Implement the plan from ${esId}: ${task}`
    const verifierPrompt = cleanString(body.verifierPrompt, '') || `Verify the implementation against ${esId} acceptance criteria. Approve if all pass.`

    const { createClientFromEnv } = await import('@factory/db-client')
    const db = createClientFromEnv(env)

    await db.ensureCollection('execution_packets')
    await db.ensureCollection('verification_reports')

    const ep = {
      _key: epId,
      id: epId,
      functionId: fnId,
      intentSpecificationId: isId,
      executableSpecificationId: esId,
      instructionTuning: {
        inputExecutableSpecificationHash: `sha256-seed-${runId}`,
      },
      adapter: {
        adapterId: 'adapter.coding',
        executionRequest: {
          parameters: { task, lang: 'typescript' },
        },
      },
      roles: [
        { roleId: 'planner', instruction: plannerPrompt, inputs: [], outputs: [`PLAN-${runId}.md`] },
        { roleId: 'coder', instruction: coderPrompt, inputs: [`PLAN-${runId}.md`], outputs: [] },
        { roleId: 'verifier', instruction: verifierPrompt, inputs: [], outputs: [] },
      ],
      seeded_at: new Date().toISOString(),
      kind: 'SeedExecutionPacket',
    }

    const existingEp = await db.get<Record<string, unknown>>('execution_packets', epId)
    if (!existingEp) {
      await db.save('execution_packets', ep)
    }

    const vrKey = `VR-SEED-COHERENCE-${runId}`
    if (env.ENVIRONMENT !== 'production') {
      const existingVr = await db.get<Record<string, unknown>>('verification_reports', vrKey)
      if (!existingVr) {
        await db.save('verification_reports', {
          _key: vrKey,
          kind: 'coherence',
          status: 'passed',
          source_refs: [esId],
          created_at: new Date().toISOString(),
          explicitness: 'explicit',
          notes: `seeded by /seed-dispatch-ep for bootstrap dispatch of ${esId}`,
        })
      }
    } else {
      return Response.json({ error: 'real_coherence_verification_required', message: '/seed-dispatch-ep synthetic VR disabled in production. Use the synthesis pipeline to generate a real coherence VR.' }, { status: 422 })
    }

    // Seed IS document so dispatch-formula can resolve intentSpecificationId.
    await db.ensureCollection('intent_specifications')
    const isBody = cleanString(body.isBody, '') || task
    const existingIs = await db.get<Record<string, unknown>>('intent_specifications', isId)
    const existingIsKind = cleanString(existingIs?.kind, '')
    const isStaleSeed = existingIsKind === 'SeedIntentSpecification'
    if (!existingIs || (isStaleSeed && force)) {
      if (isStaleSeed && force) {
        await db.remove('intent_specifications', isId)
      }
      await db.save('intent_specifications', {
        _key: isId,
        id: isId,
        body: isBody,
        content: isBody,
        acceptanceCriteria: [],
        seeded_at: new Date().toISOString(),
        kind: 'SeedIntentSpecification',
      })
    }

    // Seed ES document so dispatch-formula can resolve executableSpecificationId.
    await db.ensureCollection('executable_specifications')
    const esBody = cleanString(body.esBody, '') || task
    const existingEs = await db.get<Record<string, unknown>>('executable_specifications', esId)
    if (!existingEs) {
      await db.save('executable_specifications', {
        _key: esId,
        id: esId,
        body: esBody,
        content: esBody,
        acceptanceCriteria: [],
        seeded_at: new Date().toISOString(),
        kind: 'SeedExecutableSpecification',
      })
    }

    return json({
      ok: true,
      epId,
      vrKey,
      isId,
      esId,
      replay: !!existingEp,
      next: `POST /dispatch-formula with { "epId": "${epId}", "factoryAttempt": 1 }`,
    }, existingEp ? 200 : 201)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
}

async function handleRunIntervention(request: Request, env: PipelineEnv, url: URL): Promise<Response> {
  if (!env.WORKSPACE_BUCKET) {
    return json({ error: 'WORKSPACE_BUCKET binding unavailable' }, 503)
  }
  const auth = authorizeOperatorControl(request, env)
  if (!auth.ok) return json({ error: auth.error }, auth.status)

  const rest = url.pathname.slice('/run-interventions/'.length)
  const [encodedRunId, action] = rest.split('/')
  const runId = decodeURIComponent(encodedRunId ?? '')
  if (!runId || !action) return json({ error: 'missing runId or intervention action' }, 400)

  const log = new RunEventLog(env.WORKSPACE_BUCKET as R2Bucket)
  const body = await readJsonRecord(request)
  const operator = cleanString(body.operator, 'operator')
  const reason = cleanString(body.reason, '')
  const note = cleanString(body.note, '')
  const explicitStageName = cleanString(body.stageName, '')
  const idempotencyKey = cleanString(body.idempotencyKey, '')
  const summary = await log.getSummary(runId)
  if (!summary) {
    return json({ error: 'run summary not found', runId }, 404)
  }
  const stageName = explicitStageName || summary.currentStage || undefined

  if (action === 'note') {
    if (!note) return json({ error: 'missing note' }, 400)
    await emitIntervention(log, {
      runId,
      type: 'operator_note_added',
      operator,
      message: note,
    })
    return json({ ok: true, runId, action: 'operator_note_added' }, 202)
  }

  if (action === 'retry-stage' || action === 'redispatch-stage') {
    if (isTerminalRunStatus(summary.status)) {
      return json({
        error: 'run is already terminal',
        runId,
        status: summary.status,
      }, 409)
    }
    if (!explicitStageName) return json({ error: 'missing stageName' }, 400)
    const type = action === 'retry-stage' ? 'stage_retry_requested' : 'stage_redispatch_requested'
    const message = reason || `${action} requested`
    const effect = await dispatchOperatorStage(env, {
      runId,
      stageName: explicitStageName,
      action,
      operator,
      reason: message,
      idempotencyKey: idempotencyKey || defaultInterventionIdempotencyKey(action, runId, explicitStageName, operator, message),
    })
    if (!effect.ok) {
      return json({
        error: effect.error ?? 'operator dispatch failed',
        runId,
        action: type,
        stageName: explicitStageName,
        effect,
      }, effect.status && effect.status >= 400 && effect.status < 600 ? effect.status : 502)
    }
    if (effect.deduped) {
      return json({
        ok: true,
        runId,
        action: type,
        stageName: explicitStageName,
        effect,
      }, 200)
    }
    await emitIntervention(log, {
      runId,
      stageName: explicitStageName,
      type,
      operator,
      message,
      effect: 'enqueued',
    })
    return json({
      ok: true,
      runId,
      action: type,
      stageName: explicitStageName,
      effect,
    }, 202)
  }

  if (action === 'cancel') {
    const currentStatus = summary.status
    if (isTerminalRunStatus(currentStatus)) {
      return json({
        error: 'run is already terminal',
        runId,
        status: currentStatus,
      }, 409)
    }
    const finalStage = stageName || 'unknown'
    const message = reason || 'operator cancel requested'
    await emitIntervention(log, {
      runId,
      stageName: finalStage,
      type: 'run_cancel_requested',
      operator,
      message,
      effect: env.RUN_COORDINATOR ? 'force_complete_requested' : 'recorded_only',
    })
    const effect = await forceCompleteCancelledRun(env, runId, finalStage, message)
    return json({
      ok: true,
      runId,
      action: 'run_cancel_requested',
      stageName: finalStage,
      effect,
    }, 202)
  }

  return json({ error: `unknown intervention action: ${action}` }, 404)
}

async function handleSeedFactoryArtifacts(request: Request, env: PipelineEnv): Promise<Response> {
  try {
    const auth = authorizeOperatorControl(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status === 403 ? 401 : auth.status)

    const body = await readJsonRecord(request)
    const fnId = cleanString(body.fnId, '') || 'FN-GC-DISPATCH-WIRE'
    const isId = cleanString(body.isId, '') || 'IS-GC-DISPATCH-WIRE'
    const esId = cleanString(body.esId, '') || 'ES-GC-DISPATCH-WIRE'
    const isBody = cleanString(body.isBody, '')
    const esBody = cleanString(body.esBody, '')
    if (!isBody) return json({ error: 'isBody is required' }, 400)
    if (!esBody) return json({ error: 'esBody is required' }, 400)

    const { createClientFromEnv } = await import('@factory/db-client')
    const db = createClientFromEnv(env)

    await db.ensureCollection('intent_specifications')
    await db.ensureCollection('executable_specifications')
    await db.ensureCollection('specs_functions')

    const seeded: string[] = []

    const now = new Date().toISOString()
    const isDoc = await db.get<Record<string, unknown>>('intent_specifications', isId)
    if (!isDoc) {
      await db.save('intent_specifications', {
        _key: isId,
        id: isId,
        kind: 'IntentSpecification',
        body: isBody,
        content: isBody,
        acceptanceCriteria: [],
        seeded_at: now,
      })
    } else {
      await db.update('intent_specifications', isId, {
        kind: 'IntentSpecification',
        body: isBody,
        content: isBody,
        seeded_at: now,
      })
    }
    seeded.push(isId)

    const esDoc = await db.get<Record<string, unknown>>('executable_specifications', esId)
    if (!esDoc) {
      await db.save('executable_specifications', {
        _key: esId,
        id: esId,
        kind: 'ExecutableSpecification',
        body: esBody,
        content: esBody,
        acceptanceCriteria: [],
        seeded_at: now,
      })
    } else {
      await db.update('executable_specifications', esId, {
        kind: 'ExecutableSpecification',
        body: esBody,
        content: esBody,
        seeded_at: now,
      })
    }
    seeded.push(esId)

    const fnDoc = await db.get<Record<string, unknown>>('specs_functions', fnId)
    if (!fnDoc) {
      await db.save('specs_functions', {
        _key: fnId,
        id: fnId,
        kind: 'Function',
        title: fnId,
        source_refs: [isId, esId],
        seeded_at: now,
      })
    } else {
      await db.update('specs_functions', fnId, {
        kind: 'Function',
        source_refs: [isId, esId],
        seeded_at: now,
      })
    }
    seeded.push(fnId)

    return json({ ok: true, seeded }, 200)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
}

export type OperatorAuthorizationResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

export function authorizeOperatorControl(request: Request, env: PipelineEnv): OperatorAuthorizationResult {
  const expected = env.OPERATOR_CONTROL_TOKEN
  if (!expected) {
    return env.ENVIRONMENT === 'production'
      ? { ok: false, status: 503, error: 'operator control auth is not configured' }
      : { ok: true }
  }
  const supplied = bearerToken(request.headers.get('Authorization')) || request.headers.get('X-FF-Operator-Token') || ''
  if (!supplied) return { ok: false, status: 401, error: 'operator authorization required' }
  if (!constantTimeEqual(supplied, expected)) return { ok: false, status: 403, error: 'operator authorization rejected' }
  return { ok: true }
}

function bearerToken(value: string | null): string {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  const max = Math.max(left.length, right.length)
  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

function defaultInterventionIdempotencyKey(
  action: string,
  runId: string,
  stageName: string,
  operator: string,
  message: string,
): string {
  return `${action}:${runId}:${stageName}:${operator}:${message}`
}

async function emitIntervention(
  log: RunEventLog,
  input: {
    runId: string
    stageName?: string
    type: 'operator_note_added' | 'run_cancel_requested' | 'stage_retry_requested' | 'stage_redispatch_requested'
    operator: string
    message: string
    effect?: string
  },
): Promise<void> {
  await log.emit({
    runId: input.runId,
    ...(input.stageName ? { stageName: input.stageName } : {}),
    type: input.type,
    emitter: 'operator',
    data: {
      operator: input.operator,
      message: input.message,
      ...(input.effect ? { effect: input.effect } : {}),
    },
  })
}

async function forceCompleteCancelledRun(
  env: PipelineEnv,
  runId: string,
  finalStage: string,
  reason: string,
): Promise<{ attempted: boolean; ok?: boolean; status?: number; error?: string; reason?: string }> {
  if (!env.RUN_COORDINATOR) return { attempted: false, reason: 'RUN_COORDINATOR binding unavailable' }
  try {
    const stub = env.RUN_COORDINATOR.get(env.RUN_COORDINATOR.idFromName(runId))
    const response = await stub.fetch(new Request('https://run-coordinator/force-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        reason: 'operator_cancelled',
        result: {
          overall: 'fail',
          finalStage,
          reason: `operator cancel requested: ${reason}`,
          failureClass: 'operator_cancelled',
        },
      }),
    }))
    if (!response.ok) {
      return { attempted: true, ok: false, status: response.status, error: (await response.text()).slice(0, 400) }
    }
    return { attempted: true, ok: true, status: response.status }
  } catch (err) {
    return { attempted: true, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function dispatchOperatorStage(
  env: PipelineEnv,
  input: {
    runId: string
    stageName: string
    action: 'retry-stage' | 'redispatch-stage'
    operator: string
    reason: string
    idempotencyKey: string
  },
): Promise<{ attempted: boolean; ok?: boolean; status?: number; error?: string; reason?: string; enqueued?: boolean; deduped?: boolean; attemptNumber?: number }> {
  if (!env.RUN_COORDINATOR) return { attempted: false, ok: false, reason: 'RUN_COORDINATOR binding unavailable' }
  try {
    const stub = env.RUN_COORDINATOR.get(env.RUN_COORDINATOR.idFromName(input.runId))
    const response = await stub.fetch(new Request('https://run-coordinator/operator-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }))
    const text = await response.text()
    const parsed = parseJsonRecord(text)
    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        status: response.status,
        error: typeof parsed.error === 'string' ? parsed.error : text.slice(0, 400),
      }
    }
    const effect = parsed.effect && typeof parsed.effect === 'object' && !Array.isArray(parsed.effect)
      ? parsed.effect as Record<string, unknown>
      : {}
    return {
      attempted: true,
      ok: true,
      status: response.status,
      enqueued: effect.enqueued === true,
      deduped: effect.deduped === true,
      ...(typeof parsed.attemptNumber === 'number' ? { attemptNumber: parsed.attemptNumber } : {}),
    }
  } catch (err) {
    return { attempted: true, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function parseJsonRecord(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim().slice(0, 4096) : fallback
}

function isTerminalRunStatus(status: unknown): boolean {
  return status === 'completed' || status === 'failed' || status === 'stuck' || status === 'dlq_recovered'
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * GET /skeleton-download — streams a workspace skeleton tar.gz from R2 to the
 * Gas City `init` step. Authenticated by an HMAC-SHA256 token over a 2-hour
 * window (SPEC-FF-SEEDWORKSPACE-001). The current and previous window are both
 * accepted so a token minted just before a window boundary still validates.
 */
async function handleSkeletonDownload(request: Request, env: PipelineEnv): Promise<Response> {
  const url = new URL(request.url)
  const r2Key = url.searchParams.get('key') ?? ''
  const token = url.searchParams.get('token') ?? ''
  if (!r2Key || !token) return json({ error: 'key and token required' }, 400)

  const hmacSecret = env.GAS_CITY_HMAC_SECRET_V1
  if (!hmacSecret) return json({ error: 'hmac_secret_unconfigured' }, 503)

  // Validate token for current and previous 2h window (handles boundary).
  const hourWindow = Math.floor(Date.now() / (2 * 3600 * 1000))
  const validWindows = [hourWindow, hourWindow - 1]
  let valid = false
  for (const w of validWindows) {
    const expected = await skeletonHmacSha256Hex(hmacSecret, `${r2Key}|${w}`)
    if (expected === token) {
      valid = true
      break
    }
  }
  if (!valid) return json({ error: 'invalid_token' }, 401)

  const bucket = env.WORKSPACE_BUCKET as R2Bucket | undefined
  if (!bucket) return json({ error: 'workspace_bucket_unconfigured' }, 503)
  const obj = await bucket.get(r2Key)
  if (!obj) return json({ error: 'skeleton_not_found', r2Key }, 404)

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="skeleton.tar.gz"',
    },
  })
}

async function skeletonHmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  const bytes = new Uint8Array(signature)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

async function checkArango(env: PipelineEnv): Promise<boolean> {
  try {
    const { createClientFromEnv } = await import('@factory/db-client')
    const db = createClientFromEnv(env)
    return await db.ping()
  } catch {
    return false
  }
}

async function handleInitDb(env: PipelineEnv): Promise<Response> {
  try {
    return await _initDb(env)
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
}

async function _initDb(env: PipelineEnv): Promise<Response> {
  const results: string[] = []
  const basicAuth = btoa(`${env.ARANGO_USERNAME ?? 'root'}:${env.ARANGO_PASSWORD ?? ''}`)
  const rootHeaders = { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' }

  // 1. Create database (best-effort — skipped if Basic auth unavailable or DB already exists)
  try {
    const dbRes = await fetch(`${env.ARANGO_URL}/_api/database`, {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({ name: env.ARANGO_DATABASE }),
    })
    const dbText = await dbRes.text()
    let dbBody: Record<string, unknown> = {}
    try { dbBody = JSON.parse(dbText) } catch { /* non-JSON response — skip */ }
    if (dbRes.ok) {
      results.push(`db:${env.ARANGO_DATABASE} created`)
    } else if ((dbBody.errorNum as number) === 1207) {
      results.push(`db:${env.ARANGO_DATABASE} exists`)
    } else {
      results.push(`db:create skipped (${dbRes.status}: ${dbText.slice(0, 80)})`)
    }
  } catch (err) {
    results.push(`db:create skipped (${err instanceof Error ? err.message : String(err)})`)
  }

  // 2. Ensure all collections
  const { createClientFromEnv } = await import('@factory/db-client')
  const db = createClientFromEnv(env)

  const docCollections = [
    'execution_packets', 'verification_reports',
    'specs_signals', 'specs_pressures', 'specs_capabilities',
    'specs_functions', 'intent_specifications', 'executable_specifications',
    'specs_invariants', 'specs_critic_reviews',
    'verification_status', 'trust_scores', 'invariant_health',
    'memory_episodic', 'memory_semantic', 'memory_working', 'memory_personal',
    'function_runs', 'execution_artifacts',
    'mentorscript_rules', 'consultation_requests',
    'version_controlled_resolutions', 'merge_readiness_packs',
    'merge_readiness_evidence', 'trellis_execution_packets',
    'lifecycle_transitions', 'hot_config',
    'config_aliases', 'config_routing', 'config_model_capabilities',
    'orl_telemetry', 'intent_anchors', 'compilation_drift_ledger',
    'completion_ledgers', 'file_context_cache',
    'learning_run_transcripts', 'learning_observations',
    'learning_template_candidates', 'learning_template_usage',
    'learning_routing_observations', 'learning_consolidation_reports',
    'learning_mutation_journal', 'learning_routing_proposals',
    'learning_template_promotion_requests',
  ]
  const edgeCollections = ['lineage_edges', 'assurance_edges', 'dependency_edges']

  for (const name of docCollections) {
    await db.ensureCollection(name)
    results.push(`col:${name}`)
  }
  for (const name of edgeCollections) {
    await db.ensureCollection(name, { type: 'edge' })
    results.push(`edge:${name}`)
  }

  return json({ ok: true, results, timestamp: new Date().toISOString() })
}
