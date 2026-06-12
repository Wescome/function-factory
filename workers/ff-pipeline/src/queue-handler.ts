/**
 * CF Queue consumer handler for the ff-pipeline worker.
 *
 * Extracted from index.ts so it can be unit-tested without importing the
 * worker barrel (index.ts), which statically re-exports Durable Object and
 * Workflow classes from `@factory/gears` / `@factory/factory-graph`.
 * Those pull in `@flue/runtime/cloudflare`, whose `.mjs` statically imports
 * `cloudflare:*` protocol modules that Node's ESM loader rejects
 * (ERR_UNSUPPORTED_ESM_URL_SCHEME).
 *
 * This module keeps a CLEAN import graph: the only static imports are
 * type-only (erased at compile time). Every runtime dependency is loaded
 * lazily via `await import(...)` inside the message-handling branches, so
 * importing this module does not touch `@factory/gears`, `@flue/runtime`,
 * `@cloudflare/sandbox`, or any `cloudflare:*` module.
 */

import type { PipelineEnv } from './types'

/**
 * True when a queue message is a stale harness-shaped payload from the
 * pre-Gas-City era (a `runId` + `stageName` with no workflow/spec/type fields).
 * Such messages are acknowledged and dropped.
 */
export function isRemovedHarnessQueueMessage(body: unknown): boolean {
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

/**
 * Cloudflare Queue consumer. Routes by `batch.queue` and message shape:
 *   - telemetry-queue / telemetry-dlq → telemetry consumer
 *   - harness-dlq / harness-queue / stale harness messages → ack + drop
 *   - feedback-signals → governor cycle / pr-outcome / memory-curation / signals
 *   - synthesis-results → relay DO verdict to Workflow.sendEvent
 *   - atom-results → completion ledger + Phase 3
 *   - synthesis-queue → atom-execute dispatch + coordinator dispatch
 */
export async function queueHandler(
  batch: MessageBatch,
  env: PipelineEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (batch.queue === 'telemetry-queue' || batch.queue === 'telemetry-dlq') {
    const { handleTelemetryBatch } = await import('./observability/telemetry-consumer.js')
    await handleTelemetryBatch(batch, env, ctx)
    return
  }

  for (const msg of batch.messages) {
    if (batch.queue === 'harness-dlq' || batch.queue === 'harness-queue' || isRemovedHarnessQueueMessage(msg.body)) {
      console.warn(`[queue] ${batch.queue ?? 'harness-shaped-message'} is removed in the Gas City era; acknowledging stale message`)
      msg.ack()
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
        const { createClientFromEnv } = await import('@factory/db-client')
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
        const { createClientFromEnv } = await import('@factory/db-client')
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
        const { createClientFromEnv } = await import('@factory/db-client')
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
        const { createClientFromEnv } = await import('@factory/db-client')
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
            hasGithubApp: !!env.GITHUB_APP_ID && !!env.GITHUB_APP_PRIVATE_KEY,
            subtypes: feedbackSignals.map(fs => fs.signal.subtype),
            hasAtomResults: !!ctx.result?.atomResults,
            atomResultKeys: ctx.result?.atomResults ? Object.keys(ctx.result.atomResults as object) : [],
          }).catch(() => {})
        } catch { /* audit is best-effort */ }
        const hasGithubApp = !!env.GITHUB_APP_ID && !!env.GITHUB_APP_PRIVATE_KEY
        console.log(`[Feedback] Checking ${feedbackSignals.length} signals for pr-candidate (GITHUB_APP: ${hasGithubApp})`)
        if (!hasGithubApp) {
          console.error(`[INFRA SIGNAL] infra:missing-github-app-secret: PR generation skipped — GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY not set`)
        }
        for (const fs of feedbackSignals) {
          console.log(`[Feedback] Signal: ${fs.signal.subtype}, autoApprove: ${fs.autoApprove}`)
          if (fs.signal.subtype === 'synthesis:pr-candidate' && !fs.autoApprove && hasGithubApp) {
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
                  runId: (feedbackBody.result.runId ?? feedbackBody.result.workflowId ?? feedbackBody.result.proposalId ?? 'unknown') as string,
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
                  ...(feedbackBody.result.issueContract || feedbackBody.result.issueContractArtifact || fs.signal.raw?.issueContract ? { issueContract: (feedbackBody.result.issueContract ?? feedbackBody.result.issueContractArtifact ?? fs.signal.raw?.issueContract) as { targetRepo?: string } } : {}),
                },
                env,
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
            const { createClientFromEnv } = await import('@factory/db-client')
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
}
