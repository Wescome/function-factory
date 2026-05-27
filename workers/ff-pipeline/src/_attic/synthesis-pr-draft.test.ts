import { describe, expect, it } from 'vitest'
import {
  buildSynthesisPullRequestDraft,
  type SynthesisMaterializationAudit,
} from './synthesis-pr-draft'

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
    executableSpecificationId: 'ES-MOTE4M1R-G7I0',
    coherenceVerificationPassed: true,
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
      'pnpm --filter @factory/ff-pipeline test passed 61 files / 931 tests',
    ],
    notes: 'Retrospective audit record.',
    ...overrides,
  }
}

describe('synthesis PR draft plan', () => {
  it('builds a draft PR payload from a materialization audit', () => {
    const draft = buildSynthesisPullRequestDraft(makeAudit())

    expect(draft).toMatchObject({
      title: '[Factory] Materialize ES-MOTE4M1R-G7I0 synthesis artifact',
      branchName: 'factory/fn-fp-motdwvr2-w7un-00000000',
      baseBranch: 'main',
      executableSpecificationId: 'ES-MOTE4M1R-G7I0',
      proposalId: 'FP-MOTDWVR2-W7UN',
    })
    expect(draft.body).toContain('Pipeline: `b1b51f73-416d-4d87-90a5-9ccaa12bec76`')
    expect(draft.body).toContain('Coherence Verification: `pass`')
    expect(draft.body).toContain('workers/ff-pipeline/src/runtime-verification.ts')
    expect(draft.body).toContain('16ae4de2b48f6956246c2c6876151ee5690fbccde493e70ebe38bae4042d9b43')
    expect(draft.body).toContain('pnpm --filter @factory/ff-pipeline test passed 61 files / 931 tests')
  })

  it('includes lineage IDs in source_refs order', () => {
    const draft = buildSynthesisPullRequestDraft(makeAudit())

    expect(draft.sourceRefs).toEqual([
      'SIG-MOTDWPYM-LTW5',
      'PRS-MOTDWQ0T-S55Y',
      'BC-MOTDWSVY-PQOO',
      'FP-MOTDWVR2-W7UN',
      'ES-MOTE4M1R-G7I0',
    ])
    for (const ref of draft.sourceRefs) {
      expect(draft.body).toContain(`\`${ref}\``)
    }
  })

  it('fails closed when Coherence Verification did not pass', () => {
    expect(() => buildSynthesisPullRequestDraft(makeAudit({ coherenceVerificationPassed: false }))).toThrow(/Coherence Verification/i)
  })

  it('fails closed when runtime synthesis did not pass', () => {
    expect(() => buildSynthesisPullRequestDraft(makeAudit({ runtimeStatus: 'synthesis-failed' }))).toThrow(
      /synthesis-passed/i,
    )
  })

  it('fails closed when any atom did not pass', () => {
    expect(() => buildSynthesisPullRequestDraft(makeAudit({
      atomResults: [{ atomId: 'atom-001', decision: 'fail', confidence: 0.2, tests: '0/1' }],
    }))).toThrow(/atom-001/i)
  })

  it('fails closed when no files were materialized', () => {
    expect(() => buildSynthesisPullRequestDraft(makeAudit({ materializedFiles: [] }))).toThrow(/materialized/i)
  })
})
