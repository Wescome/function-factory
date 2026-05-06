import { describe, expect, it, vi } from 'vitest'
import {
  buildPROutcomeSignals,
  fetchPROutcomeFromGitHub,
  ingestPROutcomeSignals,
  normalizePROutcome,
  type PROutcomeInput,
} from './pr-outcome-signal'

function makeInput(overrides?: Partial<PROutcomeInput>): PROutcomeInput {
  return {
    lineage: {
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      signalId: 'SIG-MOTDWPYM-LTW5',
      pressureId: 'PRS-MOTDWQ0T-S55Y',
      capabilityId: 'BC-MOTDWSVY-PQOO',
      proposalId: 'FP-MOTDWVR2-W7UN',
      workGraphId: 'WG-MOTE4M1R-G7I0',
    },
    pullRequest: {
      number: 71,
      url: 'https://github.com/Wescome/function-factory/pull/71',
      title: '[Factory] Materialize WG-MOTE4M1R-G7I0 synthesis artifact',
      state: 'OPEN',
      draft: false,
      merged: false,
      headRefName: 'factory/fp-motdwvr2-w7un',
      baseRefName: 'main',
      headSha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0',
    },
    checks: [
      { name: 'Test', state: 'SUCCESS', workflow: 'CI' },
      { name: 'Typecheck', state: 'SUCCESS', workflow: 'CI' },
      { name: 'Factory PR Gate', state: 'SUCCESS', workflow: 'CI' },
    ],
    reviews: [],
    reviewRequests: [],
    observedAt: '2026-05-06T03:09:14Z',
    ...overrides,
  }
}

describe('normalizePROutcome', () => {
  it('detects ready open PR state and passing CI', () => {
    const outcome = normalizePROutcome(makeInput())

    expect(outcome.prState).toBe('ready')
    expect(outcome.ciState).toBe('passed')
    expect(outcome.reviewState).toBe('none')
  })

  it('detects draft, merged, and closed PR states distinctly', () => {
    expect(normalizePROutcome(makeInput({
      pullRequest: {
        ...makeInput().pullRequest,
        draft: true,
      },
    })).prState).toBe('draft')

    expect(normalizePROutcome(makeInput({
      pullRequest: {
        ...makeInput().pullRequest,
        state: 'CLOSED',
        merged: true,
      },
    })).prState).toBe('merged')

    expect(normalizePROutcome(makeInput({
      pullRequest: {
        ...makeInput().pullRequest,
        state: 'CLOSED',
        merged: false,
      },
    })).prState).toBe('closed')
  })

  it('treats any failing check as failed CI', () => {
    const outcome = normalizePROutcome(makeInput({
      checks: [
        { name: 'Test', state: 'SUCCESS' },
        { name: 'Typecheck', state: 'FAILURE' },
      ],
    }))

    expect(outcome.ciState).toBe('failed')
  })

  it('detects review approvals, requested reviewers, and requested changes', () => {
    expect(normalizePROutcome(makeInput({
      reviews: [{ state: 'APPROVED', author: 'architect' }],
    })).reviewState).toBe('approved')

    expect(normalizePROutcome(makeInput({
      reviewRequests: ['principal-reviewer'],
    })).reviewState).toBe('review-requested')

    expect(normalizePROutcome(makeInput({
      reviews: [
        { state: 'APPROVED', author: 'architect' },
        { state: 'CHANGES_REQUESTED', author: 'principal-reviewer' },
      ],
    })).reviewState).toBe('changes-requested')
  })
})

describe('buildPROutcomeSignals', () => {
  it('emits pr-ci-passed with full Factory lineage and PR metadata', () => {
    const [signal] = buildPROutcomeSignals(makeInput())

    expect(signal).toBeDefined()
    expect(signal!.signal.subtype).toBe('synthesis:pr-ci-passed')
    expect(signal!.autoApprove).toBe(false)
    expect(signal!.signal.source).toBe('factory:pr-outcome')
    expect(signal!.signal.sourceRefs).toEqual([
      'SIG:SIG-MOTDWPYM-LTW5',
      'PRS:PRS-MOTDWQ0T-S55Y',
      'BC:BC-MOTDWSVY-PQOO',
      'FN:FP-MOTDWVR2-W7UN',
      'WG:WG-MOTE4M1R-G7I0',
    ])
    expect(signal!.signal.raw).toMatchObject({
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      proposalId: 'FP-MOTDWVR2-W7UN',
      workGraphId: 'WG-MOTE4M1R-G7I0',
      pr: {
        number: 71,
        url: 'https://github.com/Wescome/function-factory/pull/71',
        headSha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0',
      },
      outcome: {
        prState: 'ready',
        ciState: 'passed',
      },
    })
  })

  it('emits pr-ci-failed when any GitHub check fails', () => {
    const signals = buildPROutcomeSignals(makeInput({
      checks: [
        { name: 'Test', state: 'SUCCESS' },
        { name: 'Typecheck', state: 'FAILURE' },
      ],
    }))

    expect(signals.map(s => s.signal.subtype)).toEqual(['synthesis:pr-ci-failed'])
    expect(signals[0]!.signal.description).toContain('Typecheck')
  })

  it('emits merge, close, approval, requested-review, and changes-requested signals', () => {
    expect(buildPROutcomeSignals(makeInput({
      pullRequest: { ...makeInput().pullRequest, state: 'CLOSED', merged: true },
      checks: [],
    })).map(s => s.signal.subtype)).toEqual(['synthesis:pr-merged'])

    expect(buildPROutcomeSignals(makeInput({
      pullRequest: { ...makeInput().pullRequest, state: 'CLOSED', merged: false },
      checks: [],
    })).map(s => s.signal.subtype)).toEqual(['synthesis:pr-closed'])

    expect(buildPROutcomeSignals(makeInput({
      checks: [],
      reviews: [{ state: 'APPROVED', author: 'architect' }],
    })).map(s => s.signal.subtype)).toEqual(['synthesis:pr-approved'])

    expect(buildPROutcomeSignals(makeInput({
      checks: [],
      reviewRequests: ['principal-reviewer'],
    })).map(s => s.signal.subtype)).toEqual(['synthesis:pr-review-requested'])

    expect(buildPROutcomeSignals(makeInput({
      checks: [],
      reviews: [{ state: 'CHANGES_REQUESTED', author: 'principal-reviewer' }],
    })).map(s => s.signal.subtype)).toEqual(['synthesis:pr-changes-requested'])
  })

  it('fails closed when required lineage is missing', () => {
    expect(() => buildPROutcomeSignals(makeInput({
      lineage: {
        ...makeInput().lineage,
        pipelineId: '',
      },
    }))).toThrow('lineage.pipelineId is required')
  })
})

describe('ingestPROutcomeSignals', () => {
  it('persists generated PR outcome signals through ingestSignal', async () => {
    const db = {
      queryOne: vi.fn(async () => null),
      save: vi.fn(async (_collection: string, signal: Record<string, unknown>) => signal),
    }

    const records = await ingestPROutcomeSignals(makeInput(), db as never)

    expect(records).toHaveLength(1)
    expect(db.queryOne).toHaveBeenCalledOnce()
    expect(db.save).toHaveBeenCalledOnce()
    expect(db.save.mock.calls[0]![0]).toBe('specs_signals')
    expect(db.save.mock.calls[0]![1]).toMatchObject({
      signalType: 'internal',
      source: 'factory:pr-outcome',
      subtype: 'synthesis:pr-ci-passed',
      raw: {
        pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      },
    })
  })
})

describe('fetchPROutcomeFromGitHub', () => {
  it('fetches PR, check, review, and requested-reviewer state from GitHub REST', async () => {
    const fetchFn = vi.fn(async (url: string | Request) => {
      const urlText = typeof url === 'string' ? url : url.url

      if (urlText.endsWith('/pulls/71')) {
        return new Response(JSON.stringify({
          number: 71,
          html_url: 'https://github.com/Wescome/function-factory/pull/71',
          title: '[Factory] Materialize WG-MOTE4M1R-G7I0 synthesis artifact',
          state: 'open',
          draft: false,
          merged: false,
          head: {
            ref: 'factory/fp-motdwvr2-w7un',
            sha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0',
          },
          base: { ref: 'main' },
        }), { status: 200 })
      }

      if (urlText.endsWith('/commits/b43cb8a729d68a3fd09852bed3a87dc435b6bda0/check-runs?per_page=100')) {
        return new Response(JSON.stringify({
          check_runs: [
            { name: 'Test', status: 'completed', conclusion: 'success', html_url: 'https://github.com/checks/test' },
            { name: 'Typecheck', status: 'completed', conclusion: 'success', html_url: 'https://github.com/checks/typecheck' },
          ],
        }), { status: 200 })
      }

      if (urlText.endsWith('/pulls/71/reviews')) {
        return new Response(JSON.stringify([
          { state: 'APPROVED', user: { login: 'architect' }, submitted_at: '2026-05-06T03:10:00Z' },
        ]), { status: 200 })
      }

      if (urlText.endsWith('/pulls/71/requested_reviewers')) {
        return new Response(JSON.stringify({
          users: [{ login: 'principal-reviewer' }],
          teams: [{ slug: 'factory-review' }],
        }), { status: 200 })
      }

      return new Response('not found', { status: 404 })
    })

    const input = await fetchPROutcomeFromGitHub({
      githubToken: 'ghp_test',
      repoOwner: 'Wescome',
      repoName: 'function-factory',
      pullNumber: 71,
      lineage: makeInput().lineage,
      observedAt: '2026-05-06T03:11:00Z',
      fetchFn,
    })

    expect(input.pullRequest).toMatchObject({
      number: 71,
      state: 'OPEN',
      draft: false,
      headSha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0',
    })
    expect(input.checks).toEqual([
      { name: 'Test', state: 'success', link: 'https://github.com/checks/test' },
      { name: 'Typecheck', state: 'success', link: 'https://github.com/checks/typecheck' },
    ])
    expect(input.reviews).toEqual([
      { state: 'APPROVED', author: 'architect', submittedAt: '2026-05-06T03:10:00Z' },
    ])
    expect(input.reviewRequests).toEqual(['principal-reviewer', 'team:factory-review'])
  })

  it('fails closed when GitHub PR fetch fails', async () => {
    const fetchFn = vi.fn(async () => new Response('missing', { status: 404 }))

    await expect(fetchPROutcomeFromGitHub({
      githubToken: 'ghp_test',
      repoOwner: 'Wescome',
      repoName: 'function-factory',
      pullNumber: 71,
      lineage: makeInput().lineage,
      fetchFn,
    })).rejects.toThrow('GitHub PR fetch failed')
  })
})
