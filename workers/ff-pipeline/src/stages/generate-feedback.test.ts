/**
 * Tests for synthesis-to-signal feedback loop.
 *
 * Verifies that synthesis results produce the correct feedback signals
 * with proper loop prevention (depth, idempotency, cooldown).
 *
 * Signal taxonomy:
 *   - synthesis:atom-failed       — critical atom verdict = fail (auto-approve: true)
 *   - synthesis:coherence-verification-failed — Coherence Verification failed (auto-approve: false)
 *   - synthesis:verdict-fail      — general synthesis failure (auto-approve: false)
 *   - synthesis:low-confidence    — pass but confidence < 0.8 (auto-approve: false)
 *   - synthesis:orl-degradation   — repairCount >= 2 (auto-approve: true)
 *   - synthesis:pr-candidate      — pass with confidence >= 0.8 (auto-approve: false)
 */

import { describe, expect, it, vi } from 'vitest'
import {
  generateFeedbackSignals,
  extractLessons,
  type FeedbackContext,
  type FeedbackSignal,
} from './generate-feedback'

// ── Mock DB factory ──────────────────────────────────────────────────

function createMockDb(overrides?: {
  cooldownHit?: boolean
}) {
  return {
    queryOne: vi.fn(async () => {
      if (overrides?.cooldownHit) return { _key: 'existing-signal' }
      return null
    }),
    save: vi.fn(async () => ({ _key: 'mock-key' })),
    saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
    query: vi.fn(async () => []),
    get: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    setValidator: vi.fn(),
    ensureCollection: vi.fn(async () => {}),
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<FeedbackContext>): FeedbackContext {
  return {
    result: {
      status: 'synthesis-passed',
      signalId: 'SIG-001',
      pressureId: 'PRS-001',
      capabilityId: 'BC-001',
      proposalId: 'FP-001',
      executableSpecificationId: 'ES-001',
      synthesisResult: {
        verdict: { decision: 'pass', confidence: 0.95, reason: 'All roles passed' },
        tokenUsage: 4200,
        repairCount: 0,
      },
    },
    parentSignal: {
      _key: 'SIG-001',
      signalType: 'internal',
      source: 'test',
      title: 'Test signal',
      description: 'Test signal description',
      sourceRefs: ['PRS-001'],
    },
    parentFeedbackDepth: 0,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('generateFeedbackSignals', () => {

  describe('synthesis-passed with high confidence', () => {
    it('emits a pr-candidate signal with auto-approve false', async () => {
      const db = createMockDb()
      const ctx = makeCtx()

      const signals = await generateFeedbackSignals(ctx, db as never)

      const prCandidate = signals.find(s => s.signal.subtype === 'synthesis:pr-candidate')
      expect(prCandidate).toBeDefined()
      expect(prCandidate!.autoApprove).toBe(false)
      expect(prCandidate!.signal.signalType).toBe('internal')
      expect(prCandidate!.signal.source).toBe('factory:feedback-loop')
      expect(prCandidate!.signal.raw?.feedbackDepth).toBe(1)
    })
  })

  describe('synthesis-passed with low confidence', () => {
    it('emits a low-confidence signal when confidence < 0.8', async () => {
      const db = createMockDb()
      const ctx = makeCtx({
        result: {
          status: 'synthesis-passed',
          signalId: 'SIG-002',
          pressureId: 'PRS-002',
          capabilityId: 'BC-002',
          proposalId: 'FP-002',
          executableSpecificationId: 'ES-002',
          synthesisResult: {
            verdict: { decision: 'pass', confidence: 0.65, reason: 'Passed with low confidence' },
            tokenUsage: 3000,
            repairCount: 0,
          },
        },
      })

      const signals = await generateFeedbackSignals(ctx, db as never)

      const lowConf = signals.find(s => s.signal.subtype === 'synthesis:low-confidence')
      expect(lowConf).toBeDefined()
      expect(lowConf!.autoApprove).toBe(false)
      // Should NOT also emit pr-candidate
      const prCandidate = signals.find(s => s.signal.subtype === 'synthesis:pr-candidate')
      expect(prCandidate).toBeUndefined()
    })
  })

  describe('atom failures', () => {
    it('emits atom-failed signals for each failed critical atom', async () => {
      const db = createMockDb()
      const ctx = makeCtx({
        result: {
          status: 'synthesis-fail',
          signalId: 'SIG-003',
          pressureId: 'PRS-003',
          capabilityId: 'BC-003',
          proposalId: 'FP-003',
          executableSpecificationId: 'ES-003',
          synthesisResult: {
            verdict: { decision: 'fail', confidence: 0.9, reason: '2 critical atoms failed' },
            tokenUsage: 8000,
            repairCount: 3,
          },
          atomResults: {
            'atom-1': { verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' }, atomId: 'atom-1' },
            'atom-2': { verdict: { decision: 'fail', confidence: 0.8, reason: 'test failed' }, atomId: 'atom-2' },
            'atom-3': { verdict: { decision: 'fail', confidence: 0.7, reason: 'compile error' }, atomId: 'atom-3' },
          },
        },
      })

      const signals = await generateFeedbackSignals(ctx, db as never)

      const atomFailed = signals.filter(s => s.signal.subtype === 'synthesis:atom-failed')
      expect(atomFailed.length).toBe(2)
      expect(atomFailed.every(s => s.autoApprove === true)).toBe(true)
      // Each atom-failed signal should reference the specific atom
      const atomIds = atomFailed.map(s => s.signal.raw?.atomId)
      expect(atomIds).toContain('atom-2')
      expect(atomIds).toContain('atom-3')
    })
  })

  describe('ORL degradation', () => {
    it('emits orl-degradation when repairCount >= 2', async () => {
      const db = createMockDb()
      const ctx = makeCtx({
        result: {
          status: 'synthesis-passed',
          signalId: 'SIG-004',
          pressureId: 'PRS-004',
          capabilityId: 'BC-004',
          proposalId: 'FP-004',
          executableSpecificationId: 'ES-004',
          synthesisResult: {
            verdict: { decision: 'pass', confidence: 0.85, reason: 'Passed after repairs' },
            tokenUsage: 10000,
            repairCount: 3,
          },
        },
      })

      const signals = await generateFeedbackSignals(ctx, db as never)

      const orl = signals.find(s => s.signal.subtype === 'synthesis:orl-degradation')
      expect(orl).toBeDefined()
      expect(orl!.autoApprove).toBe(true)
      expect(orl!.signal.raw?.repairCount).toBe(3)
    })
  })

  describe('general synthesis failure (verdict-fail)', () => {
    it('emits verdict-fail signal when synthesis verdict is fail without atomResults', async () => {
      const db = createMockDb()
      const ctx = makeCtx({
        result: {
          status: 'synthesis-fail',
          signalId: 'SIG-005',
          pressureId: 'PRS-005',
          capabilityId: 'BC-005',
          proposalId: 'FP-005',
          executableSpecificationId: 'ES-005',
          synthesisResult: {
            verdict: { decision: 'fail', confidence: 1.0, reason: 'Repair cap exceeded' },
            tokenUsage: 12000,
            repairCount: 5,
          },
        },
      })

      const signals = await generateFeedbackSignals(ctx, db as never)

      const verdictFail = signals.find(s => s.signal.subtype === 'synthesis:verdict-fail')
      expect(verdictFail).toBeDefined()
      expect(verdictFail!.autoApprove).toBe(false)
    })
  })

  describe('Coherence Verification failure', () => {
    it('emits coherence-verification-failed signal when status is coherence-verification-failed', async () => {
      const db = createMockDb()
      const ctx = makeCtx({
        result: {
          status: 'coherence-verification-failed',
          signalId: 'SIG-006',
          executableSpecificationId: 'ES-006',
          report: {
            verification: "coherence",
            passed: false,
            summary: 'Missing lineage edges',
            checks: [{ name: 'lineage', passed: false, detail: 'no edges' }],
          },
        },
      })

      const signals = await generateFeedbackSignals(ctx, db as never)

      const coherenceVerification = signals.find(s => s.signal.subtype === 'synthesis:coherence-verification-failed')
      expect(coherenceVerification).toBeDefined()
      expect(coherenceVerification!.autoApprove).toBe(false)
      expect(coherenceVerification!.signal.title).toContain('Coherence Verification failed')
    })

  })

  describe('loop prevention: depth >= 3', () => {
    it('returns empty array when parentFeedbackDepth >= 3', async () => {
      const db = createMockDb()
      const ctx = makeCtx({ parentFeedbackDepth: 3 })

      const signals = await generateFeedbackSignals(ctx, db as never)

      expect(signals).toEqual([])
    })

    it('returns empty array when parentFeedbackDepth is 5 (well above limit)', async () => {
      const db = createMockDb()
      const ctx = makeCtx({ parentFeedbackDepth: 5 })

      const signals = await generateFeedbackSignals(ctx, db as never)

      expect(signals).toEqual([])
    })
  })

  describe('loop prevention: cooldown', () => {
    it('suppresses signals when cooldown query returns existing signal', async () => {
      const db = createMockDb({ cooldownHit: true })
      const ctx = makeCtx()

      const signals = await generateFeedbackSignals(ctx, db as never)

      // All signals should be suppressed due to cooldown
      expect(signals).toEqual([])
    })
  })

  describe('lineage in sourceRefs', () => {
    it('includes full lineage chain in signal sourceRefs', async () => {
      const db = createMockDb()
      const ctx = makeCtx()

      const signals = await generateFeedbackSignals(ctx, db as never)

      expect(signals.length).toBeGreaterThan(0)
      const first = signals[0]!
      expect(first.signal.sourceRefs).toBeDefined()
      expect(first.signal.sourceRefs).toContain('SIG:SIG-001')
    })
  })

  describe('feedbackDepth increments correctly', () => {
    it('sets feedbackDepth to parentFeedbackDepth + 1', async () => {
      const db = createMockDb()
      const ctx = makeCtx({ parentFeedbackDepth: 1 })

      const signals = await generateFeedbackSignals(ctx, db as never)

      expect(signals.length).toBeGreaterThan(0)
      for (const s of signals) {
        expect(s.signal.raw?.feedbackDepth).toBe(2)
      }
    })
  })

  describe('lesson extraction', () => {
    it('calls extractLessons during generateFeedbackSignals (no crash)', async () => {
      const db = createMockDb()
      const ctx = makeCtx({
        result: {
          status: 'synthesis-fail',
          signalId: 'SIG-010',
          executableSpecificationId: 'ES-010',
          synthesisResult: {
            verdict: { decision: 'fail', confidence: 0.9, reason: '2 atoms failed' },
            tokenUsage: 8000,
            repairCount: 1,
          },
          atomResults: {
            'atom-1': { verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' } },
            'atom-2': { verdict: { decision: 'fail', confidence: 0.5, reason: 'F1: prose output' } },
          },
        },
      })

      const signals = await generateFeedbackSignals(ctx, db as never)

      // Should still return feedback signals (lesson extraction does not block)
      expect(signals.length).toBeGreaterThan(0)
      // ensureCollection should have been called for memory_semantic
      expect(db.ensureCollection).toHaveBeenCalledWith('memory_semantic')
      // save should have been called for lessons (F1 lesson + partial success lesson)
      expect(db.save).toHaveBeenCalled()
    })
  })
})

describe('extractLessons', () => {
  it('writes F1 pattern lesson when atoms have F1 failures', async () => {
    const db = createMockDb()
    const ctx: FeedbackContext = {
      result: {
        atomResults: {
          'atom-1': { verdict: { decision: 'fail', reason: 'F1: prose instead of JSON' } },
          'atom-2': { verdict: { decision: 'pass', reason: 'ok' } },
        },
      },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    await extractLessons(ctx, db as never)

    expect(db.ensureCollection).toHaveBeenCalledWith('memory_semantic')
    // D1 implementation: new lessons use db.save, existing lessons use db.update
    const saveCalls = db.save.mock.calls
    const f1Call = saveCalls.find((c: any) => c[1]?.pattern === 'F1 prose output from agent')
    expect(f1Call).toBeDefined()
    const f1Evidence = (f1Call as unknown as [unknown, Record<string, unknown>])[1]!.evidence
    // evidence is stored as array of strings: [evidenceString]
    const evidenceStr = Array.isArray(f1Evidence) ? (f1Evidence as string[]).join(' ') : String(f1Evidence)
    expect(evidenceStr).toContain('atom-1')
  })

  it('writes timeout pattern lesson when atoms exceed deadline', async () => {
    const db = createMockDb()
    const ctx: FeedbackContext = {
      result: {
        atomResults: {
          'atom-slow': { verdict: { decision: 'fail', reason: 'exceeded wall-clock deadline' } },
        },
      },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    await extractLessons(ctx, db as never)

    const saveCalls = db.save.mock.calls
    const timeoutCall = saveCalls.find((c: any) => c[1]?.pattern === 'Atom execution timeout')
    expect(timeoutCall).toBeDefined()
    const timeoutEvidence = (timeoutCall as unknown as [unknown, Record<string, unknown>])[1]!.evidence
    const timeoutEvidenceStr = Array.isArray(timeoutEvidence) ? (timeoutEvidence as string[]).join(' ') : String(timeoutEvidence)
    expect(timeoutEvidenceStr).toContain('atom-slow')
  })

  it('writes F7 pattern lesson for empty/null responses', async () => {
    const db = createMockDb()
    const ctx: FeedbackContext = {
      result: {
        atomResults: {
          'atom-null': { verdict: { decision: 'fail', reason: 'F7: empty response from model' } },
        },
      },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    await extractLessons(ctx, db as never)

    const saveCalls = db.save.mock.calls
    const f7Call = saveCalls.find((c: any) => c[1]?.pattern === 'Empty/null model response')
    expect(f7Call).toBeDefined()
  })

  it('writes partial success lesson when pass rate is 50-99%', async () => {
    const db = createMockDb()
    const ctx: FeedbackContext = {
      result: {
        atomResults: {
          'atom-1': { verdict: { decision: 'pass', reason: 'ok' } },
          'atom-2': { verdict: { decision: 'fail', reason: 'compile error' } },
        },
      },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    await extractLessons(ctx, db as never)

    const saveCalls = db.save.mock.calls
    const partialCall = saveCalls.find((c: any) => c[1]?.pattern === 'Partial synthesis success')
    expect(partialCall).toBeDefined()
    const partialEvidence = (partialCall as unknown as [unknown, Record<string, unknown>])[1]!.evidence
    const partialEvidenceStr = Array.isArray(partialEvidence) ? (partialEvidence as string[]).join(' ') : String(partialEvidence)
    expect(partialEvidenceStr).toContain('1/2')
  })

  it('does not write lessons when no atomResults exist', async () => {
    const db = createMockDb()
    const ctx: FeedbackContext = {
      result: { status: 'synthesis-passed' },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    await extractLessons(ctx, db as never)

    // ensureCollection is called, but no lesson saves
    expect(db.ensureCollection).toHaveBeenCalledWith('memory_semantic')
    // No atom results → no lessons to write
    const lessonSaves = db.save.mock.calls.filter((c: any) =>
      c[0] === 'memory_semantic',
    )
    expect(lessonSaves).toHaveLength(0)
  })

  it('does not write lessons when all atoms pass', async () => {
    const db = createMockDb()
    const ctx: FeedbackContext = {
      result: {
        atomResults: {
          'atom-1': { verdict: { decision: 'pass', reason: 'ok' } },
          'atom-2': { verdict: { decision: 'pass', reason: 'ok' } },
        },
      },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    await extractLessons(ctx, db as never)

    // No failure patterns detected, no lesson saves
    const lessonSaves = db.save.mock.calls.filter((c: any) =>
      c[0] === 'memory_semantic',
    )
    expect(lessonSaves).toHaveLength(0)
  })

  it('swallows db.query errors without throwing', async () => {
    const db = createMockDb()
    db.query.mockRejectedValue(new Error('ArangoDB unreachable'))
    const ctx: FeedbackContext = {
      result: {
        atomResults: {
          'atom-1': { verdict: { decision: 'fail', reason: 'F1: prose' } },
        },
      },
      parentSignal: {},
      parentFeedbackDepth: 0,
    }

    // Should not throw
    await expect(extractLessons(ctx, db as never)).resolves.toBeUndefined()
  })
})
