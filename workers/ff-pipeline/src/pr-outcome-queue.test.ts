import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('cloudflare:workers', () => {
  class WorkflowEntrypoint {
    env: unknown
    constructor() {}
  }
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { WorkflowEntrypoint, DurableObject }
})

vi.mock('agents', () => {
  class Agent {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
    async runFiber(_name: string, fn: (ctx: unknown) => Promise<unknown>) {
      return fn({ id: 'mock-fiber', stash: () => {}, snapshot: null })
    }
    stash() {}
    async onFiberRecovered() {}
  }
  const callable = () => (_target: unknown, _context: unknown) => _target
  return { Agent, callable }
})

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))

const mockDb = {
  queryOne: vi.fn(async () => null),
  save: vi.fn(async (_collection: string, signal: Record<string, unknown>) => signal),
  setValidator: vi.fn(),
}

vi.mock('@factory/arango-client', () => ({
  createClientFromEnv: () => mockDb,
}))

vi.mock('@factory/artifact-validator', () => ({
  validateArtifact: () => ({ valid: true, violations: [] }),
}))

function createEnv() {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    GATES: { evaluateCoherenceVerification: vi.fn() },
    FACTORY_PIPELINE: { create: vi.fn(), get: vi.fn() },
    COORDINATOR: { idFromName: vi.fn(), get: vi.fn() },
    ATOM_EXECUTOR: { idFromName: vi.fn(), get: vi.fn() },
    SYNTHESIS_QUEUE: { send: vi.fn() },
    SYNTHESIS_RESULTS: { send: vi.fn() },
    ATOM_RESULTS: { send: vi.fn() },
    GITHUB_TOKEN: 'ghp_test',
  }
}

function createMessage(body: unknown, attempts = 1) {
  return {
    id: 'msg-pr-outcome',
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function createFeedbackBatch(message: ReturnType<typeof createMessage>) {
  return {
    queue: 'feedback-signals',
    messages: [message],
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  }
}

function makeOutcome() {
  return {
    lineage: {
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      signalId: 'SIG-MOTDWPYM-LTW5',
      pressureId: 'PRS-MOTDWQ0T-S55Y',
      capabilityId: 'BC-MOTDWSVY-PQOO',
      proposalId: 'FP-MOTDWVR2-W7UN',
      executableSpecificationId: 'WG-MOTE4M1R-G7I0',
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
  }
}

describe('feedback-signals pr-outcome queue messages', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mockDb.queryOne.mockClear()
    mockDb.save.mockClear()
    mockDb.setValidator.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('normalizes and ingests Factory PR outcome signals', async () => {
    const { default: worker } = await import('./index')
    const message = createMessage({ type: 'pr-outcome', outcome: makeOutcome() })

    await worker.queue(createFeedbackBatch(message) as never, createEnv() as never, {} as never)

    expect(message.ack).toHaveBeenCalledOnce()
    expect(message.retry).not.toHaveBeenCalled()
    expect(mockDb.save).toHaveBeenCalledOnce()
    expect(mockDb.save.mock.calls[0]![0]).toBe('specs_signals')
    expect(mockDb.save.mock.calls[0]![1]).toMatchObject({
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
      raw: {
        pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
        pr: {
          number: 71,
          headSha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0',
        },
      },
    })
  })

  it('retries malformed PR outcome queue messages before max attempts', async () => {
    const { default: worker } = await import('./index')
    const message = createMessage({ type: 'pr-outcome' })

    await worker.queue(createFeedbackBatch(message) as never, createEnv() as never, {} as never)

    expect(message.retry).toHaveBeenCalledOnce()
    expect(message.ack).not.toHaveBeenCalled()
    expect(mockDb.save).not.toHaveBeenCalled()
  })

  it('can fetch PR outcome state from GitHub when only PR number and lineage are supplied', async () => {
    globalThis.fetch = vi.fn(async (url: string | Request) => {
      const urlText = typeof url === 'string' ? url : url.url
      if (urlText.endsWith('/pulls/71')) {
        return new Response(JSON.stringify({
          number: 71,
          html_url: 'https://github.com/Wescome/function-factory/pull/71',
          title: '[Factory] Materialize WG-MOTE4M1R-G7I0 synthesis artifact',
          state: 'open',
          draft: false,
          merged: false,
          head: { ref: 'factory/fp-motdwvr2-w7un', sha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0' },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      if (urlText.endsWith('/commits/b43cb8a729d68a3fd09852bed3a87dc435b6bda0/check-runs?per_page=100')) {
        return new Response(JSON.stringify({
          check_runs: [
            { name: 'Test', conclusion: 'success' },
            { name: 'Typecheck', conclusion: 'success' },
          ],
        }), { status: 200 })
      }
      if (urlText.endsWith('/pulls/71/reviews')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (urlText.endsWith('/pulls/71/requested_reviewers')) {
        return new Response(JSON.stringify({ users: [], teams: [] }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const message = createMessage({
      type: 'pr-outcome',
      pullNumber: 71,
      lineage: makeOutcome().lineage,
    })
    const { default: worker } = await import('./index')

    await worker.queue(createFeedbackBatch(message) as never, createEnv() as never, {} as never)

    expect(message.ack).toHaveBeenCalledOnce()
    expect(mockDb.save).toHaveBeenCalledOnce()
    expect(mockDb.save.mock.calls[0]![1]).toMatchObject({
      subtype: 'synthesis:pr-ci-passed',
      raw: {
        pr: {
          number: 71,
          headSha: 'b43cb8a729d68a3fd09852bed3a87dc435b6bda0',
        },
      },
    })
  })
})
