export { FactoryPipeline } from './pipeline'
export { SynthesisCoordinator } from './coordinator'
export { AtomExecutor } from './coordinator/atom-executor-do'
export { Sandbox } from '@cloudflare/sandbox'

export { ingestSignal } from './stages/ingest-signal'
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

import type { PipelineEnv } from './types'

export default {
  async fetch(request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // ── Synthesis trigger: external route that bridges Workflow <-> DO ──
    if (url.pathname === '/trigger-synthesis' && request.method === 'POST') {
      const body = await request.json() as {
        workflowId?: string
        workGraphId?: string
        workGraph?: Record<string, unknown>
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

    return new Response('ff-pipeline: POST /trigger-synthesis, POST /synthesis-callback, or use Queue consumer', { status: 404 })
  },

  async queue(batch: MessageBatch, env: PipelineEnv, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {

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
            const allPassed = atomResults.every((r: Record<string, unknown>) => {
              const v = r.verdict as Record<string, unknown>
              return v.decision === 'pass'
            })
            const failedAtoms = atomResults.filter((r: Record<string, unknown>) => {
              const v = r.verdict as Record<string, unknown>
              return v.decision !== 'pass'
            })

            // Merge code artifacts
            const mergedFiles = atomResults.flatMap((r: Record<string, unknown>) => {
              const ca = r.codeArtifact as Record<string, unknown> | null
              return (ca?.files as unknown[] ?? [])
            })
            const totalRetries = atomResults.reduce((sum: number, r: Record<string, unknown>) => sum + (r.retryCount as number ?? 0), 0)

            const verdict = allPassed
              ? { decision: 'pass', confidence: 0.9, reason: `All ${atomResults.length} atoms passed` }
              : {
                  decision: 'fail',
                  confidence: 0.8,
                  reason: `${failedAtoms.length}/${atomResults.length} atoms failed: ${failedAtoms.map((a: Record<string, unknown>) => a.atomId).join(', ')}`,
                }

            console.log(`[Stage 6] Phase 3: ${allPassed ? 'PASS' : 'FAIL'} — ${atomResults.length} atoms, ${failedAtoms.length} failed`)

            // Publish final result to SYNTHESIS_RESULTS queue
            const targetWorkflowId = workflowId ?? ledger.workflowId
            if (targetWorkflowId && env.SYNTHESIS_RESULTS) {
              await (env.SYNTHESIS_RESULTS as unknown as { send(body: unknown): Promise<void> }).send({
                workflowId: targetWorkflowId,
                verdict,
                tokenUsage: 0,
                repairCount: totalRetries,
              })
            }
          }

          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Stage 6] atom-results processing failed for atom ${atomId}: ${errorMessage}`)
          if (msg.attempts >= 4) {
            console.error(`[Stage 6] atom-results exhausted retries for atom ${atomId} in ${workGraphId}`)
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
          await stub.fetch(new Request('https://do/execute-atom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              atomId,
              atomSpec,
              sharedContext,
              upstreamArtifacts,
              workflowId,
              workGraphId,
              maxRetries: maxRetries ?? 3,
              dryRun: dryRun ?? false,
            }),
          }))
          msg.ack()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error(`[Stage 6] atom-execute dispatch failed for atom ${atomId}: ${errorMessage}`)
          if (msg.attempts >= 3) {
            // Publish failure result to atom-results queue so ledger is updated
            try {
              if (env.ATOM_RESULTS) {
                await (env.ATOM_RESULTS as unknown as { send(body: unknown): Promise<void> }).send({
                  workGraphId,
                  atomId,
                  result: {
                    atomId,
                    verdict: { decision: 'fail', confidence: 1.0, reason: `Atom dispatch failed after ${msg.attempts} attempts: ${errorMessage}` },
                    codeArtifact: null,
                    testReport: null,
                    critiqueReport: null,
                    retryCount: 0,
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
          msg.ack() // Remove from queue even though dispatch failed
        } else {
          msg.retry()
        }
      }
    }
  },
}
