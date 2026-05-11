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
import { compileIntentSpecification, PASS_NAMES } from './stages/compile'
import { crystallizeIntent, type CrystallizeInput, type IntentAnchor } from './stages/crystallize-intent'
import { probeAnchors } from './stages/intent-probe'
import { reconcile } from './stages/reconciliation-gate'
import { buildViolationFeedback } from './stages/violation-feedback'
import { filterAnchorsForPass } from './stages/pass-specific-anchors'
import { appendDriftEntry } from './stages/drift-ledger'
import { loadCrystallizerEnabled } from './config/crystallizer-config'
import { createCRP } from './crp'
import { transitionLifecycle } from './lifecycle'
import { buildTrellisPacketForSynthesis } from './trellis-instruction-tuning'
import { captureLearningTranscript } from './learning-capture'
import type {
  CoherenceVerificationReport,
  PipelineEnv,
  PipelineParams,
  PipelineResult,
  SemanticReviewResult,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>

/** Step config for AI model calls — 4 min timeout, 2 retries with exponential backoff
 *  Budget: primary attempt (~90s max) + fallback attempt (~90s max) + overhead */
const AI_STEP_CONFIG = {
  timeout: '4 minutes' as const,
  retries: { limit: 2, delay: '5 seconds' as const, backoff: 'exponential' as const },
}

/** Step config for DB/queue operations — 30 sec timeout, 3 retries with exponential backoff */
const DB_STEP_CONFIG = {
  timeout: '30 seconds' as const,
  retries: { limit: 3, delay: '2 seconds' as const, backoff: 'exponential' as const },
}

const COHERENCE_VERIFICATION_FAILED_STATUS = 'coherence-verification-failed'

function toStep(obj: Record<string, unknown>): Rec {
  return JSON.parse(JSON.stringify(obj)) as Rec
}

function verificationStatusKey(family: string, artifactKey: string): string {
  const safeFamily = family.replace(/[^A-Za-z0-9_-]/g, '-')
  const safeArtifactKey = artifactKey.replace(/[^A-Za-z0-9_-]/g, '-')
  return `verification-${safeFamily}-${safeArtifactKey}-${Date.now().toString(36)}`
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
    const workflowRunId = typeof (event as { instanceId?: unknown }).instanceId === 'string'
      ? (event as { instanceId: string }).instanceId
      : undefined

    // ── Signal Artifact collection (legacy Stage 1) ──
    const signal = await step.do('ingest-signal', DB_STEP_CONFIG, async () => {
      return toStep(await ingestSignal(params.signal, db))
    })
    const signalKey = signal._key as string
    const captureTerminal = (
      terminalResult: PipelineResult,
      trellis?: { id?: unknown; audit?: { packetHash?: unknown } },
    ): Promise<PipelineResult> => captureLearningTranscript({
      env: this.env,
      db,
      runId: workflowRunId ?? terminalResult.signalId ?? signalKey,
      terminalResult,
      ...(typeof trellis?.id === 'string' ? { trellisExecutionPacketId: trellis.id } : {}),
      ...(typeof trellis?.audit?.packetHash === 'string' ? { trellisExecutionPacketHash: trellis.audit.packetHash } : {}),
    })

    // ── Pressure Artifact interpretation (legacy Stage 2) ──
    const pressure = await step.do('synthesize-pressure', AI_STEP_CONFIG, async () => {
      return toStep(await synthesizePressure(signal as Record<string, unknown>, db, this.env, dryRun))
    })
    const pressureKey = pressure._key as string

    // Lineage: Pressure → Signal
    await step.do('edge-pressure-signal', DB_STEP_CONFIG, async () => {
      await db.saveEdge('lineage_edges', `specs_pressures/${pressureKey}`, `specs_signals/${signalKey}`, {
        type: 'derived-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Capability Artifact scoping (legacy Stage 3) ──
    const capability = await step.do('map-capability', AI_STEP_CONFIG, async () => {
      return toStep(await mapCapability(pressure as Record<string, unknown>, db, this.env, dryRun))
    })
    const capabilityKey = capability._key as string

    // Lineage: Capability → Pressure
    await step.do('edge-capability-pressure', DB_STEP_CONFIG, async () => {
      await db.saveEdge('lineage_edges', `specs_capabilities/${capabilityKey}`, `specs_pressures/${pressureKey}`, {
        type: 'derived-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Function Proposal decomposition (legacy Stage 4) ──
    const proposal = await step.do('propose-function', AI_STEP_CONFIG, async () => {
      return toStep(await proposeFunction(capability as Record<string, unknown>, db, this.env, dryRun))
    })
    const proposalKey = proposal._key as string

    // Lineage: Proposal → Capability
    await step.do('edge-proposal-capability', DB_STEP_CONFIG, async () => {
      await db.saveEdge('lineage_edges', `specs_functions/${proposalKey}`, `specs_capabilities/${capabilityKey}`, {
        type: 'derived-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Phase D: Lifecycle → proposed ──
    await step.do('lifecycle-proposed', DB_STEP_CONFIG, async () => {
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
      await step.do('persist-rejection', DB_STEP_CONFIG, async () => {
        await db.save('verification_reports', {
          _key: `VR-REJECT-${signalKey}-${Date.now().toString(36)}`,
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
      const rejectionResult: PipelineResult = {
        status: 'rejected',
        reason: approvalPayload?.reason ?? 'Architect declined',
        signalId: signalKey,
      }
      return captureTerminal(rejectionResult)
    }

    // ── Semantic review (Critic-at-authoring, pre-compile) ──
    const review = await step.do('semantic-review', AI_STEP_CONFIG, async () => {
      const result = await semanticReview(proposal as Record<string, unknown>, db, this.env, dryRun)
      return toStep(result as unknown as Record<string, unknown>) as unknown as SemanticReviewResult
    }) as unknown as SemanticReviewResult

    // ── Phase D: CRP on low-confidence semantic review (C7) ──
    const reviewConfidence = (review as unknown as { confidence?: number }).confidence
    if (typeof reviewConfidence === 'number' && reviewConfidence < 0.7) {
      await step.do('crp-semantic-review', DB_STEP_CONFIG, async () => {
        await createCRP(db, {
          artifactKey: proposalKey,
          collection: 'specs_functions',
          confidence: reviewConfidence,
          context: `Semantic review alignment: ${review.alignment}`,
          agentRole: 'critic',
          executableSpecificationId: proposalKey,
        })
        return { ok: true }
      })
    }

    if (review.alignment === 'miscast') {
      // Log the miscast but continue — the semantic review is advisory during bootstrap.
      // Coherence Verification is structural verification. The Critic catches drift from Pressure/Capability/Proposal reframing.
      // TODO: make this configurable via hot-config (strict mode vs advisory mode)
      console.warn(`[Pipeline] Semantic review: miscast (${review.rationale?.slice(0, 100)}). Continuing to compilation.`)
    }

    // ── Crystallize signal intent into binary anchors ──
    // Hot-config flag: crystallizer.enabled (default true after synthesis #11 validation)
    // When disabled or on error, returns empty anchors — zero behavior change
    const crystallizerEnabled = await step.do('load-crystallizer-config', DB_STEP_CONFIG, async () => {
      return loadCrystallizerEnabled(db)
    })
    const crystallization = await step.do('crystallize-intent', AI_STEP_CONFIG, async () => {
      const crystallizeInput: CrystallizeInput = {
        signalId: signalKey,
        title: signal.title as string,
        description: signal.description as string,
        ...(typeof params.signal.specContent === 'string' && { specContent: params.signal.specContent }),
      }
      const result = await crystallizeIntent(
        crystallizeInput,
        this.env,
        dryRun,
        crystallizerEnabled,
      )
      return toStep(result as unknown as Record<string, unknown>)
    })

    const intentAnchors = (crystallization.anchors ?? []) as IntentAnchor[]

    // Persist anchors to ArangoDB for drift ledger analysis (Phase 3)
    if (intentAnchors.length > 0) {
      await step.do('persist-intent-anchors', DB_STEP_CONFIG, async () => {
        await db.ensureCollection('intent_anchors').catch(() => {})
        for (const anchor of intentAnchors) {
          await db.save('intent_anchors', anchor as unknown as Record<string, unknown>).catch(() => {})
        }
        return { persisted: intentAnchors.length }
      })
    }

    // ── Intent-to-Executable compilation with inter-transformation probing ──
    //
    // C1+SE-1 resolution: probed passes (decompose, dependency, invariant) run
    // a compile-verify loop with distinct step names per remediation attempt.
    // CF Workflows deduplicates by step name, so replayed steps return cached results.
    //
    // Non-probed passes (interface, binding, validation, assembly, verification)
    // use the existing simple pattern.
    const PROBED_PASSES = ['decompose']
    const MAX_REMEDIATION = 2

    // ── Fetch file contexts for compile-stage grounding ──
    const signalSpecContent = typeof params.signal.specContent === 'string' ? params.signal.specContent : undefined
    const compileFileContexts = await step.do('fetch-compile-context', DB_STEP_CONFIG, async () => {
      if (!signalSpecContent) return { fileContexts: [] }
      try {
        const { extractFilePathsFromSpec, fetchCompileFileContexts } = await import('./stages/compile.js')
        const filePaths = extractFilePathsFromSpec(signalSpecContent)
        if (filePaths.length === 0) return { fileContexts: [] }
        const contexts = await fetchCompileFileContexts(filePaths, this.env)
        return { fileContexts: contexts.map((c: { path: string; structure: { exports: string[]; functions: Array<{ name: string; params: string }> }; rawContent: string }) => ({ path: c.path, exports: c.structure.exports, functions: c.structure.functions.map(f => `${f.name}(${f.params})`), rawContent: c.rawContent.slice(0, 2000) })) }
      } catch { return { fileContexts: [] } }
    })

    let compState: Record<string, unknown> = {
      intentSpecification: proposal.intentSpecification,
      intentAnchors,
      signalContext: {
        title: signal.title,
        description: signal.description,
        specContent: signalSpecContent,
      },
      fileContexts: compileFileContexts.fileContexts ?? [],
      executableSpecification: null,
    }

    let intentViolation = false

    for (const passName of PASS_NAMES) {
      // Priority 3: filter anchors to those applicable to this pass (C4)
      const passAnchors = filterAnchorsForPass(intentAnchors, passName)

      if (PROBED_PASSES.includes(passName) && passAnchors.length > 0) {
        // ── Probed pass: compile -> compute delta -> probe -> gate ──
        for (let r = 0; r <= MAX_REMEDIATION; r++) {
          // C3: On remediation (r > 0), build violation feedback from compState
          const prevState = r > 0 && Array.isArray((compState as Rec)._violatedAnchors)
            ? {
                ...compState,
                _violationFeedback: buildViolationFeedback(
                  (compState as Rec)._violatedAnchors as string[],
                  passAnchors,
                ),
              }
            : compState
          compState = await step.do(`compile-verify-${passName}-r${r}`, AI_STEP_CONFIG, async () => {
            // Compile the pass
            const newState = toStep(await compileIntentSpecification(passName, prevState, db, this.env, dryRun))

            // Compute delta: only the fields added by this pass (C2)
            const delta = computeDelta(prevState, newState)
            const deltaStr = JSON.stringify(delta)

            // Probe the delta against pass-filtered anchors (isolated LLM call)
            const probeStart = Date.now()
            const probeResults = await probeAnchors(deltaStr, passAnchors, this.env, dryRun)
            const probeLatency = Date.now() - probeStart

            // Gate: pure deterministic decision
            const gate = reconcile(probeResults, passAnchors, r, MAX_REMEDIATION)

            // Phase 3: Drift ledger — best-effort, never blocks
            await appendDriftEntry({
              pipeline_id: event.instanceId,
              signal_id: signalKey,
              pass_name: passName,
              anchors_probed: passAnchors.map(a => a.id),
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
            // verdict === 'remediate': store violated anchors in compState (C3)
            // Next iteration of the r-loop will read _violatedAnchors
            return { ...newState, _gateVerdict: 'remediate', _violatedAnchors: gate.violated_anchors }
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
        compState = await step.do(`compile-${passName}`, AI_STEP_CONFIG, async () => {
          return toStep(await compileIntentSpecification(passName, prevState, db, this.env, dryRun))
        }) as unknown as Record<string, unknown>
      }
    }

    // SE-2: Handle intent-violation escalation
    if (intentViolation) {
      const intentViolationResult: PipelineResult = {
        status: 'synthesis:intent-violation',
        signalId: signalKey,
        reason: `Block-severity intent anchors violated after ${MAX_REMEDIATION} remediation attempts. Violated anchors: ${((compState as Rec)._violatedAnchors ?? []).join(', ')}`,
      }
      return captureTerminal(intentViolationResult)
    }

    const executableSpecificationKey = (compState.executableSpecification as { _key?: string })?._key ?? 'unknown'

    // ── Phase D: Lifecycle → designed (after compilation) ──
    await step.do('lifecycle-designed', DB_STEP_CONFIG, async () => {
      await transitionLifecycle(db, proposalKey, 'designed', {
        trigger: 'pipeline-compile',
      }).catch((err: unknown) => {
        console.warn(`[lifecycle] Failed to set designed: ${err instanceof Error ? err.message : err}`)
      })
      return { ok: true }
    })

    // Lineage: ExecutableSpecification → Proposal (written before Coherence Verification so lineage check passes)
    await step.do('edge-executableSpecification-proposal', DB_STEP_CONFIG, async () => {
      await db.saveEdge('lineage_edges', `executable_specifications/${executableSpecificationKey}`, `specs_functions/${proposalKey}`, {
        type: 'compiled-from', createdAt: new Date().toISOString(),
      })
      return { ok: true }
    })

    // ── Coherence Verification: Compile coverage (deterministic) ──
    const coherenceVerification = await step.do('coherence-verification', DB_STEP_CONFIG, async () => {
      const result = await this.env.GATES.evaluateCoherenceVerification(compState.executableSpecification)
      return toStep(result as unknown as Record<string, unknown>) as unknown as CoherenceVerificationReport
    }) as unknown as CoherenceVerificationReport

    if (!coherenceVerification.passed) {
      await step.do('persist-coherence-verification-failure', DB_STEP_CONFIG, async () => {
        await db.save('verification_reports', {
          _key: `VR-COHERENCE-${executableSpecificationKey}-${Date.now().toString(36)}`,
          type: 'coherence-verification',
          passed: coherenceVerification.passed,
          summary: coherenceVerification.summary,
          checks: coherenceVerification.checks,
          sourceRefs: [`ES:${executableSpecificationKey}`],
          timestamp: coherenceVerification.timestamp,
        })
        await db.save('verification_status', {
          _key: verificationStatusKey('coherence', executableSpecificationKey),
          family: 'coherence',
          artifactKey: executableSpecificationKey,
          passed: false,
          report: coherenceVerification,
          timestamp: new Date().toISOString(),
        })
        return { persisted: true }
      })

      // ── Feedback loop: Coherence Verification failure → new signal ──
      const coherenceVerificationFailResult: PipelineResult = {
        status: COHERENCE_VERIFICATION_FAILED_STATUS,
        report: coherenceVerification,
        coherenceVerificationReport: coherenceVerification,
        signalId: signalKey,
      }
      await step.do('enqueue-feedback-coherence-verification', DB_STEP_CONFIG, async () => {
        const feedbackDepth = typeof (signal as Rec).raw?.feedbackDepth === 'number'
          ? (signal as Rec).raw.feedbackDepth as number : 0
        await this.env.FEEDBACK_QUEUE?.send({
          result: coherenceVerificationFailResult,
          parentSignal: signal,
          parentFeedbackDepth: feedbackDepth,
        })
        return { enqueued: true }
      })

      return captureTerminal(coherenceVerificationFailResult)
    }

    // ── Persist gate pass ──
    await step.do('persist-coherence-verification-pass', DB_STEP_CONFIG, async () => {
      await db.save('verification_status', {
        _key: verificationStatusKey('coherence', executableSpecificationKey),
        family: 'coherence',
        artifactKey: executableSpecificationKey,
        passed: true,
        report: coherenceVerification,
        timestamp: new Date().toISOString(),
      })
      await db.save('verification_reports', {
        _key: `VR-COHERENCE-${executableSpecificationKey}-${Date.now().toString(36)}`,
        type: 'coherence-verification',
        passed: coherenceVerification.passed,
        summary: coherenceVerification.summary,
        checks: coherenceVerification.checks,
        sourceRefs: [`ES:${executableSpecificationKey}`],
        timestamp: coherenceVerification.timestamp,
      })
      return { persisted: true }
    })

    // ── Agent Call execution / Function synthesis (event-driven handoff) ──
    // CF Workflows CANNOT communicate with DOs during step.do().
    // Instead: queue a synthesis request, wait for an external trigger
    // to call the DO via HTTP and send the result back as a workflow event.
    if (!compState.executableSpecification) {
      const compileIncompleteResult: PipelineResult = {
        status: 'compile-incomplete',
        signalId: signalKey,
        reason: 'No ExecutableSpecification produced by compilation',
      }
      return captureTerminal(compileIncompleteResult)
    }

    const executableSpecification = compState.executableSpecification as { _key?: string; [k: string]: unknown }
    const instructionTuning = await step.do('instruction-tuning', DB_STEP_CONFIG, async () => {
      return toStep(buildTrellisPacketForSynthesis({
        executableSpecificationId: executableSpecificationKey,
        executableSpecification: executableSpecification,
        proposal: proposal as Record<string, unknown>,
        generatedAt: new Date().toISOString(),
      }) as unknown as Record<string, unknown>)
    })

    if (instructionTuning.status !== 'emitted') {
      await step.do('persist-instruction-tuning-blocked', DB_STEP_CONFIG, async () => {
        await db.save('verification_reports', {
          _key: `VR-INSTRUCTION-TUNING-${executableSpecificationKey}-${Date.now().toString(36)}`,
          type: 'instruction-tuning',
          passed: false,
          summary: 'Instruction Tuning blocked Trellis packet emission.',
          checks: instructionTuning.diagnostics ?? [],
          sourceRefs: [`ES:${executableSpecificationKey}`],
          source_refs: [executableSpecificationKey],
          timestamp: new Date().toISOString(),
        })
        return { persisted: true }
      })
      const instructionTuningBlockedResult: PipelineResult = {
        status: 'instruction-tuning-blocked',
        signalId: signalKey,
        executableSpecificationId: executableSpecificationKey,
        reason: 'Instruction Tuning could not emit a certified Trellis Execution Packet.',
        diagnostics: instructionTuning.diagnostics,
      } as PipelineResult
      return captureTerminal(instructionTuningBlockedResult)
    }

    const trellisExecutionPacket = instructionTuning.packet as Record<string, unknown>

    await step.do('persist-trellis-execution-packet', DB_STEP_CONFIG, async () => {
      await db.save('trellis_execution_packets', {
        ...trellisExecutionPacket,
        _key: trellisExecutionPacket.id,
        source_refs: trellisExecutionPacket.source_refs,
      })
      await db.saveEdge('lineage_edges', `trellis_execution_packets/${trellisExecutionPacket.id as string}`, `executable_specifications/${executableSpecificationKey}`, {
        type: 'tuned-from', createdAt: new Date().toISOString(),
      })
      return { persisted: true }
    })

    // Enqueue synthesis request to CF Queue.
    // The queue consumer (queue() handler) will call the DO and send
    // the result back as a workflow event.
    // Thread specContent from the proposal through to the DO (when present)
    const specContent = typeof proposal.specContent === 'string' ? proposal.specContent : undefined

    await step.do('enqueue-synthesis', DB_STEP_CONFIG, async () => {
      await this.env.SYNTHESIS_QUEUE.send({
        workflowId: event.instanceId,
        executableSpecificationId: executableSpecificationKey,
        executableSpecification: executableSpecification,
        trellisExecutionPacket,
        dryRun,
        ...(specContent ? { specContent } : {}),
      })
      return { enqueued: true }
    })

    // ── Phase D: Lifecycle → in_progress (synthesis enqueued) ──
    await step.do('lifecycle-in-progress', DB_STEP_CONFIG, async () => {
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
        const synthesisTimeoutResult: PipelineResult = {
          status: 'synthesis-timeout',
          signalId: signalKey,
          pressureId: pressureKey,
          capabilityId: capabilityKey,
          proposalId: proposalKey,
          executableSpecificationId: executableSpecificationKey,
          coherenceVerificationReport: coherenceVerification,
          synthesisResult: {
            verdict: { decision: 'timeout', confidence: 1.0, reason: 'Atoms did not complete within 30 minutes' },
            tokenUsage: synthPayload.tokenUsage,
            repairCount: synthPayload.repairCount,
          },
        }
        return captureTerminal(synthesisTimeoutResult, trellisExecutionPacket)
      }
    }

    // Lineage: execution artifact -> executableSpecification
    await step.do('edge-synthesis-executableSpecification', DB_STEP_CONFIG, async () => {
      await db.saveEdge('lineage_edges',
        `execution_artifacts/EA-${executableSpecificationKey}-synthesis`,
        `executable_specifications/${executableSpecificationKey}`,
        { type: 'synthesized-from', createdAt: new Date().toISOString() },
      )
      return { ok: true }
    })

    // ── Phase D: Lifecycle → produced (if synthesis passed) ──
    if (finalVerdict.decision === 'pass') {
      await step.do('lifecycle-produced', DB_STEP_CONFIG, async () => {
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
      executableSpecificationId: executableSpecificationKey,
      coherenceVerificationReport: coherenceVerification,
      synthesisResult: {
        verdict: finalVerdict,
        tokenUsage: finalTokenUsage,
        repairCount: finalRepairCount,
      },
      ...(atomResults ? { atomResults } : {}),
    }

    if (!dryRun) {
      await step.do('enqueue-feedback', DB_STEP_CONFIG, async () => {
        const feedbackDepth = typeof (signal as Rec).raw?.feedbackDepth === 'number'
          ? (signal as Rec).raw.feedbackDepth as number : 0
        await this.env.FEEDBACK_QUEUE?.send({
          result: finalResult,
          parentSignal: signal,
          parentFeedbackDepth: feedbackDepth,
          dryRun,
        })
        return { enqueued: true }
      })
    }

    return captureTerminal(finalResult, trellisExecutionPacket)
  }
}
