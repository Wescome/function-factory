import { describe, expect, it, vi } from 'vitest'
import {
  buildMergeReadinessPack,
  ingestMergeReadinessPack,
  type PROutcomeSignalRecord,
} from './merge-readiness-pack'
import type { SynthesisMaterializationAudit } from './synthesis-pr-draft'

function makeAudit(overrides: Partial<SynthesisMaterializationAudit> = {}): SynthesisMaterializationAudit {
  return {
    type: 'synthesis_artifact_materialization',
    timestamp: '2026-05-06T02:59:30Z',
    pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
    runtimeStatus: 'synthesis-passed',
    signalId: 'SIG-MOTDWPYM-LTW5',
    pressureId: 'PRS-MOTDWQ0T-S55Y',
    capabilityId: 'BC-MOTDWSVY-PQOO',
    proposalId: 'FP-MOTDWVR2-W7UN',
    workGraphId: 'WG-MOTE4M1R-G7I0',
    gate1Passed: true,
    atomResults: [
      { atomId: 'atom-001', decision: 'pass', confidence: 0.95, tests: '14/14' },
    ],
    materializedFiles: [
      {
        atomId: 'atom-001',
        path: 'workers/ff-pipeline/src/runtime-verification.ts',
        action: 'create',
        sha256: '16ae4de2b48f6956246c2c6876151ee5690fbccde493e70ebe38bae4042d9b43',
      },
      {
        atomId: 'local-test-harness',
        path: 'workers/ff-pipeline/src/runtime-verification.test.ts',
        action: 'create',
        sha256: 'c742a1331bf51c5932e5ad355f8e9097494b208b7228a0450f8e3e497225844f',
      },
    ],
    localVerification: [
      'pnpm --filter @factory/ff-pipeline typecheck passed',
      'pnpm --filter @factory/ff-pipeline test passed 64 files / 956 tests',
    ],
    notes: 'Retrospective audit record.',
    ...overrides,
  }
}

function makeOutcome(overrides: Partial<PROutcomeSignalRecord> = {}): PROutcomeSignalRecord {
  return {
    _key: 'SIG-MOTILTZ0-6DGK',
    signalType: 'internal',
    source: 'factory:pr-outcome',
    subtype: 'synthesis:pr-ci-passed',
    sourceRefs: [
      'SIG:SIG-MOTDWPYM-LTW5',
      'PRS:PRS-MOTDWQ0T-S55Y',
      'BC:BC-MOTDWSVY-PQOO',
      'FN:FP-MOTDWVR2-W7UN',
      'WG:WG-MOTE4M1R-G7I0',
    ],
    createdAt: '2026-05-06T03:09:14Z',
    raw: {
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      proposalId: 'FP-MOTDWVR2-W7UN',
      workGraphId: 'WG-MOTE4M1R-G7I0',
      pr: {
        number: 71,
        url: 'https://github.com/Wescome/function-factory/pull/71',
        title: '[Factory] Materialize WG-MOTE4M1R-G7I0 synthesis artifact',
        state: 'OPEN',
        draft: true,
        merged: false,
        headRefName: 'factory/fp-motdwvr2-w7un',
        baseRefName: 'main',
        headSha: 'e933510c98dc29dabfb635bb49e47667eefdbf1c',
      },
      outcome: {
        prState: 'draft',
        ciState: 'passed',
        reviewState: 'none',
      },
      checks: {
        passed: ['Factory PR Gate', 'Typecheck', 'Test'],
        failed: [],
        pending: [],
      },
      observedAt: '2026-05-06T03:09:14Z',
    },
    ...overrides,
  }
}

describe('merge-readiness pack', () => {
  it('builds a ready MRP from materialization audit and passing PR outcome signal', () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome(),
      createdAt: '2026-05-06T04:00:00Z',
    })

    expect(pack).toMatchObject({
      id: 'MRP-MOTE4M1R-G7I0-71',
      proposalId: 'FP-MOTDWVR2-W7UN',
      workGraphId: 'WG-MOTE4M1R-G7I0',
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      readinessVerdict: 'ready',
      createdAt: '2026-05-06T04:00:00Z',
    })
    expect(pack.sourceRefs).toEqual([
      'SIG-MOTDWPYM-LTW5',
      'PRS-MOTDWQ0T-S55Y',
      'BC-MOTDWSVY-PQOO',
      'FP-MOTDWVR2-W7UN',
      'WG-MOTE4M1R-G7I0',
      'SIG-MOTILTZ0-6DGK',
    ])
    expect(pack.ciEvidence).toMatchObject({
      status: 'passed',
      commitSha: 'e933510c98dc29dabfb635bb49e47667eefdbf1c',
      checksPassed: ['Factory PR Gate', 'Typecheck', 'Test'],
    })
    expect(pack.materializedFiles).toHaveLength(2)
    expect(pack.criteria.map(criterion => criterion.name)).toEqual([
      'functional-completeness',
      'sound-verification',
      'se-hygiene',
      'rationale',
      'auditability',
    ])
    expect(pack.criteria.every(criterion => criterion.passed)).toBe(true)
  })

  it('blocks when CI has not passed', () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome({
        subtype: 'synthesis:pr-ci-failed',
        raw: {
          ...makeOutcome().raw,
          outcome: { prState: 'draft', ciState: 'failed', reviewState: 'none' },
          checks: { passed: ['Typecheck'], failed: ['Test'], pending: [] },
        },
      }),
      createdAt: '2026-05-06T04:00:00Z',
    })

    expect(pack.readinessVerdict).toBe('blocked')
    expect(pack.ciEvidence.status).toBe('failed')
    expect(pack.criteria.find(criterion => criterion.name === 'sound-verification')).toMatchObject({
      passed: false,
    })
    expect(pack.verdictRationale).toContain('CI status is failed')
  })

  it('fails closed when audit and PR outcome lineage disagree', () => {
    expect(() => buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome({
        raw: {
          ...makeOutcome().raw,
          workGraphId: 'WG-DIFFERENT',
        },
      }),
      createdAt: '2026-05-06T04:00:00Z',
    })).toThrow(/workGraphId/i)
  })

  it('fails closed when required lineage is missing', () => {
    expect(() => buildMergeReadinessPack({
      audit: makeAudit({ signalId: '' }),
      prOutcomeSignal: makeOutcome(),
      createdAt: '2026-05-06T04:00:00Z',
    })).toThrow(/signalId/i)
  })

  it('persists an MRP idempotently by MRP id', async () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome(),
      createdAt: '2026-05-06T04:00:00Z',
    })
    const db = {
      queryOne: vi.fn(async (_query: string, _bindVars: Record<string, unknown>) => null),
      save: vi.fn(async (_collection: string, doc: Record<string, unknown>) => doc),
    }

    const persisted = await ingestMergeReadinessPack(pack, db as never)

    expect(db.queryOne).toHaveBeenCalledOnce()
    expect(db.queryOne.mock.calls[0]![0]).toContain('merge_readiness_packs')
    expect(db.queryOne.mock.calls[0]![1]).toEqual({ id: 'MRP-MOTE4M1R-G7I0-71' })
    expect(db.save).toHaveBeenCalledOnce()
    expect(db.save.mock.calls[0]![0]).toBe('merge_readiness_packs')
    expect(db.save.mock.calls[0]![1]).toMatchObject({
      _key: 'MRP-MOTE4M1R-G7I0-71',
      id: 'MRP-MOTE4M1R-G7I0-71',
      verdict: 'merge-ready',
      readinessVerdict: 'ready',
      sourceRefs: [
        'SIG-MOTDWPYM-LTW5',
        'PRS-MOTDWQ0T-S55Y',
        'BC-MOTDWSVY-PQOO',
        'FP-MOTDWVR2-W7UN',
        'WG-MOTE4M1R-G7I0',
        'SIG-MOTILTZ0-6DGK',
      ],
    })
    expect(persisted).toMatchObject({
      id: 'MRP-MOTE4M1R-G7I0-71',
      verdict: 'merge-ready',
    })
  })

  it('returns an existing persisted MRP without saving a duplicate when PR head is unchanged', async () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome(),
      createdAt: '2026-05-06T04:00:00Z',
    })
    const existing = {
      _key: pack.id,
      id: pack.id,
      verdict: 'merge-ready',
      prEvidence: {
        headSha: pack.prEvidence.headSha,
      },
    }
    const db = {
      queryOne: vi.fn(async (_query: string, _bindVars: Record<string, unknown>) => existing),
      save: vi.fn(),
      update: vi.fn(),
    }

    await expect(ingestMergeReadinessPack(pack, db as never)).resolves.toBe(existing)
    expect(db.save).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('refreshes an existing persisted MRP when PR head changes', async () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome({
        _key: 'SIG-NEW-HEAD',
        raw: {
          ...makeOutcome().raw,
          pr: {
            ...makeOutcome().raw?.pr,
            headSha: 'd924c8137c0ef004b8ee52028ea9a49ad289be93',
          },
          observedAt: '2026-05-06T21:45:00Z',
        },
      }),
      createdAt: '2026-05-06T21:45:00Z',
    })
    const existing = {
      _key: pack.id,
      id: pack.id,
      verdict: 'merge-ready',
      prEvidence: {
        headSha: 'ff6187ac67c945a4fe007f666f32d337ecafcfd8',
      },
    }
    const db = {
      queryOne: vi.fn(async (_query: string, _bindVars: Record<string, unknown>) => existing),
      save: vi.fn(),
      update: vi.fn(async (_collection: string, _key: string, patch: Record<string, unknown>) => ({
        ...existing,
        ...patch,
      })),
    }

    const persisted = await ingestMergeReadinessPack(pack, db as never)

    expect(db.save).not.toHaveBeenCalled()
    expect(db.update).toHaveBeenCalledWith(
      'merge_readiness_packs',
      'MRP-MOTE4M1R-G7I0-71',
      expect.objectContaining({
        prEvidence: expect.objectContaining({
          signalId: 'SIG-NEW-HEAD',
          headSha: 'd924c8137c0ef004b8ee52028ea9a49ad289be93',
        }),
        ciEvidence: expect.objectContaining({
          commitSha: 'd924c8137c0ef004b8ee52028ea9a49ad289be93',
        }),
        verdict: 'merge-ready',
        refreshedAt: '2026-05-06T21:45:00Z',
      }),
    )
    expect(persisted).toMatchObject({
      prEvidence: {
        headSha: 'd924c8137c0ef004b8ee52028ea9a49ad289be93',
      },
    })
  })

  it('fails closed before persistence when MRP verdict is malformed', async () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome(),
      createdAt: '2026-05-06T04:00:00Z',
    })
    const db = {
      queryOne: vi.fn(),
      save: vi.fn(),
    }

    await expect(ingestMergeReadinessPack({
      ...pack,
      readinessVerdict: 'maybe',
    } as never, db as never)).rejects.toThrow(/readinessVerdict/i)
    expect(db.queryOne).not.toHaveBeenCalled()
    expect(db.save).not.toHaveBeenCalled()
  })

  it('fails closed before persistence when required lineage is absent', async () => {
    const pack = buildMergeReadinessPack({
      audit: makeAudit(),
      prOutcomeSignal: makeOutcome(),
      createdAt: '2026-05-06T04:00:00Z',
    })
    const db = {
      queryOne: vi.fn(),
      save: vi.fn(),
    }

    await expect(ingestMergeReadinessPack({
      ...pack,
      sourceRefs: [],
    }, db as never)).rejects.toThrow(/sourceRefs/i)
    expect(db.queryOne).not.toHaveBeenCalled()
    expect(db.save).not.toHaveBeenCalled()
  })
})
