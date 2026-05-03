/**
 * Phase 1: Phantom synthesis guard tests (Fix 2 + Fix 3).
 *
 * RED tests that FAIL against current code. Engineer makes them pass.
 *
 * Fix 2: filesWritten=0 guard
 *   When all edits fail and no files are written, generatePR currently
 *   still creates a PR (success: true). This is a phantom PR -- a PR with
 *   zero file changes. The guard must return success: false and clean up
 *   the orphan branch.
 *
 * Fix 3: synthesis:phantom-pr signal
 *   When PR generation returns filesWritten=0, the feedback consumer
 *   must emit a synthesis:phantom-pr signal so the Factory can learn
 *   from the failure. Currently no signal is emitted.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  generatePR,
  type PRGenerationInput,
  type PRGenerationResult,
} from './generate-pr'

// ── Mock fetch ──────────────────────────────────────────────────────

const originalFetch = globalThis.fetch

/**
 * Mock fetch that:
 * - Returns main SHA on GET /git/ref/heads/main
 * - Creates branch on POST /git/refs
 * - Returns existing file content on GET /contents/ (file exists)
 * - Accepts PUT /contents/ (file update)
 * - Accepts DELETE /git/refs/ (branch cleanup)
 * - Creates PR on POST /pulls
 * - Accepts POST /labels, POST /issues/{n}/labels
 *
 * The existing file content is crafted so search strings in the edits
 * will NOT match -- forcing all edits to fail.
 */
function mockFetchAllEditsFail() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  const mockFn = vi.fn(async (url: string | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.url
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: urlStr, method, body })

    // GET main SHA
    if (urlStr.includes('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({
        object: { sha: 'abc123mainsha' },
      }), { status: 200 })
    }

    // POST create branch
    if (urlStr.includes('/git/refs') && method === 'POST') {
      return new Response(JSON.stringify({
        ref: `refs/heads/${body?.ref?.replace('refs/heads/', '')}`,
      }), { status: 201 })
    }

    // DELETE /git/refs/heads/{branch} -- branch cleanup
    if (urlStr.includes('/git/refs/heads/') && method === 'DELETE') {
      return new Response('', { status: 204 })
    }

    // GET /contents/{path} -- file EXISTS with content that won't match edits
    if (urlStr.includes('/contents/') && method === 'GET') {
      return new Response(JSON.stringify({
        sha: 'existing-sha-000',
        content: btoa('// completely different content that no edit will match\nconst z = 999;\n'),
        encoding: 'base64',
      }), { status: 200 })
    }

    // PUT /contents/{path}
    if (urlStr.includes('/contents/') && method === 'PUT') {
      return new Response(JSON.stringify({
        content: { sha: 'new-sha-456' },
      }), { status: 201 })
    }

    // POST create PR
    if (urlStr.includes('/pulls') && method === 'POST') {
      return new Response(JSON.stringify({
        html_url: 'https://github.com/Wescome/function-factory/pull/99',
        number: 99,
      }), { status: 201 })
    }

    // POST /labels (best-effort)
    if (urlStr.includes('/labels') && method === 'POST') {
      return new Response(JSON.stringify({}), { status: 201 })
    }

    return new Response('Not Found', { status: 404 })
  })

  globalThis.fetch = mockFn as unknown as typeof fetch
  return { mockFn, calls }
}

/**
 * Mock fetch identical to above but with one atom that uses create action
 * (full content, no edits) so at least one file is written.
 */
function mockFetchOneFileSucceeds() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  const mockFn = vi.fn(async (url: string | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.url
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: urlStr, method, body })

    if (urlStr.includes('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({ object: { sha: 'mainsha' } }), { status: 200 })
    }
    if (urlStr.includes('/git/refs') && method === 'POST') {
      return new Response(JSON.stringify({ ref: 'refs/heads/factory/fp-phantom' }), { status: 201 })
    }
    // GET /contents/ -- 404 (file does not exist) so create works
    if (urlStr.includes('/contents/') && method === 'GET') {
      return new Response('Not Found', { status: 404 })
    }
    if (urlStr.includes('/contents/') && method === 'PUT') {
      return new Response(JSON.stringify({ content: { sha: 'new-sha' } }), { status: 201 })
    }
    if (urlStr.includes('/pulls') && method === 'POST') {
      return new Response(JSON.stringify({ html_url: 'https://github.com/x/y/pull/1', number: 1 }), { status: 201 })
    }
    if (urlStr.includes('/labels')) {
      return new Response(JSON.stringify({}), { status: 201 })
    }
    return new Response('Not Found', { status: 404 })
  })

  globalThis.fetch = mockFn as unknown as typeof fetch
  return { mockFn, calls }
}

// ── Test data ───────────────────────────────────────────────────────

function makeInput(overrides?: Partial<PRGenerationInput>): PRGenerationInput {
  return {
    signalTitle: 'PR candidate: phantom guard test',
    proposalId: 'FP-PHANTOM',
    workGraphId: 'WG-PHANTOM',
    atomResults: {},
    sourceRefs: ['SIG:SIG-PHANTOM'],
    confidence: 0.9,
    ...overrides,
  }
}

// ── Fix 2: filesWritten=0 guard ─────────────────────────────────────

describe('generate-pr: filesWritten=0 phantom guard (Fix 2)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns success:false when all edits fail and filesWritten is 0', async () => {
    // Setup: two atoms with modify+edits where search strings will NOT match
    // the existing file content. All edits fail -> filesWritten stays 0.
    mockFetchAllEditsFail()
    const input = makeInput({
      atomResults: {
        'atom-edit-fail-1': {
          atomId: 'atom-edit-fail-1',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/module-a.ts',
                action: 'modify' as const,
                edits: [
                  { search: 'THIS STRING DOES NOT EXIST IN THE FILE AT ALL PERIOD', replace: 'replaced' },
                ],
              },
            ],
            summary: 'Modify with edits that will not match',
          },
        },
        'atom-edit-fail-2': {
          atomId: 'atom-edit-fail-2',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/module-b.ts',
                action: 'modify' as const,
                edits: [
                  { search: 'ANOTHER STRING THAT ABSOLUTELY WILL NOT MATCH ANYTHING', replace: 'nope' },
                ],
              },
            ],
            summary: 'Another modify with non-matching edits',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    // CURRENT BEHAVIOR: success: true with filesWritten: 0 (phantom PR)
    // CORRECT BEHAVIOR: success: false with error mentioning 'Phantom' or 'no files'
    expect(result.success).toBe(false)
    expect(result.filesWritten).toBe(0)
    expect(result.error).toBeDefined()
    expect(result.error!.toLowerCase()).toContain('phantom')
  })

  it('returns success:true when at least one file is written', async () => {
    // Setup: one atom with create action (full content, no edits)
    mockFetchOneFileSucceeds()
    const input = makeInput({
      atomResults: {
        'atom-create-ok': {
          atomId: 'atom-create-ok',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/new-file.ts',
                action: 'create' as const,
                content: 'export const newThing = true',
              },
            ],
            summary: 'Creates a new file successfully',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    expect(result.success).toBe(true)
    expect(result.filesWritten).toBeGreaterThanOrEqual(1)
  })

  it('includes warnings in the failure result when all edits fail', async () => {
    // When all edits fail, the warnings array should contain the failure details
    mockFetchAllEditsFail()
    const input = makeInput({
      atomResults: {
        'atom-warn': {
          atomId: 'atom-warn',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/warn-file.ts',
                action: 'modify' as const,
                edits: [
                  { search: 'NONEXISTENT SEARCH STRING THAT WILL NEVER BE FOUND IN ANY FILE', replace: 'x' },
                ],
              },
            ],
            summary: 'Edits that fail',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    // CORRECT BEHAVIOR: result has warnings even when success is false
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.length).toBeGreaterThan(0)
    // At least one warning should mention edit failure
    expect(result.warnings!.some(w =>
      w.toLowerCase().includes('edit') || w.toLowerCase().includes('fail')
    )).toBe(true)
  })

  it('cleans up orphan branch on phantom detection', async () => {
    // When filesWritten=0, the orphan branch must be deleted to avoid
    // accumulating dead branches in the repository.
    const { calls } = mockFetchAllEditsFail()
    const input = makeInput({
      atomResults: {
        'atom-orphan': {
          atomId: 'atom-orphan',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/orphan.ts',
                action: 'modify' as const,
                edits: [
                  { search: 'SEARCH STRING NOT PRESENT IN THE EXISTING FILE CONTENT AT ALL', replace: 'gone' },
                ],
              },
            ],
            summary: 'Will produce orphan branch',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    // Should be failure (phantom)
    expect(result.success).toBe(false)

    // CORRECT BEHAVIOR: a DELETE call to /git/refs/heads/{branch} must be made
    const branchDeleteCall = calls.find(c =>
      c.url.includes('/git/refs/heads/factory/fp-phantom') && c.method === 'DELETE'
    )
    expect(branchDeleteCall).toBeDefined()
  })
})

// ── Fix 3: synthesis:phantom-pr signal ──────────────────────────────

describe('generate-pr: phantom signal emission (Fix 3)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('emits synthesis:phantom-pr signal when PR generation returns filesWritten:0', async () => {
    // This test verifies the RESULT object includes enough context for
    // the feedback consumer to emit the signal. The generatePR function
    // itself doesn't emit signals (it returns a result), but the result
    // must clearly indicate phantom status for the consumer to act on.
    mockFetchAllEditsFail()
    const input = makeInput({
      atomResults: {
        'atom-phantom-signal': {
          atomId: 'atom-phantom-signal',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/phantom.ts',
                action: 'modify' as const,
                edits: [
                  { search: 'NO MATCH POSSIBLE HERE BECAUSE CONTENT IS TOTALLY DIFFERENT', replace: 'x' },
                ],
              },
            ],
            summary: 'Phantom candidate',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    // CORRECT BEHAVIOR: result indicates phantom status unambiguously
    // so the feedback consumer can emit synthesis:phantom-pr
    expect(result.success).toBe(false)
    expect(result.filesWritten).toBe(0)
    // Error message must be specific enough for signal classification
    expect(result.error).toBeDefined()
    expect(result.error!).toMatch(/phantom|no files written|zero files/i)
  })

  it('does not indicate phantom when PR generation succeeds', async () => {
    // Baseline: successful PR should not trigger phantom signal
    mockFetchOneFileSucceeds()
    const input = makeInput({
      atomResults: {
        'atom-success': {
          atomId: 'atom-success',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/real-file.ts',
                action: 'create' as const,
                content: 'export const real = true',
              },
            ],
            summary: 'A real file that gets written',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    expect(result.success).toBe(true)
    expect(result.filesWritten).toBeGreaterThanOrEqual(1)
    // No phantom error
    expect(result.error).toBeUndefined()
  })
})
