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
import { ROLE_CONTRACTS } from './coordinator/contracts'
import { callProvider } from './providers'
import { resolve } from '@factory/task-routing'
import type { TaskKind } from '@factory/task-routing'
import type { ProviderEnv } from './providers'
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
        timestamp: gate1.timestamp,
      })
      return { persisted: true }
    })

    // ── Stage 6: Function synthesis ──
    // Each role runs as its own Workflow step (timeouts work here).
    // The Workflow drives the repair loop; LLM calls happen in step.do().
    if (!compState.workGraph) {
      return {
        status: 'compile-incomplete',
        signalId: signalKey,
        reason: 'No WorkGraph produced by compilation',
      }
    }

    const wg = compState.workGraph as Record<string, unknown>
    const roles = ['planner', 'coder', 'critic', 'tester', 'verifier'] as const
    type SynthState = {
      plan: unknown; code: unknown; critique: unknown; tests: unknown;
      verdict: { decision: string; confidence: number; reason: string; notes?: string } | null;
      tokenUsage: number; repairCount: number;
      roleHistory: { role: string; tokenUsage: number; timestamp: string }[];
    }
    let synth: SynthState = {
      plan: null, code: null, critique: null, tests: null, verdict: null,
      tokenUsage: 0, repairCount: 0, roleHistory: [],
    }
    const maxRepairs = 5

    for (let cycle = 0; cycle <= maxRepairs; cycle++) {
      if (synth.repairCount >= maxRepairs) {
        synth.verdict = { decision: 'fail', confidence: 1.0, reason: `Repair cap (${maxRepairs})` }
        break
      }

      for (const roleName of roles) {
        const contract = ROLE_CONTRACTS[roleName]
        const stepName = `stage-6-${roleName}${cycle > 0 ? `-r${cycle}` : ''}`

        const roleResult = await step.do(stepName, { timeout: '2 minutes' }, async () => {
          if (dryRun) {
            const stubs: Record<string, string> = {
              planner: '{"approach":"dry-run","atoms":[{"id":"a1","description":"stub","assignedTo":"coder"}],"executorRecommendation":"pi-sdk","estimatedComplexity":"low"}',
              coder: '{"files":[{"path":"src/stub.ts","content":"// dry-run","action":"create"}],"summary":"dry-run","testsIncluded":false}',
              critic: '{"passed":true,"issues":[],"mentorRuleCompliance":[],"overallAssessment":"dry-run pass"}',
              tester: '{"passed":true,"testsRun":1,"testsPassed":1,"testsFailed":0,"failures":[],"summary":"dry-run pass"}',
              verifier: '{"decision":"pass","confidence":1.0,"reason":"dry-run auto-pass"}',
            }
            return toStep({ raw: stubs[roleName] ?? '{}', role: roleName })
          }

          const context: Record<string, unknown> = {
            workGraphId: wg._key, workGraph: { title: wg.title, atoms: wg.atoms, invariants: wg.invariants, dependencies: wg.dependencies },
            repairCount: synth.repairCount, maxRepairs,
          }
          if (roleName === 'coder' || roleName === 'critic' || roleName === 'tester' || roleName === 'verifier') {
            if (synth.plan) context.plan = synth.plan
            if (synth.code) context.code = synth.code
          }
          if (roleName === 'tester' || roleName === 'verifier') {
            if (synth.critique) context.critique = synth.critique
          }
          if (roleName === 'verifier' && synth.tests) context.tests = synth.tests
          if ((roleName === 'planner' || roleName === 'coder') && synth.verdict?.notes) {
            context.repairNotes = synth.verdict.notes
          }

          const target = resolve(contract.taskKind as TaskKind)
          const raw = await callProvider(target, contract.systemPrompt, JSON.stringify(context), this.env as unknown as ProviderEnv)
          return toStep({ raw, role: roleName })
        })

        const raw = (roleResult as Rec).raw as string
        const parsed = contract.parse(raw)
        const tokens = Math.ceil(raw.length / 4)

        synth[contract.outputChannel as keyof Pick<SynthState, 'plan' | 'code' | 'critique' | 'tests' | 'verdict'>] = parsed as never
        synth.tokenUsage += tokens
        synth.roleHistory = [...synth.roleHistory, { role: roleName, tokenUsage: tokens, timestamp: new Date().toISOString() }]
      }

      if (!synth.verdict || synth.verdict.decision === 'pass' || synth.verdict.decision === 'fail' || synth.verdict.decision === 'interrupt') {
        break
      }
      synth.repairCount++
    }

    const synthResult = {
      verdict: synth.verdict ?? { decision: 'fail', confidence: 0, reason: 'No verdict' },
      tokenUsage: synth.tokenUsage,
      repairCount: synth.repairCount,
    }

    await step.do('edge-synthesis-workgraph', async () => {
      await db.saveEdge('lineage_edges',
        `execution_artifacts/EA-${wgKey}-synthesis`,
        `specs_workgraphs/${wgKey}`,
        { type: 'synthesized-from', createdAt: new Date().toISOString() },
      )
      return { ok: true }
    })

    return {
      status: synthResult.verdict.decision === 'pass'
        ? 'synthesis-passed'
        : `synthesis-${synthResult.verdict.decision}`,
      signalId: signalKey,
      pressureId: pressureKey,
      capabilityId: capabilityKey,
      proposalId: proposalKey,
      workGraphId: wgKey,
      gate1Report: gate1,
      synthesisResult: {
        verdict: synthResult.verdict,
        tokenUsage: synthResult.tokenUsage,
        repairCount: synthResult.repairCount,
      },
    }
  }
}
