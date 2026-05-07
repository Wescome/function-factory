import { describe, expect, it } from 'vitest'
import { evaluateFunctionIdentity } from './function-identity'

describe('function identity diagnostic', () => {
  it('reports proposal-keyed lifecycle and materialized Function identity as mapped but not migrated', () => {
    const report = evaluateFunctionIdentity({
      proposalKey: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      proposalDocument: {
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      },
      functionDocument: null,
      mergeReadinessPack: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        proposalId: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
        verdict: 'merge-ready',
        prEvidence: {
          signalId: 'SIG-MOW36LRI-I3NG',
          headSha: '99d78b7c609c3c3a2005e5ef10c68521f2cf69b6',
        },
      },
    })

    expect(report).toMatchObject({
      proposalKey: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      derivedFunctionId: 'FN-MOTDWVR2-W7UN',
      identityConsistent: true,
      resolution: 'mapped_not_migrated',
      mutationApplied: false,
      runtime: {
        proposalDocumentFound: true,
        proposalLifecycleState: 'produced',
        functionDocumentFound: false,
        functionLifecycleState: null,
      },
      mergeReadiness: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        proposalId: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
        consistent: true,
      },
      migrationPlan: {
        required: true,
        safeToApply: true,
        operations: [
          {
            action: 'create_function_document',
            targetKey: 'FN-MOTDWVR2-W7UN',
            sourceKey: 'FP-MOTDWVR2-W7UN',
            fields: {
              _key: 'FN-MOTDWVR2-W7UN',
              id: 'FN-MOTDWVR2-W7UN',
              proposal_ref: 'FP-MOTDWVR2-W7UN',
              functionId: 'FN-MOTDWVR2-W7UN',
              lifecycleState: 'produced',
              lifecycleStateSource: 'FP-MOTDWVR2-W7UN',
            },
          },
          {
            action: 'preserve_proposal_document',
            targetKey: 'FP-MOTDWVR2-W7UN',
          },
          {
            action: 'block_monitored_promotion',
            targetKey: 'FN-MOTDWVR2-W7UN',
          },
        ],
      },
    })
    expect(report.findings).toEqual([
      'Materialized Function document FN-MOTDWVR2-W7UN is not present in specs_functions; lifecycle remains proposal-keyed.',
    ])
  })

  it('reports inconsistent identities when the MRP points at a different Function', () => {
    const report = evaluateFunctionIdentity({
      proposalKey: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      proposalDocument: {
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      },
      functionDocument: null,
      mergeReadinessPack: {
        id: 'MRP-MOTE4M1R-G7I0-71',
        proposalId: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-DIFFERENT',
        verdict: 'merge-ready',
      },
    })

    expect(report).toMatchObject({
      identityConsistent: false,
      resolution: 'inconsistent',
      mergeReadiness: {
        consistent: false,
      },
      migrationPlan: {
        required: false,
        safeToApply: false,
        operations: [{
          action: 'halt_identity_inconsistent',
          targetKey: 'FN-MOTDWVR2-W7UN',
        }],
      },
    })
    expect(report.findings).toContain('Merge-readiness pack identity does not match the supplied proposal/function pair.')
  })

  it('reports no migration requirement after the Function document is materialized', () => {
    const report = evaluateFunctionIdentity({
      proposalKey: 'FP-MOTDWVR2-W7UN',
      functionId: 'FN-MOTDWVR2-W7UN',
      proposalDocument: {
        _key: 'FP-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
      },
      functionDocument: {
        _key: 'FN-MOTDWVR2-W7UN',
        lifecycleState: 'produced',
        proposal_ref: 'FP-MOTDWVR2-W7UN',
        functionId: 'FN-MOTDWVR2-W7UN',
      },
    })

    expect(report).toMatchObject({
      identityConsistent: true,
      resolution: 'fully_materialized',
      migrationPlan: {
        required: false,
        safeToApply: true,
        operations: [{
          action: 'block_monitored_promotion',
          targetKey: 'FN-MOTDWVR2-W7UN',
        }],
      },
    })
  })
})
