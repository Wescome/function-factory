export { FactoryPipeline } from './pipeline'
export { SynthesisCoordinator } from './coordinator'
export { AtomExecutor } from './coordinator/atom-executor-do'
export { Sandbox } from '@cloudflare/sandbox'

export { ingestSignal } from './stages/ingest-signal'
export { generateFeedbackSignals } from './stages/generate-feedback'
export { generatePR } from './stages/generate-pr'
export { synthesizePressure } from './stages/synthesize-pressure'
export { mapCapability } from './stages/map-capability'
export { proposeFunction } from './stages/propose-function'
export { semanticReview } from './stages/semantic-review'
export { compilePRD, PASS_NAMES } from './stages/compile'

export { callModel } from './model-bridge'

export type {
  PipelineEnv,
  PipelineParams,
  PipelineResult,
  SignalInput,
  Gate1Report,
  SemanticReviewResult,
} from './types'

export type {
  FeedbackContext,
  FeedbackSignal,
} from './stages/generate-feedback'

import type { PipelineEnv } from './types'

export default {
  async fetch(request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // ── Synthesis trigger: external route that bridges Workflow <-> DO ──
    if (url.pathname === '/trigger-synthesis' && request.method === 'POST') {
      const body = await request.json() as {
        workflowId?: string
        workGraphId?: string
        workGraph?: import('./coordinator/state').PipelineWorkGraph
        dryRun?: boolean
      }

      if (!body.workflowId || !body.workGraphId || !body.workGraph) {
        return new Response(JSON.stringify({ error: 'Missing required fields: workflowId, workGraphId, workGraph' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Fire-and-forget: DO work + event sending happens in background
      const workflow = await env.FACTORY_PIPELINE.get(body.workflowId)
      const workGraphId = body.workGraphId
      const workGraph = body.workGraph
      const dryRun = body.dryRun ?? false

      ctx.waitUntil((async () => {
        try {
          const doId = env.COORDINATOR.idFromName(`synth-${workGraphId}`)
          const stub = env.COORDINATOR.get(doId)
          const doResponse = await stub.fetch(new Request('https://do/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workGraph, dryRun }),
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

      return new Response(JSON.stringify({ accepted: true, workGraphId }), {
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
        console.error(`[Stage 6] /synthesis-callback error: ${errorMessage}`)
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
            workGraphId: output.workGraphId as string ?? 'unknown',
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

    return new Response('ff-pipeline: POST /trigger-synthesis, POST /synthesis-callback, or use Queue consumer', { status: 404 })
  },

  async scheduled(event: ScheduledEvent, env: PipelineEnv, ctx: ExecutionContext): Promise<void> {
    const { runGovernanceCycle } = await import('./agents/governor-agent.js')
    ctx.waitUntil(runGovernanceCycle(env, 'cron'))
  },

  async queue(batch: MessageBatch, env: PipelineEnv, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {

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

      // ── synthesis-results queue: DO -> Queue -> Workflow sendEvent ──
      // The DO publishes to SYNTHESIS_RESULTS queue after synthesis completes.
      // This consumer relays the result to the Workflow, avoiding CF self-fetch deadlock.
      if (batch.queue === 'synthesis-results') {
        const body = msg.body as Record<string, unknown>

        // v5.1: phase1-complete messages are informational — ack and continue
        if (body.type === 'phase1-complete') {
          console.log(`[Stage 6] Phase 1 complete for ${body.workGraphId}: ${body.atomCount} atoms in ${body.layerCount} layers`)
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
          console.error(`[Stage 6] synthesis-results relay failed for workflow ${workflowId}: ${errorMessage}`)
          if (msg.attempts >= 4) {
            // max_retries: 3 = 4 total attempts. Give up and ack to prevent infinite retry.
            console.error(`[Stage 6] synthesis-results exhausted retries for workflow ${workflowId}`)
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
        const { workGraphId, atomId, result, workflowId } = msg.body as {
          workGraphId: string
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
          const ledger = await recordAtomResult(db as never, workGraphId, atomId, result as never)
          console.log(`[Stage 6] Atom ${atomId} complete (${result.verdict.decision}) — ${ledger.completedAtoms}/${ledger.totalAtoms} atoms done`)

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
                workGraphId,
                workflowId: workflowId ?? ledger.workflowId,
                atomId: readyAtomId,
                atomSpec: ledger.allAtomSpecs[readyAtomId],
                sharedContext: ledger.sharedContext,
                upstreamArtifacts,
                maxRetries: 3,
                dryRun: false,
              })
              console.log(`[Stage 6] Dispatched dependent atom ${readyAtomId} (deps satisfied)`)
            }
          }

          // Check if ALL atoms are complete → run Phase 3
          if (isComplete(ledger)) {
            console.log(`[Stage 6] All ${ledger.totalAtoms} atoms complete — running Phase 3`)

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

            console.log(`[Stage 6] Phase 3: ${allPassed ? 'PASS' : 'FAIL'} — ${atomResults.length} atoms, ${failedAtoms.length} failed`)

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
                console.error(`[Stage 6] Failed to send atoms-complete event for workflow ${targetWorkflowId}: ${sendErrMsg}`)
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
          console.error(`[Stage 6] atom-results processing failed for atom ${atomId}: ${errorMessage}`)
          // Tier 1 signal: infra:arango-connection-failure (console-only — DB may be down)
          console.error(`[INFRA SIGNAL] infra:arango-connection-failure: atom-results processing failed for atom ${atomId} in ${workGraphId}: ${errorMessage}`)
          if (msg.attempts >= 4) {
            console.error(`[Stage 6] atom-results exhausted retries for atom ${atomId} in ${workGraphId}`)
            // Tier 1 signal: infra:queue-retry-exhausted — atom-results dead letter
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: atom-results message for atom ${atomId} in ${workGraphId} exhausted ${msg.attempts} attempts`)
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
                    workGraphId: feedbackBody.result.workGraphId as string,
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
        const { workGraphId, workflowId, atomId, atomSpec, sharedContext, upstreamArtifacts, maxRetries, dryRun } = body as {
          workGraphId: string
          workflowId: string
          atomId: string
          atomSpec: Record<string, unknown>
          sharedContext: Record<string, unknown>
          upstreamArtifacts: Record<string, unknown>
          maxRetries: number
          dryRun: boolean
        }

        try {
          const doId = env.ATOM_EXECUTOR.idFromName(`atom-${workGraphId}-${atomId}`)
          const stub = env.ATOM_EXECUTOR.get(doId)
          const doPayload = JSON.stringify({
            atomId, atomSpec, sharedContext, upstreamArtifacts,
            workflowId, workGraphId, maxRetries: maxRetries ?? 3, dryRun: dryRun ?? false,
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
          console.error(`[Stage 6] atom-execute dispatch failed for atom ${atomId}: ${errorMessage}`)
          if (msg.attempts >= 6) {
            console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: atom-execute dispatch for atom ${atomId} in ${workGraphId} exhausted ${msg.attempts} attempts`)
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
                description: `Queue consumer could not reach AtomExecutor DO for atom ${atomId} in WorkGraph ${workGraphId}: ${errorMessage}`,
                sourceRefs: [workGraphId],
              }, db).catch(() => {})
            } catch { /* best-effort */ }
            // Publish failure result to atom-results queue so ledger is updated
            try {
              if (env.ATOM_RESULTS) {
                await (env.ATOM_RESULTS as unknown as { send(body: unknown): Promise<void> }).send({
                  workGraphId, atomId,
                  result: {
                    atomId,
                    verdict: { decision: 'fail', confidence: 1.0, reason: `Atom dispatch failed after ${msg.attempts} attempts: ${errorMessage}` },
                    codeArtifact: null, testReport: null, critiqueReport: null, retryCount: 0,
                  },
                  workflowId,
                })
              }
            } catch (pubErr) {
              console.error(`[Stage 6] Failed to publish atom failure for ${atomId}: ${pubErr instanceof Error ? pubErr.message : String(pubErr)}`)
            }
            msg.ack()
          } else {
            msg.retry()
          }
        }
        continue
      }

      // ── synthesis-queue: original coordinator dispatch ──
      const { workflowId, workGraphId, workGraph, dryRun, specContent } = body as {
        workflowId: string
        workGraphId: string
        workGraph: Record<string, unknown>
        dryRun?: boolean
        specContent?: string
      }

      try {
        // Fire-and-forget: dispatch to DO with workflowId, then ack immediately.
        // The DO publishes results to SYNTHESIS_RESULTS queue on completion.
        // This eliminates the queue visibility timeout problem (CF Queues ~30s).
        const doId = env.COORDINATOR.idFromName(`synth-${workGraphId}`)
        const stub = env.COORDINATOR.get(doId)
        await stub.fetch(new Request('https://do/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workGraph,
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
          console.error(`[INFRA SIGNAL] infra:queue-retry-exhausted: synthesis-queue dispatch for workflow ${workflowId} (workGraph ${workGraphId}) exhausted ${msg.attempts} attempts: ${errorMessage}`)
          msg.ack() // Remove from queue even though dispatch failed
        } else {
          msg.retry()
        }
      }
    }
  },
}
