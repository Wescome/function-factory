/**
 * Tests for PR generation from synthesis atom results.
 *
 * Verifies that the PR generator correctly:
 *   - Generates branch names from proposalId
 *   - Builds PR bodies with lineage and atom summaries
 *   - Handles missing/empty atomResults
 *   - Handles missing codeArtifact gracefully
 *   - Skips atoms with verdict != pass
 *   - Returns success: false on API errors
 *
 * All GitHub API calls are mocked — no real API calls.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  generatePR,
  buildBranchName,
  buildPRBody,
  type PRGenerationInput,
  type PRGenerationResult,
} from './generate-pr'

vi.mock('../github-app-auth', () => ({
  getInstallationToken: vi.fn(async () => 'ghs_installation_token'),
}))

// ── Mock fetch ──────────────────────────────────────────────────────

const originalFetch = globalThis.fetch

const githubAppEnv = {
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: 'test-private-key',
  GITHUB_TARGET_REPO: 'Wescome/function-factory',
}

function mockFetchSuccess() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  const mockFn = vi.fn(async (url: string | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.url
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: urlStr, method, body })

    // GET /repos/{owner}/{repo}/git/ref/heads/main — return main SHA
    if (urlStr.includes('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({
        object: { sha: 'abc123mainsha' },
      }), { status: 200 })
    }

    // GET /repos/{owner}/{repo}/git/commits/{sha} — return base tree SHA
    if (urlStr.includes('/git/commits/abc123mainsha') && method === 'GET') {
      return new Response(JSON.stringify({
        sha: 'basecommitsha',
        tree: { sha: 'basetreesha' },
      }), { status: 200 })
    }

    // POST /repos/{owner}/{repo}/git/refs — create branch
    if (urlStr.includes('/git/refs') && method === 'POST') {
      return new Response(JSON.stringify({
        ref: `refs/heads/${body?.ref?.replace('refs/heads/', '')}`,
      }), { status: 201 })
    }

    // GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1 — return base tree
    if (urlStr.includes('/git/trees/basetreesha?recursive=1') && method === 'GET') {
      return new Response(JSON.stringify({
        tree: [],
        truncated: false,
      }), { status: 200 })
    }

    // POST /repos/{owner}/{repo}/git/blobs — create blob
    if (urlStr.includes('/git/blobs') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'blobsha123' }), { status: 201 })
    }

    // POST /repos/{owner}/{repo}/git/trees — create tree
    if (urlStr.endsWith('/git/trees') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'newtreesha' }), { status: 201 })
    }

    // POST /repos/{owner}/{repo}/git/commits — create commit
    if (urlStr.endsWith('/git/commits') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'newcommitsha' }), { status: 201 })
    }

    // PATCH /repos/{owner}/{repo}/git/refs/heads/{branch} — update branch
    if (urlStr.includes('/git/refs/heads/') && method === 'PATCH') {
      return new Response(JSON.stringify({ object: { sha: 'newcommitsha' } }), { status: 200 })
    }

    // POST /repos/{owner}/{repo}/pulls — create PR
    if (urlStr.includes('/pulls') && method === 'POST') {
      return new Response(JSON.stringify({
        html_url: 'https://github.com/Wescome/function-factory/pull/42',
        number: 42,
      }), { status: 201 })
    }

    // POST /labels and POST /issues/{n}/labels — best-effort labels
    if (urlStr.includes('/labels') && method === 'POST') {
      return new Response(JSON.stringify({}), { status: 201 })
    }

    return new Response('Not Found', { status: 404 })
  })

  globalThis.fetch = mockFn as unknown as typeof fetch
  return { mockFn, calls }
}

function mockFetchBranchExists() {
  globalThis.fetch = vi.fn(async (url: string | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.url
    const method = init?.method ?? 'GET'

    // Branch already exists
    if (urlStr.includes('/git/refs') && method === 'POST') {
      return new Response(JSON.stringify({
        message: 'Reference already exists',
      }), { status: 422 })
    }

    // GET main SHA still works
    if (urlStr.includes('/git/ref/heads/main')) {
      return new Response(JSON.stringify({
        object: { sha: 'abc123mainsha' },
      }), { status: 200 })
    }

    // GET commit still works before branch creation is attempted
    if (urlStr.includes('/git/commits/abc123mainsha') && method === 'GET') {
      return new Response(JSON.stringify({
        sha: 'basecommitsha',
        tree: { sha: 'basetreesha' },
      }), { status: 200 })
    }

    return new Response('Not Found', { status: 404 })
  }) as unknown as typeof fetch
}

function mockFetchApiError() {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
  }) as unknown as typeof fetch
}

function mockFetchNetworkError() {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('Network connection refused')
  }) as unknown as typeof fetch
}

// ── Test data ───────────────────────────────────────────────────────

function makeInput(overrides?: Partial<PRGenerationInput>): PRGenerationInput {
  return {
    signalTitle: 'PR candidate: ES-001',
    proposalId: 'FP-001',
    executableSpecificationId: 'ES-001',
    atomResults: {
      'atom-1': {
        atomId: 'atom-1',
        verdict: { decision: 'pass' },
        codeArtifact: {
          files: [
            { path: 'src/utils/helper.ts', content: 'export const x = 1', action: 'create' as const },
          ],
          summary: 'Added utility helper',
        },
      },
      'atom-2': {
        atomId: 'atom-2',
        verdict: { decision: 'pass' },
        codeArtifact: {
          files: [
            { path: 'src/index.ts', content: 'import { x } from "./utils/helper"', action: 'modify' as const },
          ],
          summary: 'Updated index to use helper',
        },
      },
    },
    sourceRefs: ['SIG:SIG-001', 'PRS:PRS-001', 'BC:BC-001', 'FN:FP-001', 'ES:ES-001'],
    confidence: 0.95,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('buildBranchName', () => {
  it('generates correct branch name from proposalId', () => {
    expect(buildBranchName('FP-001', 'abcdef12')).toBe('factory/fn-fp-001-abcdef12')
  })

  it('lowercases the proposalId', () => {
    expect(buildBranchName('FP-MY-PROPOSAL')).toBe('factory/fn-fp-my-proposal-00000000')
  })

  it('truncates long proposalIds to keep branch under 50 chars', () => {
    const longId = 'FP-this-is-a-very-long-proposal-id-that-exceeds-fifty-characters'
    const branch = buildBranchName(longId)
    expect(branch.length).toBeLessThanOrEqual(50)
    expect(branch.startsWith('factory/fn-')).toBe(true)
  })

  it('replaces spaces with hyphens', () => {
    expect(buildBranchName('FP some proposal')).toBe('factory/fn-fp-some-proposal-00000000')
  })
})

describe('buildPRBody', () => {
  it('includes lineage sourceRefs', () => {
    const input = makeInput()
    const body = buildPRBody(input)
    expect(body).toContain('SIG:SIG-001')
    expect(body).toContain('PRS:PRS-001')
    expect(body).toContain('ES:ES-001')
  })

  it('includes atom summaries for passed atoms', () => {
    const input = makeInput()
    const body = buildPRBody(input)
    expect(body).toContain('atom-1')
    expect(body).toContain('Added utility helper')
    expect(body).toContain('atom-2')
    expect(body).toContain('Updated index to use helper')
  })

  it('includes confidence score', () => {
    const input = makeInput()
    const body = buildPRBody(input)
    expect(body).toContain('0.95')
  })

  it('handles empty atomResults', () => {
    const input = makeInput({ atomResults: {} })
    const body = buildPRBody(input)
    expect(body).toContain('No atom results')
  })
})

describe('generatePR', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('creates branch and PR with correct files', async () => {
    const { mockFn, calls } = mockFetchSuccess()
    const input = makeInput()

    const result = await generatePR(input, githubAppEnv)

    expect(result.success).toBe(true)
    expect(result.prUrl).toBe('https://github.com/Wescome/function-factory/pull/42')
    expect(result.branchName).toMatch(/^factory\/fn-/)
    expect(result.filesWritten).toBe(2)

    // Verify API call sequence
    const getMainRef = calls.find(c => c.url.includes('/git/ref/heads/main') && c.method === 'GET')
    expect(getMainRef).toBeDefined()

    const createBranch = calls.find(c => c.url.includes('/git/refs') && c.method === 'POST')
    expect(createBranch).toBeDefined()
    expect((createBranch!.body as Record<string, unknown>).ref).toMatch(/^refs\/heads\/factory\/fn-/)

    const fileWrites = calls.filter(c => c.url.includes('/git/blobs') && c.method === 'POST')
    expect(fileWrites.length).toBe(2)

    const createPR = calls.find(c => c.url.includes('/pulls') && c.method === 'POST')
    expect(createPR).toBeDefined()
    expect((createPR!.body as Record<string, unknown>).title).toContain('[Factory]')
    expect((createPR!.body as Record<string, unknown>).base).toBe('main')
  })

  it('skips atoms with verdict != pass', async () => {
    const { calls } = mockFetchSuccess()
    const input = makeInput({
      atomResults: {
        'atom-pass': {
          atomId: 'atom-pass',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [{ path: 'src/a.ts', content: 'pass', action: 'create' }],
            summary: 'Passed atom',
          },
        },
        'atom-fail': {
          atomId: 'atom-fail',
          verdict: { decision: 'fail' },
          codeArtifact: {
            files: [{ path: 'src/b.ts', content: 'fail', action: 'create' }],
            summary: 'Failed atom',
          },
        },
      },
    })

    const result = await generatePR(input, githubAppEnv)

    expect(result.success).toBe(true)
    expect(result.filesWritten).toBe(1)

    // Only atom-pass file should be written
    const fileWrites = calls.filter(c => c.url.includes('/git/blobs') && c.method === 'POST')
    expect(fileWrites.length).toBe(1)
  })

  it('handles missing codeArtifact gracefully', async () => {
    const { calls } = mockFetchSuccess()
    const input = makeInput({
      atomResults: {
        'atom-no-code': {
          atomId: 'atom-no-code',
          verdict: { decision: 'pass' },
          codeArtifact: null,
        },
        'atom-with-code': {
          atomId: 'atom-with-code',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [{ path: 'src/c.ts', content: 'code', action: 'create' }],
            summary: 'Has code',
          },
        },
      },
    })

    const result = await generatePR(input, githubAppEnv)

    expect(result.success).toBe(true)
    expect(result.filesWritten).toBe(1)
  })

  it('handles missing atomResults gracefully', async () => {
    mockFetchSuccess()
    const input = makeInput({
      atomResults: {},
    })

    const result = await generatePR(input, githubAppEnv)

    // No files to write — should fail closed before opening a phantom PR
    expect(result.success).toBe(false)
    expect(result.filesWritten).toBe(0)
  })

  it('BLOCKS delete action — Factory PRs never delete files', async () => {
    const { calls } = mockFetchSuccess()
    const input = makeInput({
      atomResults: {
        'atom-delete': {
          atomId: 'atom-delete',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [{ path: 'src/old.ts', content: '', action: 'delete' }],
            summary: 'Tried to delete a file',
          },
        },
      },
    })

    const result = await generatePR(input, githubAppEnv)

    // Delete is BLOCKED — no blob is created for this file
    const blobWrites = calls.filter(c => c.url.includes('/git/blobs') && c.method === 'POST')
    expect(blobWrites).toHaveLength(0)
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some(w => w.includes('BLOCKED') && w.includes('delete'))).toBe(true)
  })

  it('returns success: false when branch creation fails (not 422)', async () => {
    mockFetchApiError()
    const input = makeInput()

    const result = await generatePR(input, githubAppEnv)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.filesWritten).toBe(0)
  })

  it('returns success: false on network error', async () => {
    mockFetchNetworkError()
    const input = makeInput()

    const result = await generatePR(input, githubAppEnv)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Network connection refused')
    expect(result.filesWritten).toBe(0)
  })

  it('returns success: false when branch already exists (422)', async () => {
    mockFetchBranchExists()
    const input = makeInput()

    const result = await generatePR(input, githubAppEnv)

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
    expect(result.filesWritten).toBe(0)
  })

  it('uses Authorization Bearer header for all API calls', async () => {
    const { mockFn } = mockFetchSuccess()
    const input = makeInput()

    await generatePR(input, githubAppEnv)

    for (const call of mockFn.mock.calls) {
      const init = call[1] as RequestInit | undefined
      const headers = init?.headers as Record<string, string> | undefined
      if (headers) {
        expect(headers['Authorization']).toBe('Bearer ghs_installation_token')
      }
    }
  })
})
