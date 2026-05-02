import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { createClientFromEnv } from '@factory/arango-client'
import { validateArtifact } from '@factory/artifact-validator'
import { ingestSignal } from './stages/ingest-signal'
import { synthesizePressure } from './stages/synthesize-pressure'
import { mapCapability } from './stages/map-capability'
import { proposeFunction } from './stages/propose-function'
import { semanticReview } from './stages/semantic-review'
import { compilePRD, PASS_NAMES } from './stages/compile'
import { crystallizeIntent, type IntentAnchor } from './stages/crystallize-intent'
import { probeAnchors } from './stages/intent-probe'
import { reconcile } from './stages/reconciliation-gate'
import { appendDriftEntry } from './stages/drift-ledger'
import { createCRP } from './crp'
import { transitionLifecycle } from './lifecycle'
import type { PipelineEnv, PipelineParams, PipelineResult, SemanticReviewResult, Gate1Report } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>

function toStep(obj: Record<string, unknown>): Rec {
  return JSON.parse(JSON.stringify(obj)) as Rec
}

/**
 * C2 resolution: extract only the fields added by the current pass.
 * The probe receives the delta, not the full accumulated state.
 */
function computeDelta(
  prevState: Record<string, unknown>,
  newState: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {}
  for (const key of Object.keys(newState)) {
    // Skip internal sentinel fields
    if (key.startsWith('_')) continue
    // Include fields that are new or changed
    if (!(key in prevState) || JSON.stringify(prevState[key]) !== JSON.stringify(newState[key])) {
      delta[key] = newState[key]
    }
  }
  return delta
}

export class FactoryPipeline extends WorkflowEntrypoint<PipelineEnv, PipelineParams> {

  override async run(
    event: WorkflowEvent<PipelineParams>,
    step: WorkflowStep,
  ): Promise<PipelineResult> {

    const db = createClientFromEnv(this.env)
    db.setValidator(validateArtifact)
    const params = event.payload
    const dryRun = params.dryRun ?? false

    // ── Stage 1: Signal ingestion ──
    const signal = await step.do('ingest-signal', async () => {
      return toStep(await ingestSignal(params.signal, db))
    })
    const signalKey = signal._key as string

    // ── Stage 2: Pressure synthesis ──
    const pressure = await step.do('synthesize-pressure', async () => {
      return toStep(await synthesizePressure(signal as Record<string, unknown>, db, this.env, dryRun))
    })
    const pressureKey = pressure._key as string

    // Lineage: Pressure → Signal
    await step.do('edge-pressure-signal', async () => {
      await db.saveEdge('lineage_edges', `specs_pressures/${pressureKey}`, `specs_signals/${signalKey}`, {
        type: 'derived-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Stage 3: Capability mapping ──
    const capability = await step.do('map-capability', async () => {
      return toStep(await mapCapability(pressure as Record<string, unknown>, db, this.env, dryRun))
    })
    const capabilityKey = capability._key as string

    // Lineage: Capability → Pressure
    await step.do('edge-capability-pressure', async () => {
      await db.saveEdge('lineage_edges', `specs_capabilities/${capabilityKey}`, `specs_pressures/${pressureKey}`, {
        type: 'derived-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Stage 4: Function proposal ──
    const proposal = await step.do('propose-function', async () => {
      return toStep(await proposeFunction(capability as Record<string, unknown>, db, this.env, dryRun))
    })
    const proposalKey = proposal._key as string

    // Lineage: Proposal → Capability
    await step.do('edge-proposal-capability', async () => {
      await db.saveEdge('lineage_edges', `specs_functions/${proposalKey}`, `specs_capabilities/${capabilityKey}`, {
        type: 'derived-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Phase D: Lifecycle → proposed ──
    await step.do('lifecycle-proposed', async () => {
      await transitionLifecycle(db, proposalKey, 'proposed', {
        trigger: 'pipeline-propose-function',
      }).catch((err: unknown) => {
        console.warn(`[lifecycle] Failed to set proposed: ${err instanceof Error ? err.message : err}`)
      })
      return { ok: true }
    })

    // ── Architect approval ──
    // Feedback-generated retries (autoApprove in signal.raw) skip the human gate
    const isAutoApproved = !!(params.signal as unknown as Record<string, unknown>).raw
      && ((params.signal as unknown as Record<string, unknown>).raw as Record<string, unknown>)?.autoApprove === true

    let approvalPayload: { decision?: string; reason?: string; by?: string } | undefined

    if (isAutoApproved) {
      approvalPayload = { decision: 'approved', reason: 'auto-approved feedback retry', by: 'factory:feedback-loop' }
    } else {
      const approval = await step.waitForEvent<{ decision: string; reason?: string; by?: string }>(
        'architect-approval',
        { type: 'architect-approval', timeout: '7 days' },
      )
      approvalPayload = approval.payload as typeof approvalPayload
    }

    if (approvalPayload?.decision !== 'approved') {
      await step.do('persist-rejection', async () => {
        await db.save('specs_coverage_reports', {
          _key: `CR-REJECT-${signalKey}-${Date.now().toString(36)}`,
          type: 'architect-rejection',
          passed: false,
          signalId: signalKey,
          reason: approvalPayload?.reason ?? 'no reason given',
          rejectedBy: approvalPayload?.by ?? 'unknown',
          sourceRefs: [`SIG:${signalKey}`],
          timestamp: new Date().toISOString(),
        })
        return { persisted: true }
      })
      return {
        status: 'rejected',
        reason: approvalPayload?.reason ?? 'Architect declined',
        signalId: signalKey,
      }
    }

    // ── Semantic review (Critic-at-authoring, pre-compile) ──
    const review = await step.do('semantic-review', async () => {
      const result = await semanticReview(proposal as Record<string, unknown>, db, this.env, dryRun)
      return toStep(result as unknown as Record<string, unknown>) as unknown as SemanticReviewResult
    }) as unknown as SemanticReviewResult

    // ── Phase D: CRP on low-confidence semantic review (C7) ──
    const reviewConfidence = (review as unknown as { confidence?: number }).confidence
    if (typeof reviewConfidence === 'number' && reviewConfidence < 0.7) {
      await step.do('crp-semantic-review', async () => {
        await createCRP(db, {
          artifactKey: proposalKey,
          collection: 'specs_functions',
          confidence: reviewConfidence,
          context: `Semantic review alignment: ${review.alignment}`,
          agentRole: 'critic',
          workGraphId: proposalKey,
        })
        return { ok: true }
      })
    }

    if (review.alignment === 'miscast') {
      // Log the miscast but continue — the semantic review is advisory during bootstrap.
      // Gate 1 is the structural gate. The Critic catches drift from Stage 2-4 reframing.
      // TODO: make this configurable via hot-config (strict mode vs advisory mode)
      console.warn(`[Pipeline] Semantic review: miscast (${review.rationale?.slice(0, 100)}). Continuing to compilation.`)
    }

    // ── Crystallize signal intent into binary anchors ──
    // Hot-config flag: crystallizer.enabled (default false for Phase 1)
    // When disabled or on error, returns empty anchors — zero behavior change
    const crystallizerEnabled = true // Flag ON for testing — read from hot-config when HotConfigLoader is wired
    const crystallization = await step.do('crystallize-intent', async () => {
      const result = await crystallizeIntent(
        {
          signalId: signalKey,
          title: signal.title as string,
          description: signal.description as string,
          specContent: typeof params.signal.specContent === 'string'
            ? params.signal.specContent
            : undefined,
        },
        this.env,
        dryRun,
        crystallizerEnabled,
      )
      return toStep(result as unknown as Record<string, unknown>)
    })

    const intentAnchors = (crystallization.anchors ?? []) as IntentAnchor[]

    // Persist anchors to ArangoDB for drift ledger analysis (Phase 3)
    if (intentAnchors.length > 0) {
      await step.do('persist-intent-anchors', async () => {
        await db.ensureCollection('intent_anchors').catch(() => {})
        for (const anchor of intentAnchors) {
          await db.save('intent_anchors', anchor as unknown as Record<string, unknown>).catch(() => {})
        }
        return { persisted: intentAnchors.length }
      })
    }

    // ── Stage 5: PRD compilation (8 passes) with inter-pass probing ──
    //
    // C1+SE-1 resolution: probed passes (decompose, dependency, invariant) run
    // a compile-verify loop with distinct step names per remediation attempt.
    // CF Workflows deduplicates by step name, so replayed steps return cached results.
    //
    // Non-probed passes (interface, binding, validation, assembly, verification)
    // use the existing simple pattern.
    const PROBED_PASSES = ['decompose', 'dependency', 'invariant']
    const MAX_REMEDIATION = 2

    let compState: Record<string, unknown> = {
      prd: proposal.prd,
      intentAnchors,
      workGraph: null,
    }

    let intentViolation = false

    for (const passName of PASS_NAMES) {
      if (PROBED_PASSES.includes(passName) && intentAnchors.length > 0) {
        // ── Probed pass: compile -> compute delta -> probe -> gate ──
        for (let r = 0; r <= MAX_REMEDIATION; r++) {
          const prevState = compState
          compState = await step.do(`compile-verify-${passName}-r${r}`, async () => {
            // Compile the pass
            const newState = toStep(await compilePRD(passName, prevState, db, this.env, dryRun))

            // Compute delta: only the fields added by this pass (C2)
            const delta = computeDelta(prevState, newState)
            const deltaStr = JSON.stringify(delta)

            // Probe the delta against intent anchors (isolated LLM call)
            const probeStart = Date.now()
            const probeResults = await probeAnchors(deltaStr, intentAnchors, this.env, dryRun)
            const probeLatency = Date.now() - probeStart

            // Gate: pure deterministic decision
            const gate = reconcile(probeResults, intentAnchors, r, MAX_REMEDIATION)

            // Phase 3: Drift ledger — best-effort, never blocks
            await appendDriftEntry({
              pipeline_id: event.instanceId,
              signal_id: signalKey,
              pass_name: passName,
              anchors_probed: intentAnchors.map(a => a.id),
              probe_results: probeResults,
              gate_verdict: gate.verdict,
              remediation_count: r,
              probe_model: 'llama-70b',
              latency_ms: probeLatency,
              timestamp: new Date().toISOString(),
            }, db).catch(() => {})

            if (gate.verdict === 'pass' || gate.verdict === 'warn') {
              return { ...newState, _gateVerdict: gate.verdict }
            }
            if (gate.verdict === 'escalate') {
              return {
                ...newState,
                _gateVerdict: 'escalate',
                _violatedAnchors: gate.violated_anchors,
              }
            }
            // verdict === 'remediate': return with remediate flag
            // Next iteration of the r-loop will run with r+1
            return { ...newState, _gateVerdict: 'remediate' }
          }) as unknown as Record<string, unknown>

          // Break out of remediation loop if not remediating
          if ((compState as Rec)._gateVerdict !== 'remediate') break
        }

        // Check for escalation -> break out of pass loop
        if ((compState as Rec)._gateVerdict === 'escalate') {
          intentViolation = true
          break
        }
      } else {
        // ── Non-probed pass: simple compile ──
        const prevState = compState
        compState = await step.do(`compile-${passName}`, async () => {
          return toStep(await compilePRD(passName, prevState, db, this.env, dryRun))
        }) as unknown as Record<string, unknown>
      }
    }

    // SE-2: Handle intent-violation escalation
    if (intentViolation) {
      return {
        status: 'synthesis:intent-violation',
        signalId: signalKey,
        reason: `Block-severity intent anchors violated after ${MAX_REMEDIATION} remediation attempts. Violated anchors: ${((compState as Rec)._violatedAnchors ?? []).join(', ')}`,
      }
    }

    const wgKey = (compState.workGraph as { _key?: string })?._key ?? 'unknown'

    // ── Phase D: Lifecycle → designed (after compilation) ──
    await step.do('lifecycle-designed', async () => {
      await transitionLifecycle(db, proposalKey, 'designed', {
        trigger: 'pipeline-compile',
      }).catch((err: unknown) => {
        console.warn(`[lifecycle] Failed to set designed: ${err instanceof Error ? err.message : err}`)
      })
      return { ok: true }
    })

    // Lineage: WorkGraph → Proposal (written before Gate 1 so lineage check passes)
    await step.do('edge-workgraph-proposal', async () => {
      await db.saveEdge('lineage_edges', `specs_workgraphs/${wgKey}`, `specs_functions/${proposalKey}`, {
        type: 'compiled-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Gate 1: Compile coverage (deterministic) ──
    const gate1 = await step.do('gate-1', async () => {
      const result = await this.env.GATES.evaluateGate1(compState.workGraph)
      return toStep(result as unknown as Record<string, unknown>) as unknown as Gate1Report
    }) as unknown as Gate1Report

    if (!gate1.passed) {
      await step.do('persist-gate1-failure', async () => {
        await db.save('specs_coverage_reports', {
          _key: `CR-G1-${wgKey}-${Date.now().toString(36)}`,
          type: 'gate-1',
          passed: gate1.passed,
          summary: gate1.summary,
          checks: gate1.checks,
          sourceRefs: [`WG:${wgKey}`],
          timestamp: gate1.timestamp,
        })
        await db.save('gate_status', {
          _key: `gate:1:${wgKey}-${Date.now().toString(36)}`,
          passed: false,
          report: gate1,
          timestamp: new Date().toISOString(),
        })
        return { persisted: true }
      })

      // ── Feedback loop: Gate 1 failure → new signal ──
      const gate1FailResult: PipelineResult = {
        status: 'gate-1-failed',
        report: gate1,
        signalId: signalKey,
      }
      await step.do('enqueue-feedback-gate1', async () => {
        const feedbackDepth = typeof (signal as Rec).raw?.feedbackDepth === 'number'
          ? (signal as Rec).raw.feedbackDepth as number : 0
        await this.env.FEEDBACK_QUEUE?.send({
          result: gate1FailResult,
          parentSignal: signal,
          parentFeedbackDepth: feedbackDepth,
        })
        return { enqueued: true }
      })

      return gate1FailResult
    }

    // ── Persist gate pass ──
    await step.do('persist-gate1-pass', async () => {
      await db.save('gate_status', {
        _key: `gate:1:${wgKey}-${Date.now().toString(36)}`,
        passed: true,
        report: gate1,
        timestamp: new Date().toISOString(),
      })
      await db.save('specs_coverage_reports', {
        _key: `CR-G1-${wgKey}-${Date.now().toString(36)}`,
        type: 'gate-1',
        passed: gate1.passed,
        summary: gate1.summary,
        checks: gate1.checks,
        sourceRefs: [`WG:${wgKey}`],
        timestamp: gate1.timestamp,
      })
      return { persisted: true }
    })

    // ── Stage 6: Function synthesis (event-driven handoff) ──
    // CF Workflows CANNOT communicate with DOs during step.do().
    // Instead: queue a synthesis request, wait for an external trigger
    // to call the DO via HTTP and send the result back as a workflow event.
    if (!compState.workGraph) {
      return {
        status: 'compile-incomplete',
        signalId: signalKey,
        reason: 'No WorkGraph produced by compilation',
      }
    }

    const wg = compState.workGraph as { _key?: string; [k: string]: unknown }

    // Enqueue synthesis request to CF Queue.
    // The queue consumer (queue() handler) will call the DO and send
    // the result back as a workflow event.
    // Thread specContent from the proposal through to the DO (when present)
    const specContent = typeof proposal.specContent === 'string' ? proposal.specContent : undefined

    await step.do('enqueue-synthesis', async () => {
      await this.env.SYNTHESIS_QUEUE.send({
        workflowId: event.instanceId,
        workGraphId: wgKey,
        workGraph: wg,
        dryRun,
        ...(specContent ? { specContent } : {}),
      })
      return { enqueued: true }
    })

    // ── Phase D: Lifecycle → in_progress (synthesis enqueued) ──
    await step.do('lifecycle-in-progress', async () => {
      await transitionLifecycle(db, proposalKey, 'in_progress', {
        trigger: 'pipeline-enqueue-synthesis',
      }).catch((err: unknown) => {
        console.warn(`[lifecycle] Failed to set in_progress: ${err instanceof Error ? err.message : err}`)
      })
      return { ok: true }
    })

    // Wait for external trigger to complete synthesis via DO and send event
    const synthEvent = await step.waitForEvent<{
      verdict: { decision: string; confidence: number; reason: string }
      tokenUsage: number
      repairCount: number
    }>('synthesis-complete', { type: 'synthesis-complete', timeout: '30 minutes' })

    const synthPayload = synthEvent.payload as {
      verdict: { decision: string; confidence: number; reason: string }
      tokenUsage: number
      repairCount: number
    }

    // ── If Phase 1 dispatched atoms, wait for Phase 2+3 completion ──
    // When the coordinator dispatches atoms (vertical slicing), the synthesis-complete
    // event carries verdict.decision === 'dispatched'. The actual pass/fail comes later
    // via the 'atoms-complete' event after all atoms finish and Phase 3 runs.
    let finalVerdict = synthPayload.verdict
    let finalTokenUsage = synthPayload.tokenUsage
    let finalRepairCount = synthPayload.repairCount
    let atomResults: Record<string, unknown> | undefined

    if (synthPayload.verdict.decision === 'dispatched') {
      try {
        const atomsEvent = await step.waitForEvent('atoms-complete', { type: 'atoms-complete', timeout: '30 minutes' })

        const atomsPayload = atomsEvent.payload as {
          verdict: { decision: string; confidence: number; reason: string }
          tokenUsage: number
          repairCount: number
          atomResults?: Record<string, unknown>
        }

        // Use the atoms-complete verdict as the final synthesis result
        finalVerdict = atomsPayload.verdict
        finalTokenUsage = synthPayload.tokenUsage + atomsPayload.tokenUsage
        finalRepairCount = synthPayload.repairCount + atomsPayload.repairCount
        atomResults = atomsPayload.atomResults
      } catch {
        // Timeout or error waiting for atoms — report as synthesis-timeout
        return {
          status: 'synthesis-timeout',
          signalId: signalKey,
          pressureId: pressureKey,
          capabilityId: capabilityKey,
          proposalId: proposalKey,
          workGraphId: wgKey,
          gate1Report: gate1,
          synthesisResult: {
            verdict: { decision: 'timeout', confidence: 1.0, reason: 'Atoms did not complete within 30 minutes' },
            tokenUsage: synthPayload.tokenUsage,
            repairCount: synthPayload.repairCount,
          },
        }
      }
    }

    // Lineage: execution artifact -> workgraph
    await step.do('edge-synthesis-workgraph', async () => {
      await db.saveEdge('lineage_edges',
        `execution_artifacts/EA-${wgKey}-synthesis`,
        `specs_workgraphs/${wgKey}`,
        { type: 'synthesized-from', createdAt: new Date().toISOString() },
      )
      return { ok: true }
    })

    // ── Phase D: Lifecycle → produced (if synthesis passed) ──
    if (finalVerdict.decision === 'pass') {
      await step.do('lifecycle-produced', async () => {
        await transitionLifecycle(db, proposalKey, 'produced', {
          trigger: 'pipeline-synthesis-pass',
        }).catch((err: unknown) => {
          console.warn(`[lifecycle] Failed to set produced: ${err instanceof Error ? err.message : err}`)
        })
        return { ok: true }
      })
    }

    // ── Feedback loop: synthesis result → new signal ──
    const finalResult: PipelineResult = {
      status: finalVerdict.decision === 'pass'
        ? 'synthesis-passed'
        : `synthesis-${finalVerdict.decision}`,
      signalId: signalKey,
      pressureId: pressureKey,
      capabilityId: capabilityKey,
      proposalId: proposalKey,
      workGraphId: wgKey,
      gate1Report: gate1,
      synthesisResult: {
        verdict: finalVerdict,
        tokenUsage: finalTokenUsage,
        repairCount: finalRepairCount,
      },
      ...(atomResults ? { atomResults } : {}),
    }

    await step.do('enqueue-feedback', async () => {
      const feedbackDepth = typeof (signal as Rec).raw?.feedbackDepth === 'number'
        ? (signal as Rec).raw.feedbackDepth as number : 0
      await this.env.FEEDBACK_QUEUE?.send({
        result: finalResult,
        parentSignal: signal,
        parentFeedbackDepth: feedbackDepth,
      })
      return { enqueued: true }
    })

    return finalResult
  }
}
