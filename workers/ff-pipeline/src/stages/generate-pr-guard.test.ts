/**
 * Phase A: generate-pr guard tests.
 *
 * RED tests for discrepancies #3 and #8 from the structural audit.
 *
 * Discrepancy #3 (CRITICAL):
 *   generate-pr.ts has no guard against action='create' on files that
 *   already exist on the branch. When the GitHub API GET returns 200
 *   (file exists) but the action says 'create', the pipeline should
 *   either reject the file or force the action to 'modify'.
 *
 * Discrepancy #8 (MEDIUM):
 *   ORL CODE_ARTIFACT_SCHEMA postCoerce defaults empty action to 'create'
 *   even when the file entry has an edits[] array. A file with edits is
 *   by definition a modification, not a creation. postCoerce should
 *   detect this and set action='modify'.
 *
 * These tests describe the CORRECT behavior. They will FAIL against
 * the current codebase (RED phase). The Engineer writes code to make
 * them pass (GREEN phase).
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  generatePR,
  type PRGenerationInput,
} from './generate-pr'
import {
  processAgentOutput,
  CODE_ARTIFACT_SCHEMA,
} from '../agents/output-reliability'

// ── Mock fetch ──────────────────────────────────────────────────────

const originalFetch = globalThis.fetch

/**
 * Mock fetch that returns 200 (file exists with content and SHA) for
 * GET /contents/{path} requests. This simulates files that already
 * exist on the branch — the critical condition for discrepancy #3.
 */
function mockFetchWithExistingFiles() {
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

    // GET /contents/{path} — file EXISTS on branch (returns SHA + content)
    if (urlStr.includes('/contents/') && method === 'GET') {
      return new Response(JSON.stringify({
        sha: 'existing-file-sha-999',
        content: btoa('// existing file content\nexport const x = 1;\n'),
        encoding: 'base64',
      }), { status: 200 })
    }

    // PUT /contents/{path} — create/update file
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

// ── Test data ───────────────────────────────────────────────────────

function makeInput(overrides?: Partial<PRGenerationInput>): PRGenerationInput {
  return {
    signalTitle: 'PR candidate: guard test',
    proposalId: 'FP-GUARD',
    workGraphId: 'WG-GUARD',
    atomResults: {},
    sourceRefs: ['SIG:SIG-GUARD'],
    confidence: 0.9,
    ...overrides,
  }
}

// ── Discrepancy #3 tests ────────────────────────────────────────────

describe('generate-pr: guard against create on existing files (discrepancy #3)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects create action on file that already exists on branch', async () => {
    // Setup: atom produces action='create' for a file that ALREADY EXISTS
    const { calls } = mockFetchWithExistingFiles()
    const input = makeInput({
      atomResults: {
        'atom-create-existing': {
          atomId: 'atom-create-existing',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/existing-module.ts',
                content: '// brand new content that overwrites existing',
                action: 'create',
              },
            ],
            summary: 'Creates a file that already exists',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    // The pipeline MUST detect this conflict. It should either:
    // (a) include a warning in the result, OR
    // (b) force the action to 'modify' and include the existing SHA
    //
    // Current behavior: silently overwrites. This test enforces that
    // a warning is surfaced when create hits an existing file.
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some(
      w => w.includes('create') && w.includes('existing')
    )).toBe(true)
  })

  it('forces action to modify when file exists on branch and action is create', async () => {
    // The pipeline should upgrade create -> modify when the file exists,
    // ensuring the PUT includes the existing SHA for proper git tree update.
    const { calls } = mockFetchWithExistingFiles()
    const input = makeInput({
      atomResults: {
        'atom-auto-modify': {
          atomId: 'atom-auto-modify',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/existing-module.ts',
                content: '// replacement content',
                action: 'create',
              },
            ],
            summary: 'Creates a file that exists — should auto-modify',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    expect(result.success).toBe(true)

    // The PUT call should include sha (existing file's SHA) because
    // the pipeline detected the file exists and upgraded to modify
    const putCalls = calls.filter(c => c.url.includes('/contents/') && c.method === 'PUT')
    expect(putCalls.length).toBe(1)
    const putBody = putCalls[0]!.body as Record<string, unknown>
    expect(putBody.sha).toBe('existing-file-sha-999')
  })

  it('allows create action when file does NOT exist on branch', async () => {
    // Standard case: create on a truly new file should work without warnings
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    globalThis.fetch = vi.fn(async (url: string | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.url
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      calls.push({ url: urlStr, method, body })

      if (urlStr.includes('/git/ref/heads/main') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'mainsha' } }), { status: 200 })
      }
      if (urlStr.includes('/git/refs') && method === 'POST') {
        return new Response(JSON.stringify({ ref: 'refs/heads/factory/fp-guard' }), { status: 201 })
      }
      // GET /contents/ returns 404 — file does NOT exist
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
    }) as unknown as typeof fetch

    const input = makeInput({
      atomResults: {
        'atom-new-file': {
          atomId: 'atom-new-file',
          verdict: { decision: 'pass' },
          codeArtifact: {
            files: [
              {
                path: 'src/brand-new.ts',
                content: 'export const fresh = true',
                action: 'create',
              },
            ],
            summary: 'Creates a genuinely new file',
          },
        },
      },
    })

    const result = await generatePR(input, 'ghp_test', 'Wescome', 'function-factory')

    expect(result.success).toBe(true)
    expect(result.filesWritten).toBe(1)
    // No warnings about create-on-existing
    const createExistingWarnings = (result.warnings ?? []).filter(
      w => w.includes('create') && w.includes('existing')
    )
    expect(createExistingWarnings).toHaveLength(0)
  })
})

// ── Discrepancy #8 tests ────────────────────────────────────────────

describe('ORL CODE_ARTIFACT_SCHEMA: action defaults when edits present (discrepancy #8)', () => {
  it('defaults action to modify when edits array is present', async () => {
    // When the LLM returns a file entry with edits[] but no action,
    // ORL postCoerce should set action='modify', not 'create'.
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/existing.ts',
          edits: [{ search: 'const x = 1', replace: 'const x = 2' }],
          // action is MISSING — ORL must infer 'modify' from edits presence
        },
      ],
      summary: 'Modified existing file via edits',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as { files: Array<{ path: string; action: string; edits?: unknown[] }> }
    expect(data.files[0]!.action).toBe('modify')
  })

  it('defaults action to modify when action is empty string and edits present', async () => {
    // Edge case: action is empty string (some models produce this)
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/existing.ts',
          action: '',
          edits: [{ search: 'old code', replace: 'new code' }],
        },
      ],
      summary: 'Empty action with edits',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as { files: Array<{ path: string; action: string }> }
    expect(data.files[0]!.action).toBe('modify')
  })

  it('preserves create action when content is present and no edits', async () => {
    // Standard case: full content, no edits — 'create' default is correct
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/new-file.ts',
          content: 'export const newThing = true',
          // action missing — no edits, so 'create' is correct default
        },
      ],
      summary: 'New file with full content',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as { files: Array<{ path: string; action: string }> }
    expect(data.files[0]!.action).toBe('create')
  })

  it('respects explicit action even when edits are present', async () => {
    // If the model explicitly says 'create' with edits, that is likely a mistake.
    // But if it explicitly says 'modify', we should respect it.
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/module.ts',
          action: 'modify',
          edits: [{ search: 'foo', replace: 'bar' }],
        },
      ],
      summary: 'Explicit modify with edits',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as { files: Array<{ path: string; action: string }> }
    expect(data.files[0]!.action).toBe('modify')
  })
})
