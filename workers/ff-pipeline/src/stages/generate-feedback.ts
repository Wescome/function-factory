/**
 * @module generate-feedback
 *
 * Generates feedback signals from synthesis results. This is the
 * self-improvement loop — synthesis outcomes become new signals
 * that re-enter the pipeline.
 *
 * Signal taxonomy:
 *   - synthesis:atom-failed       — critical atom verdict = fail (auto-approve: true)
 *   - synthesis:gate1-failed      — Gate 1 failed (auto-approve: false)
 *   - synthesis:verdict-fail      — general synthesis failure (auto-approve: false)
 *   - synthesis:low-confidence    — pass but confidence < 0.8 (auto-approve: false)
 *   - synthesis:orl-degradation   — repairCount >= 2 (auto-approve: true)
 *   - synthesis:pr-candidate      — pass with confidence >= 0.8 (auto-approve: false)
 *
 * Loop prevention (3 layers):
 *   Layer 1: feedbackDepth counter in raw field, max 3
 *   Layer 2: Idempotency via existing ingest-signal.ts hash
 *   Layer 3: 30-min cooldown per functionId + subtype via AQL query
 */

import type { ArangoClient } from '@factory/arango-client'
import type { SignalInput } from '../types'

// ── Types ────────────────────────────────────────────────────────────

export interface FeedbackContext {
  result: Record<string, unknown>  // PipelineResult shape
  parentSignal: Record<string, unknown>
  parentFeedbackDepth: number
}

export interface FeedbackSignal {
  signal: SignalInput & { raw?: Record<string, unknown> }
  autoApprove: boolean
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_FEEDBACK_DEPTH = 3
const COOLDOWN_MINUTES = 30

// ── Internal helpers ─────────────────────────────────────────────────

function extractVerdict(result: Record<string, unknown>): {
  decision: string
  confidence: number
  reason: string
} | null {
  const sr = result.synthesisResult as Record<string, unknown> | undefined
  if (!sr?.verdict) return null
  return sr.verdict as { decision: string; confidence: number; reason: string }
}

function extractRepairCount(result: Record<string, unknown>): number {
  const sr = result.synthesisResult as Record<string, unknown> | undefined
  return typeof sr?.repairCount === 'number' ? sr.repairCount : 0
}

function extractAtomResults(result: Record<string, unknown>): Record<string, Record<string, unknown>> | null {
  const ar = result.atomResults as Record<string, Record<string, unknown>> | undefined
  if (!ar || typeof ar !== 'object') return null
  return ar
}

function buildSourceRefs(result: Record<string, unknown>): string[] {
  const refs: string[] = []
  if (result.signalId) refs.push(`SIG:${result.signalId}`)
  if (result.pressureId) refs.push(`PRS:${result.pressureId}`)
  if (result.capabilityId) refs.push(`BC:${result.capabilityId}`)
  if (result.proposalId) refs.push(`FN:${result.proposalId}`)
  if (result.workGraphId) refs.push(`WG:${result.workGraphId}`)
  return refs
}

function makeSignal(
  subtype: string,
  title: string,
  description: string,
  sourceRefs: string[],
  feedbackDepth: number,
  extraRaw?: Record<string, unknown>,
): SignalInput & { raw: Record<string, unknown> } {
  return {
    signalType: 'internal',
    source: 'factory:feedback-loop',
    subtype,
    title,
    description,
    sourceRefs,
    raw: {
      feedbackDepth,
      ...(extraRaw ?? {}),
    },
  }
}

/**
 * Check 30-minute cooldown for a given functionId + subtype.
 * Returns true if a recent signal exists (suppressed).
 */
async function checkCooldown(
  db: ArangoClient,
  workGraphId: string | undefined,
  subtype: string,
): Promise<boolean> {
  if (!workGraphId) return false

  const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString()
  const existing = await db.queryOne<Record<string, unknown>>(
    `FOR s IN specs_signals
       FILTER s.source == 'factory:feedback-loop'
       FILTER s.subtype == @subtype
       FILTER s.createdAt >= @cutoff
       FILTER POSITION(s.sourceRefs, @wgRef)
       LIMIT 1
       RETURN s`,
    { subtype, cutoff, wgRef: `WG:${workGraphId}` },
  )

  return existing !== null && existing !== undefined
}

// ── Lesson Extraction ────────────────────────────────────────────

/**
 * Analyze synthesis results and extract reusable lessons into ArangoDB.
 *
 * Pattern detection:
 *   - F1 failures (prose instead of JSON) — context too large
 *   - Timeout failures — atom scope too large
 *   - F7 null response — model returned nothing
 *   - Partial synthesis — some atoms pass, some fail (stochastic)
 *
 * Lessons are UPSERTed by pattern name so evidence accumulates
 * rather than duplicating entries.
 */
export async function extractLessons(
  ctx: FeedbackContext,
  db: ArangoClient,
): Promise<void> {
  await db.ensureCollection('memory_semantic')

  const { result } = ctx
  const atomResults = extractAtomResults(result)
  if (!atomResults) return

  const lessons: Array<{ pattern: string; evidence: string; recommendation: string }> = []

  // Pattern 1: F1 failures (prose instead of JSON) — context too large
  const f1Atoms = Object.entries(atomResults).filter(([_, r]) => {
    const reason = (r.verdict as any)?.reason ?? ''
    return reason.includes('F1:')
  })
  if (f1Atoms.length > 0) {
    lessons.push({
      pattern: 'F1 prose output from agent',
      evidence: `${f1Atoms.length} atoms produced prose instead of JSON: ${f1Atoms.map(([id]) => id).join(', ')}`,
      recommendation: 'Reduce agent context size. Check if WorkGraph or Plan is too large for the model context window.',
    })
  }

  // Pattern 2: Timeout failures — scope too large
  const timeoutAtoms = Object.entries(atomResults).filter(([_, r]) => {
    const reason = (r.verdict as any)?.reason ?? ''
    return reason.includes('exceeded') && reason.includes('deadline')
  })
  if (timeoutAtoms.length > 0) {
    lessons.push({
      pattern: 'Atom execution timeout',
      evidence: `${timeoutAtoms.length} atoms exceeded wall-clock deadline: ${timeoutAtoms.map(([id]) => id).join(', ')}`,
      recommendation: 'Decompose into smaller atoms or increase timeout for complex implementation atoms.',
    })
  }

  // Pattern 3: F7 null response — model returned nothing
  const f7Atoms = Object.entries(atomResults).filter(([_, r]) => {
    const reason = (r.verdict as any)?.reason ?? ''
    return reason.includes('F7:') || reason.includes('empty response') || reason.includes('no text content')
  })
  if (f7Atoms.length > 0) {
    lessons.push({
      pattern: 'Empty/null model response',
      evidence: `${f7Atoms.length} atoms got null responses: ${f7Atoms.map(([id]) => id).join(', ')}`,
      recommendation: 'Model may be overloaded or prompt exceeds context window. Check token counts.',
    })
  }

  // Pattern 4: High pass rate but still failing — close to success
  const totalAtoms = Object.keys(atomResults).length
  const passedAtoms = Object.entries(atomResults).filter(([_, r]) => (r.verdict as any)?.decision === 'pass').length
  const passRate = totalAtoms > 0 ? passedAtoms / totalAtoms : 0
  if (passRate >= 0.5 && passRate < 1.0) {
    lessons.push({
      pattern: 'Partial synthesis success',
      evidence: `${passedAtoms}/${totalAtoms} atoms passed (${(passRate * 100).toFixed(0)}%). Failing atoms: ${Object.entries(atomResults).filter(([_, r]) => (r.verdict as any)?.decision !== 'pass').map(([id]) => id).join(', ')}`,
      recommendation: 'Stochastic failures — retry may succeed. Consider increasing atom-level retries before declaring failure.',
    })
  }

  // Write lessons to ArangoDB
  for (const lesson of lessons) {
    try {
      await db.query(
        `UPSERT { pattern: @pattern }
         INSERT { pattern: @pattern, evidence: [@evidence], recommendation: @recommendation, count: 1, firstSeen: @now, lastSeen: @now, type: 'lesson' }
         UPDATE { evidence: APPEND(OLD.evidence, @evidence, true), count: OLD.count + 1, lastSeen: @now }
         IN memory_semantic`,
        { pattern: lesson.pattern, evidence: lesson.evidence, recommendation: lesson.recommendation, now: new Date().toISOString() },
      )
    } catch (err) {
      console.warn(`[Feedback] Failed to write lesson: ${err instanceof Error ? err.message : err}`)
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Generate feedback signals from a synthesis result.
 *
 * Returns an array of FeedbackSignal objects, each containing:
 *   - signal: the SignalInput to ingest
 *   - autoApprove: whether to auto-approve the signal's pipeline run
 *
 * Loop prevention:
 *   Layer 1: feedbackDepth counter — max 3 generations
 *   Layer 2: idempotency via ingest-signal.ts hash (handled downstream)
 *   Layer 3: 30-min cooldown per workGraphId + subtype (checked here)
 */
export async function generateFeedbackSignals(
  ctx: FeedbackContext,
  db: ArangoClient,
): Promise<FeedbackSignal[]> {
  // ── Layer 1: depth check ──
  if (ctx.parentFeedbackDepth >= MAX_FEEDBACK_DEPTH) {
    return []
  }

  const { result } = ctx
  const feedbackDepth = ctx.parentFeedbackDepth + 1
  const sourceRefs = buildSourceRefs(result)
  const workGraphId = result.workGraphId as string | undefined
  const status = result.status as string

  const candidates: FeedbackSignal[] = []

  // ── Gate 1 failure ──
  if (status === 'gate-1-failed') {
    candidates.push({
      signal: makeSignal(
        'synthesis:gate1-failed',
        `Gate 1 failed: ${workGraphId ?? 'unknown'}`,
        `Compile coverage gate failed for WorkGraph ${workGraphId}. ` +
        `${(result.report as Record<string, unknown>)?.summary ?? 'No summary'}`,
        sourceRefs,
        feedbackDepth,
        { workGraphId },
      ),
      autoApprove: false,
    })
  }

  // ── Synthesis verdict-based signals ──
  const verdict = extractVerdict(result)
  if (verdict) {
    const repairCount = extractRepairCount(result)
    const atomResults = extractAtomResults(result)

    // Atom failures — one signal per failed atom
    if (atomResults && verdict.decision === 'fail') {
      for (const [atomId, atomResult] of Object.entries(atomResults)) {
        const atomVerdict = atomResult.verdict as Record<string, unknown> | undefined
        if (atomVerdict?.decision === 'fail') {
          candidates.push({
            signal: makeSignal(
              'synthesis:atom-failed',
              `Atom failed: ${atomId}`,
              `Atom ${atomId} failed synthesis: ${atomVerdict.reason ?? 'unknown reason'}`,
              sourceRefs,
              feedbackDepth,
              { atomId, atomVerdict, workGraphId },
            ),
            autoApprove: true,
          })
        }
      }
    }

    // General verdict failure (no atom results — monolithic synthesis)
    if (verdict.decision === 'fail' && !atomResults) {
      candidates.push({
        signal: makeSignal(
          'synthesis:verdict-fail',
          `Synthesis failed: ${workGraphId ?? 'unknown'}`,
          `Synthesis verdict: fail — ${verdict.reason}`,
          sourceRefs,
          feedbackDepth,
          { verdict, workGraphId },
        ),
        autoApprove: false,
      })
    }

    // ORL degradation — high repair count
    if (repairCount >= 2) {
      candidates.push({
        signal: makeSignal(
          'synthesis:orl-degradation',
          `ORL degradation: ${repairCount} repairs for ${workGraphId ?? 'unknown'}`,
          `Observe-Repair-Learn loop ran ${repairCount} repairs, indicating systemic issues`,
          sourceRefs,
          feedbackDepth,
          { repairCount, workGraphId },
        ),
        autoApprove: true,
      })
    }

    // Pass with low confidence
    if (verdict.decision === 'pass' && verdict.confidence < 0.8) {
      candidates.push({
        signal: makeSignal(
          'synthesis:low-confidence',
          `Low confidence pass: ${verdict.confidence.toFixed(2)} for ${workGraphId ?? 'unknown'}`,
          `Synthesis passed with confidence ${verdict.confidence.toFixed(2)} (threshold 0.8): ${verdict.reason}`,
          sourceRefs,
          feedbackDepth,
          { confidence: verdict.confidence, workGraphId },
        ),
        autoApprove: false,
      })
    }

    // PR candidate — high-confidence pass
    if (verdict.decision === 'pass' && verdict.confidence >= 0.8) {
      candidates.push({
        signal: makeSignal(
          'synthesis:pr-candidate',
          `PR candidate: ${workGraphId ?? 'unknown'}`,
          `Synthesis passed with confidence ${verdict.confidence.toFixed(2)} — ready for PR`,
          sourceRefs,
          feedbackDepth,
          { confidence: verdict.confidence, workGraphId },
        ),
        autoApprove: false,
      })
    }
  }

  // ── Layer 3: cooldown check per candidate ──
  const approved: FeedbackSignal[] = []
  for (const candidate of candidates) {
    const suppressed = await checkCooldown(
      db,
      workGraphId,
      candidate.signal.subtype!,
    )
    if (!suppressed) {
      approved.push(candidate)
    }
  }

  // ── Lesson extraction — fire-and-forget, never blocks feedback ──
  try {
    await extractLessons(ctx, db)
  } catch (err) {
    console.warn(`[Feedback] Lesson extraction failed: ${err instanceof Error ? err.message : err}`)
  }

  return approved
}
