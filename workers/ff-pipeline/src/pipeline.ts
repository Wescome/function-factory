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
import { createCRP } from './crp'
import { transitionLifecycle } from './lifecycle'
import type { PipelineEnv, PipelineParams, PipelineResult, SemanticReviewResult, Gate1Report } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>

function toStep(obj: Record<string, unknown>): Rec {
  return JSON.parse(JSON.stringify(obj)) as Rec
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
        triggeredBy: 'pipeline-propose-function',
      }).catch((err: unknown) => {
        console.warn(`[lifecycle] Failed to set proposed: ${err instanceof Error ? err.message : err}`)
      })
      return { ok: true }
    })

    // ── Architect approval ──
    const approval = await step.waitForEvent<{ decision: string; reason?: string; by?: string }>(
      'architect-approval',
      { type: 'architect-approval', timeout: '7 days' },
    )

    const approvalPayload = approval.payload as { decision?: string; reason?: string; by?: string } | undefined
    if (approvalPayload?.decision !== 'approved') {
      await step.do('persist-rejection', async () => {
        await db.save('specs_coverage_reports', {
          _key: `CR-REJECT-${signalKey}`,
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
      return {
        status: 'semantic-miscast',
        report: review,
        signalId: signalKey,
        proposalId: proposalKey,
      }
    }

    // ── Stage 5: PRD compilation (8 passes) ──
    let compState: Record<string, unknown> = {
      prd: proposal.prd,
      workGraph: null,
    }

    for (const passName of PASS_NAMES) {
      const prevState = compState
      compState = await step.do(`compile-${passName}`, async () => {
        return toStep(await compilePRD(passName, prevState, db, this.env, dryRun))
      }) as unknown as Record<string, unknown>
    }

    const wgKey = (compState.workGraph as Record<string, unknown>)?._key as string ?? 'unknown'

    // ── Phase D: Lifecycle → designed (after compilation) ──
    await step.do('lifecycle-designed', async () => {
      await transitionLifecycle(db, proposalKey, 'designed', {
        triggeredBy: 'pipeline-compile',
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
          _key: `CR-G1-${wgKey}`,
          type: 'gate-1',
          passed: gate1.passed,
          summary: gate1.summary,
          checks: gate1.checks,
          sourceRefs: [`WG:${wgKey}`],
          timestamp: gate1.timestamp,
        })
        await db.save('gate_status', {
          _key: `gate:1:${wgKey}`,
          passed: false,
          report: gate1,
          timestamp: new Date().toISOString(),
        })
        return { persisted: true }
      })
      return {
        status: 'gate-1-failed',
        report: gate1,
        signalId: signalKey,
      }
    }

    // ── Persist gate pass ──
    await step.do('persist-gate1-pass', async () => {
      await db.save('gate_status', {
        _key: `gate:1:${wgKey}`,
        passed: true,
        report: gate1,
        timestamp: new Date().toISOString(),
      })
      await db.save('specs_coverage_reports', {
        _key: `CR-G1-${wgKey}`,
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

    const wg = compState.workGraph as Record<string, unknown>

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
        triggeredBy: 'pipeline-enqueue-synthesis',
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

    // Lineage: execution artifact -> workgraph
    await step.do('edge-synthesis-workgraph', async () => {
      await db.saveEdge('lineage_edges',
        `execution_artifacts/EA-${wgKey}-synthesis`,
        `specs_workgraphs/${wgKey}`,
        { type: 'synthesized-from', createdAt: new Date().toISOString() },
      )
      return { ok: true }
    })

    // ── Phase D: Lifecycle → implemented (if synthesis passed) ──
    if (synthPayload.verdict.decision === 'pass') {
      await step.do('lifecycle-implemented', async () => {
        await transitionLifecycle(db, proposalKey, 'implemented', {
          triggeredBy: 'pipeline-synthesis-pass',
        }).catch((err: unknown) => {
          console.warn(`[lifecycle] Failed to set implemented: ${err instanceof Error ? err.message : err}`)
        })
        return { ok: true }
      })
    }

    return {
      status: synthPayload.verdict.decision === 'pass'
        ? 'synthesis-passed'
        : `synthesis-${synthPayload.verdict.decision}`,
      signalId: signalKey,
      pressureId: pressureKey,
      capabilityId: capabilityKey,
      proposalId: proposalKey,
      workGraphId: wgKey,
      gate1Report: gate1,
      synthesisResult: {
        verdict: synthPayload.verdict,
        tokenUsage: synthPayload.tokenUsage,
        repairCount: synthPayload.repairCount,
      },
    }
  }
}
