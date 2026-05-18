export { FactoryPipeline } from './pipeline'
export { SynthesisCoordinator } from './coordinator'
export { validateCodeLanguage } from './coordinator/atom-executor'
export { AtomExecutor } from './coordinator/atom-executor-do'
export { RunCoordinator } from './coordinator/run-coordinator'
export { PiContainer } from './coordinator/pi-container'
export { Sandbox } from '@cloudflare/sandbox'

// Harness path (IS-HARNESS-DSL-v1 §2–§3, ADR-009 §4 Phase 3)
export { startHarnessRun } from './harness-bridge'
export { dispatchOne as dispatchHarnessStage, buildDefaultDispatcherDeps } from './harness-dispatcher'
export type { HarnessBridgeEnv, HarnessJob, HarnessQueueMessage } from './harness-env'

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

function isHarnessQueueMessage(body: unknown): body is import('./harness-env').HarnessQueueMessage {
  if (!body || typeof body !== 'object') return false
  const candidate = body as Record<string, unknown>
  return (
    typeof candidate.runId === 'string' &&
    candidate.runId.length > 0 &&
    typeof candidate.stageName === 'string' &&
    candidate.stageName.length > 0 &&
    !('workflowId' in candidate) &&
    !('executableSpecificationId' in candidate) &&
    !('type' in candidate)
  )
}

function piContainerStub(env: PipelineEnv): DurableObjectStub | null {
  if (!env.PI_CONTAINER) return null
  return env.PI_CONTAINER.get(env.PI_CONTAINER.idFromName('pi'))
}

async function fetchPiContainerDiagnostic(
  env: PipelineEnv,
  path: '/__pi-container/status' | '/__pi-container/restart' | '/health',
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

    // ── Synthesis trigger: external route that bridges Workflow <-> DO ──
    if (url.pathname === '/trigger-synthesis' && request.method === 'POST') {
      const body = await request.json() as {
        workflowId?: string
        executableSpecificationId?: string
        executableSpecification?: import('./coordinator/state').PipelineExecutableSpecification
        trellisExecutionPacket?: unknown
        dryRun?: boolean
      }

      if (!body.workflowId || !body.executableSpecificationId || !body.executableSpecification || !body.trellisExecutionPacket) {
        return new Response(JSON.stringify({ error: 'Missing required fields: workflowId, executableSpecificationId, executableSpecification, trellisExecutionPacket' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Fire-and-forget: DO work + event sending happens in background
      const workflow = await env.FACTORY_PIPELINE.get(body.workflowId)
      const executableSpecificationId = body.executableSpecificationId
      const executableSpecification = body.executableSpecification
      const trellisExecutionPacket = body.trellisExecutionPacket
      const dryRun = body.dryRun ?? false

      ctx.waitUntil((async () => {
        try {
          const doId = env.COORDINATOR.idFromName(`synth-${executableSpecificationId}`)
          const stub = env.COORDINATOR.get(doId)
          const doResponse = await stub.fetch(new Request('https://do/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ executableSpecification, trellisExecutionPacket, dryRun }),
          }))

          const result = await doResponse.json() as {
            verdict: { decision: string; confidence: number; reason: string }
            tokenUsage: number
            repairCount: number
          }

          await workflow.sendEvent({
            type: 'synthesis-complete',
            payload: {
              verdict: result.verdict,
              tokenUsage: result.tokenUsage,
              repairCount: result.repairCount,
            },
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          await workflow.sendEvent({
            type: 'synthesis-complete',
            payload: {
              verdict: { decision: 'fail', confidence: 1.0, reason: `Trigger error: ${errorMessage}` },
              tokenUsage: 0,
              repairCount: 0,
            },
          })
        }
      })())

      return new Response(JSON.stringify({ accepted: true, executableSpecificationId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
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
        const { createClientFromEnv } = await import('@factory/arango-client')
        const db = createClientFromEnv(env)
        const assessments = await db.query<Record<string, unknown>>(
          `FOR a IN orientation_assessments SORT a.generated_at DESC LIMIT 5 RETURN { id: a._key, type: a.assessment_type, generated_at: a.generated_at, decisions: LENGTH(a.decisions || []), actions_taken: a.actions_taken }`,
        ).catch(() => [])
        const telemetry = await db.query<Record<string, unknown>>(
          `FOR t IN orl_telemetry FILTER t.schemaName IN ['GovernorAssessment', 'GovernanceCycleResult', '_governance_cycle'] SORT t.timestamp DESC LIMIT 5 RETURN { timestamp: t.timestamp, success: t.success, failureMode: t.failureMode, schema: t.schemaName, verdict: t.verdict, operationalHealth: t.operationalHealth, trend: t.trend, error: t.error }`,
        ).catch(() => [])
        return new Response(JSON.stringify({ assessments, telemetry, cycleCount: assessments.length }, null, 2), { headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: Crystallizer observability — anchors, probes, drift ──
    if (url.pathname === '/debug/crystallizer' && request.method === 'GET') {
      try {
        const { createClientFromEnv } = await import('@factory/arango-client')
        const db = createClientFromEnv(env)
        const signalId = url.searchParams.get('signal') ?? undefined

        const anchorsQuery = signalId
          ? `FOR a IN intent_anchors FILTER a.signal_id == @signalId RETURN a`
          : `FOR a IN intent_anchors SORT a._key DESC LIMIT 20 RETURN a`
        const anchors = await db.query<Record<string, unknown>>(
          anchorsQuery, signalId ? { signalId } : undefined,
        ).catch(() => [])

        const driftQuery = signalId
          ? `FOR d IN compilation_drift_ledger FILTER d.signal_id == @signalId SORT d.timestamp DESC RETURN { pass: d.pass_name, verdict: d.gate_verdict, remediations: d.remediation_count, violations: LENGTH(FOR r IN d.probe_results FILTER r.is_violation RETURN 1), anchors_probed: LENGTH(d.anchors_probed), latency_ms: d.latency_ms, timestamp: d.timestamp, probe_results: d.probe_results }`
          : `FOR d IN compilation_drift_ledger SORT d.timestamp DESC LIMIT 20 RETURN { signal: d.signal_id, pass: d.pass_name, verdict: d.gate_verdict, remediations: d.remediation_count, violations: LENGTH(FOR r IN d.probe_results FILTER r.is_violation RETURN 1), timestamp: d.timestamp }`
        const drift = await db.query<Record<string, unknown>>(
          driftQuery, signalId ? { signalId } : undefined,
        ).catch(() => [])

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
        if (!body.pipelineId || !env.GITHUB_TOKEN) {
          return new Response(JSON.stringify({ error: 'Need pipelineId and GITHUB_TOKEN' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
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
            signalTitle: `PR from pipeline ${body.pipelineId}`,
            proposalId: output.proposalId as string ?? 'unknown',
            executableSpecificationId: output.executableSpecificationId as string ?? 'unknown',
            atomResults: (output.atomResults ?? {}) as any,
            sourceRefs: [],
            confidence: (output.synthesisResult as any)?.verdict?.confidence ?? 0,
          },
          env.GITHUB_TOKEN,
          'Wescome',
          'function-factory',
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

        const { createClientFromEnv } = await import('@factory/arango-client')
        const db = createClientFromEnv(env)
        const rows = await db.query<Record<string, unknown>>(
          `FOR s IN specs_signals
             FILTER s.source == 'factory:pr-outcome'
             FILTER LIKE(s.subtype, 'synthesis:pr-%')
             FILTER s.raw.pr.number == @pullNumber
             FILTER s.raw.executableSpecificationId == @executableSpecificationId
             SORT s.createdAt DESC
             LIMIT 1
             RETURN s`,
          { pullNumber, executableSpecificationId },
        )
        const signal = rows[0] ?? null
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
          const { createClientFromEnv } = await import('@factory/arango-client')
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

        const { createClientFromEnv } = await import('@factory/arango-client')
        const db = createClientFromEnv(env)
        const rows = await db.query<Record<string, unknown>>(
          `FOR s IN specs_signals
             FILTER s.source == 'factory:pr-outcome'
             FILTER LIKE(s.subtype, 'synthesis:pr-%')
             FILTER s.raw.pr.number != null
             FILTER s.raw.pr.state == 'OPEN'
             FILTER s.raw.pr.merged != true
             FILTER s.raw.pipelineId != null
             FILTER s.raw.proposalId != null
             FILTER s.raw.executableSpecificationId != null
             SORT s.createdAt DESC
             COLLECT pullNumber = s.raw.pr.number INTO grouped
             LET latest = FIRST(grouped[*].s)
             LIMIT @limit
             RETURN latest`,
          { limit },
        )

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
      try {
        const body = await request.json() as Record<string, unknown>
        const fidelityVerification = await import('./fidelity-verification.js')
        let result: import('./fidelity-verification').FidelityVerificationResult
        const fidelityVerificationInput = body.fidelityVerificationInput ?? body.fidelityVerificationInput
        if (fidelityVerificationInput) {
          const options: import('./fidelity-verification').AdaptFidelityVerificationInputOptions = {
            intentSpecificationId: body.intentSpecificationId as string,
            ...(body.timestamp ? { timestamp: body.timestamp as string } : {}),
            ...(body.sourceRefs ? { sourceRefs: body.sourceRefs as string[] } : {}),
          }
          result = fidelityVerification.evaluateFidelityVerificationFromContractInput(
            fidelityVerificationInput as import('./fidelity-verification').FidelityVerificationContractInput,
            options,
          )
        } else {
          result = fidelityVerification.evaluateFidelityVerification(body as unknown as import('./fidelity-verification').FidelityVerificationInput)
        }

        const lifecycleDryRunInput = body.lifecycleDryRun as Record<string, unknown> | undefined
        const lifecycleDryRun = lifecycleDryRunInput
          ? fidelityVerification.dryRunFidelityAcceptanceTransition({
            currentState: lifecycleDryRunInput.currentState as import('./lifecycle').LifecycleState,
            report: result.report,
            verdict: result.verdict,
          })
          : undefined
        const responseBody = lifecycleDryRun ? { ...result, lifecycleDryRun } : result

        if (body.persist === true) {
          const { createClientFromEnv } = await import('@factory/arango-client')
          const db = createClientFromEnv(env)
          await db.ensureCollection('verification_reports')
          const record = {
            _key: result.report.id,
            id: result.report.id,
            type: 'fidelity-verification',
            passed: result.report.overall === 'pass',
            report: result.report,
            verdict: result.verdict,
            source_refs: result.report.source_refs,
            timestamp: result.report.timestamp,
          }
          await db.save('verification_reports', record)

          return new Response(JSON.stringify({
            persisted: true,
            coverageReportKey: result.report.id,
            fidelityVerificationReportKey: result.report.id,
            ...responseBody,
          }, null, 2), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify(responseBody, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: minimal Persistence Verification registration report ──
    if ((url.pathname === '/debug/persistence-verification' || url.pathname === '/debug/persistence-verification') && request.method === 'POST') {
      try {
        const body = await request.json() as Record<string, unknown>
        const { evaluatePersistenceVerificationRegistration } = await import('./persistence-verification.js')
        const report = evaluatePersistenceVerificationRegistration(
          body as unknown as import('./persistence-verification').PersistenceVerificationRegistrationInput,
        )

        if (body.persist === true) {
          const { createClientFromEnv } = await import('@factory/arango-client')
          const db = createClientFromEnv(env)
          await db.ensureCollection('verification_reports')
          const record = {
            _key: report.id,
            id: report.id,
            type: 'persistence-verification',
            passed: report.overall === 'pass',
            report,
            source_refs: report.source_refs,
            timestamp: report.timestamp,
          }
          await db.save('verification_reports', record)

          return new Response(JSON.stringify({
            persisted: true,
            coverageReportKey: report.id,
            persistenceVerificationReportKey: report.id,
            report,
          }, null, 2), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({ report }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }

    // ── Diagnostic: guarded lifecycle acceptance from persisted Fidelity Verification evidence ──
    if (url.pathname === '/debug/lifecycle-acceptance' && request.method === 'POST') {
      try {
        const body = await request.json() as {
          functionKey?: unknown
          fidelityVerificationReportKey?: unknown
          apply?: boolean
          repairAcceptedTransitionEdge?: boolean
        }
        if (typeof body.functionKey !== 'string' || body.functionKey.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'Missing required field: functionKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        const fidelityVerificationReportKey =
          typeof body.fidelityVerificationReportKey === 'string' && body.fidelityVerificationReportKey.trim().length > 0
            ? body.fidelityVerificationReportKey.trim()
            : undefined
        if (!fidelityVerificationReportKey) {
          return new Response(JSON.stringify({
            error: 'Missing required field: fidelityVerificationReportKey',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const functionKey = body.functionKey.trim()
        const { createClientFromEnv } = await import('@factory/arango-client')
        const { dryRunFidelityAcceptanceTransition } = await import('./fidelity-verification.js')
        const { transitionLifecycle } = await import('./lifecycle.js')
        const db = createClientFromEnv(env)
        const fidelityVerificationReportRecord = await db.queryOne<Record<string, unknown>>(
          `FOR report IN verification_reports
             FILTER report._key == @key OR report.id == @key
             LIMIT 1
             RETURN report`,
          { key: fidelityVerificationReportKey },
        )
        if (!fidelityVerificationReportRecord) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report not found: ${fidelityVerificationReportKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (fidelityVerificationReportRecord.type !== 'fidelity-verification' || fidelityVerificationReportRecord.passed !== true) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report has not passed: ${fidelityVerificationReportKey}`,
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const doc = await db.get<{ _key: string; lifecycleState?: string }>('specs_functions', functionKey)
        if (!doc) {
          return new Response(JSON.stringify({
            error: `Function ${functionKey} not found in specs_functions`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }

        const report = fidelityVerificationReportRecord.report as import('./fidelity-verification').FidelityVerificationResult['report']
        const verdict = fidelityVerificationReportRecord.verdict as import('./fidelity-verification').FidelityVerificationResult['verdict']
        const reportSourceRefs = [
          ...(
            Array.isArray(fidelityVerificationReportRecord.source_refs)
              ? fidelityVerificationReportRecord.source_refs
              : []
          ),
          ...(
            Array.isArray((report as { source_refs?: unknown }).source_refs)
              ? (report as { source_refs: unknown[] }).source_refs
              : []
          ),
        ].filter((ref): ref is string => typeof ref === 'string')
        const packetId = reportSourceRefs.find(ref => ref.startsWith('TEP-'))
        if (!packetId) {
          return new Response(JSON.stringify({
            error: `Fidelity Verification report is missing Trellis packet lineage: ${fidelityVerificationReportKey}`,
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        const lifecycleDryRun = dryRunFidelityAcceptanceTransition({
          currentState: (doc.lifecycleState ?? 'proposed') as import('./lifecycle').LifecycleState,
          report,
          verdict,
        })

        if (body.repairAcceptedTransitionEdge === true) {
          if ((doc.lifecycleState ?? 'proposed') !== 'accepted') {
            return new Response(JSON.stringify({
              error: `Function ${functionKey} is not accepted; transition edge repair is only valid after produced -> accepted has already applied.`,
              applied: false,
              functionKey,
              fidelityVerificationReportKey,
              lifecycleDryRun,
            }, null, 2), { status: 400, headers: { 'Content-Type': 'application/json' } })
          }

          const repairedAt = new Date().toISOString()
          const transition = {
            from: 'produced',
            to: 'accepted',
            trigger: 'fidelity-verification-pass',
            guard: 'fidelity-verification',
            responsible_context: 'ff-pipeline:debug-lifecycle-acceptance-repair',
            verificationReport: fidelityVerificationReportKey,
            packetId,
            timestamp: repairedAt,
          }
          await db.ensureCollection('lifecycle_transitions')
          await db.saveEdge(
            'lifecycle_transitions',
            `specs_functions/${functionKey}`,
            `specs_functions/${functionKey}`,
            transition,
          )

          return new Response(JSON.stringify({
            applied: true,
            repaired: true,
            functionKey,
            from: 'produced',
            to: 'accepted',
            fidelityVerificationReportKey,
            transition,
          }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        if (!lifecycleDryRun.wouldTransition) {
          return new Response(JSON.stringify({
            applied: false,
            functionKey,
            fidelityVerificationReportKey,
            lifecycleDryRun,
          }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        if (body.apply === true) {
          await transitionLifecycle(db as never, functionKey, 'accepted', {
            trigger: 'fidelity-verification-pass',
            guard: 'fidelity-verification',
            responsible_context: 'ff-pipeline:debug-lifecycle-acceptance',
            verificationReport: fidelityVerificationReportKey,
            packetId,
          })

          return new Response(JSON.stringify({
            applied: true,
            functionKey,
            from: lifecycleDryRun.from,
            to: 'accepted',
            fidelityVerificationReportKey,
          }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        return new Response(JSON.stringify({
          applied: false,
          functionKey,
          fidelityVerificationReportKey,
          lifecycleDryRun,
        }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
      } catch (err) {
        return new Response(JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
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
        const { createClientFromEnv } = await import('@factory/arango-client')
        const { evaluateFunctionIdentity } = await import('./function-identity.js')
        const db = createClientFromEnv(env)
        const proposalDocument = await db.get<Record<string, unknown>>('specs_functions', proposalKey)
        const functionDocument = await db.get<Record<string, unknown>>('specs_functions', functionId)
        const mergeReadinessPack = mergeReadinessPackId
          ? await db.queryOne<Record<string, unknown>>(
            `FOR mrp IN merge_readiness_packs
               FILTER mrp._key == @id OR mrp.id == @id
               LIMIT 1
               RETURN mrp`,
            { id: mergeReadinessPackId },
          )
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
        const { createClientFromEnv } = await import('@factory/arango-client')
        const { evaluateFunctionIdentity } = await import('./function-identity.js')
        const db = createClientFromEnv(env)
        const proposalDocument = await db.get<Record<string, unknown>>('specs_functions', proposalKey)
        const functionDocument = await db.get<Record<string, unknown>>('specs_functions', functionId)
        const mergeReadinessPack = mergeReadinessPackId
          ? await db.queryOne<Record<string, unknown>>(
            `FOR mrp IN merge_readiness_packs
               FILTER mrp._key == @id OR mrp.id == @id
               LIMIT 1
               RETURN mrp`,
            { id: mergeReadinessPackId },
          )
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

        const audit = body.audit as import('./synthesis-pr-draft').SynthesisMaterializationAudit
        const executableSpecificationId = audit.executableSpecificationId
        if (typeof executableSpecificationId !== 'string' || executableSpecificationId.trim().length === 0) {
          return new Response(JSON.stringify({
            error: 'audit.executableSpecificationId is required',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } })
        }

        const { createClientFromEnv } = await import('@factory/arango-client')
        const {
          buildMergeReadinessPack,
          ingestMergeReadinessPack,
          toCanonicalMergeReadinessPack,
          withFidelityVerificationReportEvidence,
        } = await import('./merge-readiness-pack.js')
        const db = createClientFromEnv(env)
        const prOutcomeSignals = await db.query<Record<string, unknown>>(
          `FOR s IN specs_signals
             FILTER s.source == 'factory:pr-outcome'
             FILTER LIKE(s.subtype, 'synthesis:pr-%')
             FILTER s.raw.pr.number == @pullNumber
             FILTER s.raw.executableSpecificationId == @executableSpecificationId
             SORT s.raw.observedAt DESC, s.createdAt DESC
             LIMIT 1
             RETURN s`,
          { pullNumber: body.pullNumber, executableSpecificationId },
        )
        const prOutcomeSignal = prOutcomeSignals[0] ?? null
        if (!prOutcomeSignal) {
          return new Response(JSON.stringify({
            error: `PR outcome signal not found for PR #${body.pullNumber} and ${executableSpecificationId}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }

        const evidenceKey = body.canonicalEvidenceKey.trim()
        const canonicalEvidenceRecord = await db.queryOne<Record<string, unknown>>(
          `FOR evidence IN merge_readiness_evidence
             FILTER evidence._key == @key OR evidence.id == @key
             LIMIT 1
             RETURN evidence`,
          { key: evidenceKey },
        )
        if (!canonicalEvidenceRecord) {
          return new Response(JSON.stringify({
            error: `Canonical MRP evidence not found: ${evidenceKey}`,
          }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        const fidelityVerificationReportKey = typeof body.fidelityVerificationReportKey === 'string' && body.fidelityVerificationReportKey.trim().length > 0
          ? body.fidelityVerificationReportKey.trim()
          : undefined
        const fidelityVerificationReportRecord = fidelityVerificationReportKey
          ? await db.queryOne<Record<string, unknown>>(
            `FOR report IN verification_reports
               FILTER report._key == @key OR report.id == @key
               LIMIT 1
               RETURN report`,
            { key: fidelityVerificationReportKey },
          )
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

        const { createClientFromEnv } = await import('@factory/arango-client')
        const {
          buildMergeReadinessPack,
          ingestMergeReadinessPack,
          toCanonicalMergeReadinessPack,
          withFidelityVerificationReportEvidence,
        } = await import('./merge-readiness-pack.js')
        const db = createClientFromEnv(env)
        const prOutcomeSignal = body.prOutcomeSignal ?? await db.queryOne<Record<string, unknown>>(
          `FOR s IN specs_signals
             FILTER s._key == @key
             FILTER s.source == 'factory:pr-outcome'
             LIMIT 1
             RETURN s`,
          { key: body.prOutcomeSignalKey },
        )
        const canonicalEvidenceRecord = body.canonicalEvidenceKey
          ? await db.queryOne<Record<string, unknown>>(
            `FOR evidence IN merge_readiness_evidence
               FILTER evidence._key == @key OR evidence.id == @key
               LIMIT 1
               RETURN evidence`,
            { key: body.canonicalEvidenceKey },
          )
          : null
        const fidelityVerificationReportKey = typeof body.fidelityVerificationReportKey === 'string' && body.fidelityVerificationReportKey.trim().length > 0
          ? body.fidelityVerificationReportKey.trim()
          : undefined
        const fidelityVerificationReportRecord = fidelityVerificationReportKey
          ? await db.queryOne<Record<string, unknown>>(
            `FOR report IN verification_reports
               FILTER report._key == @key OR report.id == @key
               LIMIT 1
               RETURN report`,
            { key: fidelityVerificationReportKey },
          )
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
          audit: body.audit as import('./synthesis-pr-draft').SynthesisMaterializationAudit,
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

        const { createClientFromEnv } = await import('@factory/arango-client')
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

        const { createClientFromEnv } = await import('@factory/arango-client')
        const db = createClientFromEnv(env)
        const pack = await db.queryOne<Record<string, unknown>>(
          `FOR mrp IN merge_readiness_packs
             FILTER mrp.id == @id
             LIMIT 1
             RETURN mrp`,
          { id },
        )

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

    return new Response('ff-pipeline: POST /trigger-synthesis, POST /synthesis-callback, POST /trigger-harness, or use Queue consumer', { status: 404 })
  },

  async scheduled(event: ScheduledEvent, env: PipelineEnv, ctx: ExecutionContext): Promise<void> {
    const { runGovernanceCycle } = await import('./agents/governor-agent.js')
    ctx.waitUntil(runGovernanceCycle(env, 'cron'))
  },

  async queue(batch: MessageBatch, env: PipelineEnv, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {

      // ── harness-queue: NLAH-driven stage dispatch (IS-HARNESS-DSL-v1 §3.1) ──
      // The dispatcher MUST NOT live on the RunCoordinator DO (self-fetch deadlock);
      // routing it through the index.ts queue handler keeps it on a separate Worker
      // module while reusing the established consumer wiring.
      if (batch.queue === 'harness-queue' || isHarnessQueueMessage(msg.body)) {
        try {
          const { dispatchOne, buildDefaultDispatcherDeps } = await import('./harness-dispatcher.js')
          const harnessEnv = env as unknown as import('./harness-env').HarnessBridgeEnv
          await dispatchOne(
            msg.body as import('./harness-env').HarnessQueueMessage,
            harnessEnv,
            buildDefaultDispatcherDeps(harnessEnv),
          )
          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          const body = msg.body as { runId?: string; stageName?: string }
          console.error(`[harness-dispatcher] dispatch failed for run=${body.runId} stage=${body.stageName}: ${errorMessage}`)
          if (msg.attempts >= 3) {
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: harness-queue message for ${body.runId}/${body.stageName} exhausted ${msg.attempts} attempts`)
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── feedback-signals queue: governor-cycle messages ──
      if (batch.queue === 'feedback-signals' && (msg.body as any).type === 'governor-cycle') {
        try {
          const { runGovernanceCycle } = await import('./agents/governor-agent.js')
          await runGovernanceCycle(env, 'feedback-complete')
          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Governor] Cycle failed: ${errorMessage}`)
          msg.ack() // Don't retry — next cron will handle it
        }
        continue
      }

      // ── feedback-signals queue: Factory PR outcome observations ──
      if (batch.queue === 'feedback-signals' && (msg.body as any).type === 'pr-outcome') {
        try {
          const { createClientFromEnv } = await import('@factory/arango-client')
          const { validateArtifact } = await import('@factory/artifact-validator')
          const { fetchPROutcomeFromGitHub, ingestPROutcomeSignals } = await import('./stages/pr-outcome-signal.js')

          const db = createClientFromEnv(env)
          db.setValidator(validateArtifact)

          const body = msg.body as {
            outcome?: import('./stages/pr-outcome-signal').PROutcomeInput
            pullNumber?: number
            lineage?: import('./stages/pr-outcome-signal').PROutcomeLineage
          }
          const outcome = body.outcome ?? await (async () => {
            if (!body.pullNumber || !body.lineage || !env.GITHUB_TOKEN) {
              throw new Error('Missing pr-outcome payload')
            }
            return fetchPROutcomeFromGitHub({
              githubToken: env.GITHUB_TOKEN,
              repoOwner: 'Wescome',
              repoName: 'function-factory',
              pullNumber: body.pullNumber,
              lineage: body.lineage,
            })
          })()

          const records = await ingestPROutcomeSignals(outcome, db as never)
          console.log(`[PR Outcome] Ingested ${records.length} signal(s) for PR #${outcome.pullRequest.number}`)
          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[PR Outcome] processing failed: ${errorMessage}`)
          if (msg.attempts >= 3) {
            console.error(`[PR Outcome] exhausted retries`)
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── synthesis-results queue: DO -> Queue -> Workflow sendEvent ──
      // The DO publishes to SYNTHESIS_RESULTS queue after synthesis completes.
      // This consumer relays the result to the Workflow, avoiding CF self-fetch deadlock.
      if (batch.queue === 'synthesis-results') {
        const body = msg.body as Record<string, unknown>

        // v5.1: phase1-complete messages are informational — ack and continue
        if (body.type === 'phase1-complete') {
          console.log(`[Agent Call execution] Phase 1 complete for ${body.executableSpecificationId}: ${body.atomCount} atoms in ${body.layerCount} layers`)
          msg.ack()
          continue
        }

        const { workflowId, verdict, tokenUsage, repairCount } = body as {
          workflowId: string
          verdict: { decision: string; confidence: number; reason: string }
          tokenUsage: number
          repairCount: number
        }
        try {
          const workflow = await env.FACTORY_PIPELINE.get(workflowId)
          await workflow.sendEvent({
            type: 'synthesis-complete',
            payload: { verdict, tokenUsage, repairCount },
          })
          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Agent Call execution] synthesis-results relay failed for workflow ${workflowId}: ${errorMessage}`)
          if (msg.attempts >= 4) {
            // max_retries: 3 = 4 total attempts. Give up and ack to prevent infinite retry.
            console.error(`[Agent Call execution] synthesis-results exhausted retries for workflow ${workflowId}`)
            // Tier 1 signal: infra:queue-retry-exhausted — synthesis-results dead letter
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: synthesis-results message for workflow ${workflowId} exhausted ${msg.attempts} attempts`)
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── atom-results queue: AtomExecutor DO completion → ledger update → Phase 3 ──
      if (batch.queue === 'atom-results') {
        const { executableSpecificationId, atomId, result, workflowId } = msg.body as {
          executableSpecificationId: string
          atomId: string
          result: {
            atomId: string
            verdict: { decision: string; confidence: number; reason: string }
            codeArtifact: unknown
            testReport: unknown
            critiqueReport: unknown
            retryCount: number
          }
          workflowId: string | null
        }

        try {
          // Lazy import to avoid circular deps at module level
          const { recordAtomResult, getReadyAtoms, isComplete } = await import('./coordinator/completion-ledger.js')
          const { createClientFromEnv } = await import('@factory/arango-client')
          const { validateArtifact } = await import('@factory/artifact-validator')

          const db = createClientFromEnv(env)
          db.setValidator(validateArtifact)

          // Record this atom's result in the completion ledger
          const ledger = await recordAtomResult(db as never, executableSpecificationId, atomId, result as never)
          console.log(`[Agent Call execution] Atom ${atomId} complete (${result.verdict.decision}) — ${ledger.completedAtoms}/${ledger.totalAtoms} atoms done`)

          // Check if dependent atoms are now ready to dispatch
          const readyAtoms = getReadyAtoms(ledger)
          if (readyAtoms.length > 0 && env.SYNTHESIS_QUEUE) {
            for (const readyAtomId of readyAtoms) {
              // Build upstream artifacts from completed atoms
              const upstreamArtifacts: Record<string, unknown> = {}
              const atomSpec = ledger.allAtomSpecs[readyAtomId]
              const deps = (atomSpec?.dependencies ?? []) as Array<{ atomId: string }>
              for (const dep of deps) {
                const upstreamResult = ledger.atomResults[dep.atomId]
                if (upstreamResult?.codeArtifact) {
                  upstreamArtifacts[dep.atomId] = upstreamResult.codeArtifact
                }
              }

              await (env.SYNTHESIS_QUEUE as unknown as { send(body: unknown): Promise<void> }).send({
                type: 'atom-execute',
                executableSpecificationId,
                workflowId: workflowId ?? ledger.workflowId,
                atomId: readyAtomId,
                atomSpec: ledger.allAtomSpecs[readyAtomId],
                sharedContext: ledger.sharedContext,
                upstreamArtifacts,
                maxRetries: 3,
                dryRun: false,
              })
              console.log(`[Agent Call execution] Dispatched dependent atom ${readyAtomId} (deps satisfied)`)
            }
          }

          // Check if ALL atoms are complete → run Phase 3
          if (isComplete(ledger)) {
            console.log(`[Agent Call execution] All ${ledger.totalAtoms} atoms complete — running Phase 3`)

            const atomResults = Object.values(ledger.atomResults)
            const allPassed = atomResults.every((r) => r.verdict.decision === 'pass')
            const failedAtoms = atomResults.filter((r) => r.verdict.decision !== 'pass')

            // Merge code artifacts
            const mergedFiles = atomResults.flatMap((r) => {
              const ca = r.codeArtifact
              return ca?.files ?? []
            })
            const totalRetries = atomResults.reduce((sum, r) => sum + (r.retryCount ?? 0), 0)

            // Check if any CRITICAL atom failed
            const criticalFailures = failedAtoms.filter((r) => {
              const spec = ledger.allAtomSpecs[r.atomId]
              return spec?.critical !== false  // default to critical if not specified
            })

            const passRate = atomResults.length > 0
              ? (atomResults.length - failedAtoms.length) / atomResults.length
              : 0

            const verdict = allPassed
              ? { decision: 'pass', confidence: 0.95, reason: `All ${atomResults.length} atoms passed` }
              : criticalFailures.length > 0
                ? {
                    decision: 'fail',
                    confidence: 0.9,
                    reason: `${criticalFailures.length} critical atom(s) failed: ${criticalFailures.map((a) => a.atomId).join(', ')}`,
                  }
                : passRate >= 0.7
                  ? { decision: 'pass', confidence: passRate, reason: `${atomResults.length - failedAtoms.length}/${atomResults.length} atoms passed (${failedAtoms.length} non-critical failed: ${failedAtoms.map((a) => a.atomId).join(', ')})` }
                  : {
                      decision: 'fail',
                      confidence: 0.8,
                      reason: `${failedAtoms.length}/${atomResults.length} atoms failed: ${failedAtoms.map((a) => a.atomId).join(', ')}`,
                    }

            console.log(`[Agent Call execution] Phase 3: ${allPassed ? 'PASS' : 'FAIL'} — ${atomResults.length} atoms, ${failedAtoms.length} failed`)

            // Send atoms-complete event directly to the Workflow so it receives
            // the final Phase 2+3 verdict (not just the Phase 1 "dispatched" result)
            const targetWorkflowId = workflowId ?? ledger.workflowId
            if (targetWorkflowId) {
              try {
                const workflow = await env.FACTORY_PIPELINE.get(targetWorkflowId)
                await workflow.sendEvent({
                  type: 'atoms-complete',
                  payload: {
                    verdict,
                    tokenUsage: 0,
                    repairCount: totalRetries,
                    atomResults: ledger.atomResults,
                    mergedFiles,
                  },
                })
              } catch (sendErr) {
                const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
                console.error(`[Agent Call execution] Failed to send atoms-complete event for workflow ${targetWorkflowId}: ${sendErrMsg}`)
                // Fall back to SYNTHESIS_RESULTS queue so the result isn't lost
                if (env.SYNTHESIS_RESULTS) {
                  await (env.SYNTHESIS_RESULTS as unknown as { send(body: unknown): Promise<void> }).send({
                    workflowId: targetWorkflowId,
                    verdict,
                    tokenUsage: 0,
                    repairCount: totalRetries,
                  })
                }
              }
            }
          }

          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Agent Call execution] atom-results processing failed for atom ${atomId}: ${errorMessage}`)
          // Tier 1 signal: infra:arango-connection-failure (console-only — DB may be down)
          console.error(`[INFRA SIGNAL] infra:arango-connection-failure: atom-results processing failed for atom ${atomId} in ${executableSpecificationId}: ${errorMessage}`)
          if (msg.attempts >= 4) {
            console.error(`[Agent Call execution] atom-results exhausted retries for atom ${atomId} in ${executableSpecificationId}`)
            // Tier 1 signal: infra:queue-retry-exhausted — atom-results dead letter
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: atom-results message for atom ${atomId} in ${executableSpecificationId} exhausted ${msg.attempts} attempts`)
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── feedback-signals queue: memory-curation messages ──
      if (batch.queue === 'feedback-signals' && (msg.body as any).type === 'memory-curation') {
        try {
          const { MemoryCuratorAgent } = await import('./agents/memory-curator-agent.js')
          const { keyForModel, resolveAgentModel } = await import('./agents/resolve-model.js')
          const { createClientFromEnv } = await import('@factory/arango-client')
          const { validateArtifact } = await import('@factory/artifact-validator')

          const db = createClientFromEnv(env)
          db.setValidator(validateArtifact)

          const model = resolveAgentModel('planning')
          const curator = new MemoryCuratorAgent({
            db,
            apiKey: keyForModel(model, env),
          })
          const curation = await curator.curate()
          const { written, errors } = await curator.persist(curation)
          console.log(`[MemoryCurator] Curated: ${curation.curated_lessons.length} lessons, ${curation.pattern_library_entries.length} patterns, ${written} written, ${errors.length} errors`)
          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[MemoryCurator] Curation failed: ${errorMessage}`)
          if (msg.attempts >= 3) {
            console.error(`[MemoryCurator] Exhausted retries`)
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── feedback-signals queue: synthesis results → new signals ──
      if (batch.queue === 'feedback-signals') {
        try {
          const { generateFeedbackSignals } = await import('./stages/generate-feedback.js')
          const { ingestSignal } = await import('./stages/ingest-signal.js')
          const { createClientFromEnv } = await import('@factory/arango-client')
          const { validateArtifact } = await import('@factory/artifact-validator')

          const db = createClientFromEnv(env)
          db.setValidator(validateArtifact)

          const ctx = msg.body as {
            result: Record<string, unknown>
            parentSignal: Record<string, unknown>
            parentFeedbackDepth: number
            dryRun?: boolean
          }

          if (ctx.dryRun === true) {
            console.log('[Feedback] Dry-run feedback message skipped')
            msg.ack()
            continue
          }

          const feedbackSignals = await generateFeedbackSignals(ctx, db as never)

          for (const fs of feedbackSignals) {
            // Ingest the feedback signal into the signals collection
            const ingested = await ingestSignal(fs.signal, db)
            console.log(`[Feedback] Ingested ${fs.signal.subtype} → ${ingested._key} (auto-approve: ${fs.autoApprove})`)

            // For auto-approve signals, create a new pipeline run immediately
            // Set autoApprove in signal.raw so pipeline skips architect-approval gate
            if (fs.autoApprove) {
              try {
                const autoSignal = {
                  ...fs.signal,
                  raw: { ...(fs.signal.raw ?? {}), autoApprove: true },
                }
                const created = await env.FACTORY_PIPELINE.create({
                  params: { signal: autoSignal },
                })
                console.log(`[Feedback] Auto-approved pipeline ${created.id} for ${fs.signal.subtype}`)
              } catch (createErr) {
                const createErrMsg = createErr instanceof Error ? createErr.message : String(createErr)
                console.error(`[Feedback] Failed to create pipeline for ${fs.signal.subtype}: ${createErrMsg}`)
              }
            }
          }

          // PR generation for pr-candidate signals
          // Audit trail: write to ArangoDB so we can observe without Worker logs
          try {
            await db.save('orl_telemetry', {
              schemaName: '_feedback_audit',
              success: true,
              failureMode: null,
              tier: 0,
              repairAttempts: 0,
              coercions: [],
              timestamp: new Date().toISOString(),
              feedbackSignalCount: feedbackSignals.length,
              hasGithubToken: !!env.GITHUB_TOKEN,
              subtypes: feedbackSignals.map(fs => fs.signal.subtype),
              hasAtomResults: !!ctx.result?.atomResults,
              atomResultKeys: ctx.result?.atomResults ? Object.keys(ctx.result.atomResults as object) : [],
            }).catch(() => {})
          } catch { /* audit is best-effort */ }
          console.log(`[Feedback] Checking ${feedbackSignals.length} signals for pr-candidate (GITHUB_TOKEN: ${!!env.GITHUB_TOKEN})`)
          if (!env.GITHUB_TOKEN) {
            console.error(`[INFRA SIGNAL] infra:missing-github-token: PR generation skipped — GITHUB_TOKEN not set`)
          }
          for (const fs of feedbackSignals) {
            console.log(`[Feedback] Signal: ${fs.signal.subtype}, autoApprove: ${fs.autoApprove}`)
            if (fs.signal.subtype === 'synthesis:pr-candidate' && !fs.autoApprove && env.GITHUB_TOKEN) {
              const feedbackBody = ctx as {
                result: Record<string, unknown>
              }
              const hasAtomResults = !!feedbackBody.result.atomResults
              const atomCount = hasAtomResults ? Object.keys(feedbackBody.result.atomResults as object).length : 0
              console.log(`[Feedback] PR generation triggered for ${fs.signal.title} (atomResults: ${hasAtomResults}, count: ${atomCount}, proposalId: ${feedbackBody.result.proposalId})`)
              try {
                const { generatePR } = await import('./stages/generate-pr.js')
                const result = await generatePR(
                  {
                    signalTitle: fs.signal.title,
                    proposalId: feedbackBody.result.proposalId as string,
                    executableSpecificationId: feedbackBody.result.executableSpecificationId as string,
                    atomResults: (feedbackBody.result.atomResults ?? {}) as Record<string, {
                      atomId: string
                      verdict: { decision: string }
                      codeArtifact: {
                        files: Array<{ path: string; action: 'create' | 'modify' | 'delete'; content?: string; edits?: Array<{ search: string; replace: string; scope?: string }> }>
                        summary: string
                      } | null
                    }>,
                    sourceRefs: fs.signal.sourceRefs ?? [],
                    confidence: (feedbackBody.result.synthesisResult as Record<string, unknown> | undefined)?.verdict
                      ? ((feedbackBody.result.synthesisResult as Record<string, unknown>).verdict as { confidence: number }).confidence
                      : 0,
                  },
                  env.GITHUB_TOKEN,
                  'Wescome',
                  'function-factory',
                )
                if (result.success) {
                  console.log(`[Feedback] PR created: ${result.prUrl} (${result.filesWritten} files)`)
                } else {
                  console.error(`[Feedback] PR generation failed: ${result.error}`)
                }
              } catch (prErr) {
                console.error(`[Feedback] PR generation error: ${prErr instanceof Error ? prErr.message : prErr}`)
              }
            }
          }

          // After all feedback signals processed, trigger memory curation
          await (env.FEEDBACK_QUEUE as any)?.send({ type: 'memory-curation', timestamp: new Date().toISOString() }).catch(() => {})

          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Feedback] feedback-signals processing failed: ${errorMessage}`)
          // Tier 1 signal: infra:arango-connection-failure (console-only — DB may be down)
          console.error(`[INFRA SIGNAL] infra:arango-connection-failure: feedback-signals processing failed: ${errorMessage}`)
          if (msg.attempts >= 3) {
            console.error(`[Feedback] feedback-signals exhausted retries`)
            // Tier 1 signal: infra:queue-retry-exhausted — feedback-signals dead letter
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: feedback-signals message exhausted ${msg.attempts} attempts`)
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── synthesis-queue: dispatch work ──
      const body = msg.body as Record<string, unknown>

      // v5.1: atom-execute messages — dispatch to AtomExecutor DO
      if (body.type === 'atom-execute') {
        const { executableSpecificationId, workflowId, atomId, atomSpec, sharedContext, upstreamArtifacts, maxRetries, dryRun } = body as {
          executableSpecificationId: string
          workflowId: string
          atomId: string
          atomSpec: Record<string, unknown>
          sharedContext: Record<string, unknown>
          upstreamArtifacts: Record<string, unknown>
          maxRetries: number
          dryRun: boolean
        }

        try {
          const doId = env.ATOM_EXECUTOR.idFromName(`atom-${executableSpecificationId}-${atomId}`)
          const stub = env.ATOM_EXECUTOR.get(doId)
          const doPayload = JSON.stringify({
            atomId, atomSpec, sharedContext, upstreamArtifacts,
            workflowId, executableSpecificationId, maxRetries: maxRetries ?? 3, dryRun: dryRun ?? false,
          })

          // In-process retry: absorb transient DO connectivity blips before burning a queue retry
          let lastDispatchErr: Error | null = null
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await stub.fetch(new Request('https://do/execute-atom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: doPayload,
              }))
              lastDispatchErr = null
              break
            } catch (fetchErr) {
              lastDispatchErr = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr))
              if (attempt < 1) await new Promise(r => setTimeout(r, 3000))
            }
          }
          if (lastDispatchErr) throw lastDispatchErr

          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Agent Call execution] atom-execute dispatch failed for atom ${atomId}: ${errorMessage}`)
          if (msg.attempts >= 6) {
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: atom-execute dispatch for atom ${atomId} in ${executableSpecificationId} exhausted ${msg.attempts} attempts`)
            // Structured signal to ArangoDB so Governor can see dispatch failures
            try {
              const { ingestSignal } = await import('./stages/ingest-signal.js')
              const { createClientFromEnv } = await import('@factory/arango-client')
              const db = createClientFromEnv(env)
              await ingestSignal({
                signalType: 'internal',
                source: 'factory:infrastructure',
                subtype: 'infra:atom-dispatch-failure',
                title: `Atom ${atomId} dispatch failed after ${msg.attempts} attempts`,
                description: `Queue consumer could not reach AtomExecutor DO for atom ${atomId} in ExecutableSpecification ${executableSpecificationId}: ${errorMessage}`,
                sourceRefs: [executableSpecificationId],
              }, db).catch(() => {})
            } catch { /* best-effort */ }
            // Publish failure result to atom-results queue so ledger is updated
            try {
              if (env.ATOM_RESULTS) {
                await (env.ATOM_RESULTS as unknown as { send(body: unknown): Promise<void> }).send({
                  executableSpecificationId, atomId,
                  result: {
                    atomId,
                    verdict: { decision: 'fail', confidence: 1.0, reason: `Atom dispatch failed after ${msg.attempts} attempts: ${errorMessage}` },
                    codeArtifact: null, testReport: null, critiqueReport: null, retryCount: 0,
                  },
                  workflowId,
                })
              }
            } catch (pubErr) {
              console.error(`[Agent Call execution] Failed to publish atom failure for ${atomId}: ${pubErr instanceof Error ? pubErr.message : String(pubErr)}`)
            }
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── synthesis-queue: original coordinator dispatch ──
      const { workflowId, executableSpecificationId, executableSpecification, trellisExecutionPacket, dryRun, specContent } = body as {
        workflowId: string
        executableSpecificationId: string
        executableSpecification: Record<string, unknown>
        trellisExecutionPacket: Record<string, unknown>
        dryRun?: boolean
        specContent?: string
      }

      try {
        if (!trellisExecutionPacket) {
          throw new Error('trellisExecutionPacket is required for synthesis queue dispatch')
        }
        // Fire-and-forget: dispatch to DO with workflowId, then ack immediately.
        // The DO publishes results to SYNTHESIS_RESULTS queue on completion.
        // This eliminates the queue visibility timeout problem (CF Queues ~30s).
        const doId = env.COORDINATOR.idFromName(`synth-${executableSpecificationId}`)
        const stub = env.COORDINATOR.get(doId)
        await stub.fetch(new Request('https://do/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            executableSpecification,
            trellisExecutionPacket,
            dryRun: dryRun ?? false,
            workflowId,
            ...(specContent ? { specContent } : {}),
          }),
        }))

        // DO accepted the request — ack immediately.
        // DO will publish to SYNTHESIS_RESULTS queue on completion.
        msg.ack()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        // max_retries: 2 in wrangler config = 3 total attempts (1 initial + 2 retries)
        if (msg.attempts >= 3) {
          // Max retries exhausted — send failure event so Workflow doesn't hang.
          // This only fires if the initial dispatch to the DO fails (not synthesis).
          try {
            const workflow = await env.FACTORY_PIPELINE.get(workflowId)
            await workflow.sendEvent({
              type: 'synthesis-complete',
              payload: {
                verdict: { decision: 'fail', confidence: 1.0, reason: `Queue dispatch error after ${msg.attempts} attempts: ${errorMessage}` },
                tokenUsage: 0,
                repairCount: 0,
              },
            })
          } catch (sendErr) {
            const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
            console.error(`Failed to send failure event for workflow ${workflowId}: sendEvent error: ${sendErrMsg} (original error: ${errorMessage})`)
          }
          // Tier 1 signal: infra:queue-retry-exhausted — synthesis-queue coordinator dispatch dead letter
          console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: synthesis-queue dispatch for workflow ${workflowId} (executableSpecification ${executableSpecificationId}) exhausted ${msg.attempts} attempts: ${errorMessage}`)
          msg.ack() // Remove from queue even though dispatch failed
        } else {
          msg.retry()
        }
      }
    }
  },
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function checkArango(env: PipelineEnv): Promise<boolean> {
  try {
    const { createClientFromEnv } = await import('@factory/arango-client')
    const db = createClientFromEnv(env)
    return await db.ping()
  } catch {
    return false
  }
}
