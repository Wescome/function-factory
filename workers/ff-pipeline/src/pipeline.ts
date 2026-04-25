import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { createClientFromEnv } from '@factory/arango-client'
import { ingestSignal } from './stages/ingest-signal'
import { synthesizePressure } from './stages/synthesize-pressure'
import { mapCapability } from './stages/map-capability'
import { proposeFunction } from './stages/propose-function'
import { semanticReview } from './stages/semantic-review'
import { compilePRD, PASS_NAMES } from './stages/compile'
import type { PipelineEnv, PipelineParams, PipelineResult, SemanticReviewResult, Gate1Report } from './types'

// CF Workflows step.do() requires Serializable<T> return types.
// Record<string, unknown> doesn't satisfy it because unknown could be non-serializable.
// We JSON-roundtrip to guarantee serializability and assert the type.
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
    const params = event.payload
    const dryRun = params.dryRun ?? false

    // ── Stage 1: Signal ingestion ──
    const signal = await step.do('ingest-signal', async () => {
      return toStep(await ingestSignal(params.signal, db))
    })

    // ── Stage 2: Pressure synthesis ──
    const pressure = await step.do('synthesize-pressure', async () => {
      return toStep(await synthesizePressure(signal as Record<string, unknown>, db, this.env, dryRun))
    })

    // ── Stage 3: Capability mapping ──
    const capability = await step.do('map-capability', async () => {
      return toStep(await mapCapability(pressure as Record<string, unknown>, db, this.env, dryRun))
    })

    // ── Stage 4: Function proposal ──
    const proposal = await step.do('propose-function', async () => {
      return toStep(await proposeFunction(capability as Record<string, unknown>, db, this.env, dryRun))
    })

    // ── Architect approval ──
    const approval = await step.waitForEvent<{ decision: string; reason?: string; by?: string }>(
      'architect-approval',
      { type: 'architect-approval', timeout: '7 days' },
    )

    const approvalPayload = approval.payload as { decision?: string; reason?: string; by?: string } | undefined
    if (approvalPayload?.decision !== 'approved') {
      const signalKey = signal._key as string
      await step.do('persist-rejection', async () => {
        await db.save('specs_coverage_reports', {
          _key: `CR-REJECT-${signalKey}`,
          type: 'architect-rejection',
          signalId: signalKey,
          reason: approvalPayload?.reason ?? 'no reason given',
          rejectedBy: approvalPayload?.by ?? 'unknown',
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

    if (review.alignment === 'miscast') {
      return {
        status: 'semantic-miscast',
        report: review,
        signalId: signal._key as string,
        proposalId: proposal._key as string,
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

    // ── Gate 1: Compile coverage (deterministic) ──
    const gate1 = await step.do('gate-1', async () => {
      const result = await this.env.GATES.evaluateGate1(compState.workGraph)
      return toStep(result as unknown as Record<string, unknown>) as unknown as Gate1Report
    }) as unknown as Gate1Report

    const wgKey = (compState.workGraph as Record<string, unknown>)?._key as string ?? 'unknown'

    if (!gate1.passed) {
      await step.do('persist-gate1-failure', async () => {
        await db.save('specs_coverage_reports', {
          _key: `CR-G1-${wgKey}`,
          type: 'gate-1',
          passed: gate1.passed,
          summary: gate1.summary,
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
        signalId: signal._key as string,
      }
    }

    // ── Persist all artifacts ──
    const signalKey = signal._key as string
    const pressureKey = pressure._key as string
    const capabilityKey = capability._key as string
    const proposalKey = proposal._key as string

    await step.do('persist-artifacts', async () => {
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
        timestamp: gate1.timestamp,
      })

      const edges = [
        { from: `specs_pressures/${pressureKey}`, to: `specs_signals/${signalKey}`, type: 'derived-from' },
        { from: `specs_capabilities/${capabilityKey}`, to: `specs_pressures/${pressureKey}`, type: 'derived-from' },
        { from: `specs_functions/${proposalKey}`, to: `specs_capabilities/${capabilityKey}`, type: 'derived-from' },
        { from: `specs_workgraphs/${wgKey}`, to: `specs_functions/${proposalKey}`, type: 'compiled-from' },
      ]
      for (const edge of edges) {
        await db.saveEdge('lineage_edges', edge.from, edge.to, {
          type: edge.type,
          createdAt: new Date().toISOString(),
        })
      }
      return { persisted: true }
    })

    return {
      status: 'gate-1-passed',
      signalId: signalKey,
      pressureId: pressureKey,
      capabilityId: capabilityKey,
      proposalId: proposalKey,
      workGraphId: wgKey,
      gate1Report: gate1,
    }
  }
}
