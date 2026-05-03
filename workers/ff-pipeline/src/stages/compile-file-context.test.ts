/**
 * Phase E: compile-time file context wiring tests.
 *
 * RED tests for wiring @factory/file-context into the compile loop.
 *
 * The infrastructure exists:
 *   - extractContext + resolveImportPaths in @factory/file-context
 *   - fetchFileContexts pattern in atom-executor-do.ts (line 340+)
 *   - GitHub Contents API fetching with base64 decoding
 *
 * What is MISSING:
 *   1. pipeline.ts does not call a `fetch-compile-context` step before
 *      the compile loop. specContent may reference file paths (e.g.
 *      `workers/ff-pipeline/src/stages/compile.ts`) but those files are
 *      never fetched and parsed before compilation begins.
 *   2. compile.ts decompose pass does not include fileContexts in its
 *      context object. Even if pipeline.ts populated compState.fileContexts,
 *      the decompose switch-case does not forward it.
 *
 * These tests describe the CORRECT behavior. They will FAIL against
 * the current codebase (RED phase). The Engineer writes code to make
 * them pass (GREEN phase).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ── Mock cloudflare:workers (transitive dep) ───
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  DurableObject: class {},
}))

vi.mock('agents', () => ({
  Agent: class {},
  callable: () => (t: unknown) => t,
}))

vi.mock('@cloudflare/sandbox', () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: () => ({}),
}))

// ── Mock model calls (we only care about decompose context, not LLM output) ───
const modelCalls: Array<{ taskKind: string; system: string; user: string }> = []

vi.mock('../model-bridge', () => ({
  callModel: vi.fn(async (taskKind: string, system: string, user: string) => {
    modelCalls.push({ taskKind, system, user })
    const parsed = JSON.parse(user)
    const pass = parsed.pass as string
    switch (pass) {
      case 'decompose':
        return JSON.stringify({
          atoms: [{
            id: 'atom-001',
            type: 'implementation',
            title: 'Implement feature',
            description: 'Test atom for file context wiring',
          }],
        })
      default:
        return JSON.stringify({})
    }
  }),
}))

// ── Mock ArangoDB client ───
const mockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  setValidator: vi.fn(),
  ensureCollection: vi.fn(async () => ({})),
}

import { compilePRD } from './compile'
import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import type { FileContext } from '@factory/file-context'

// ─────────────────────────────────────────────────────────────────────
// 1. extractFilePathsFromSpec: extract .ts file paths from specContent
// ─────────────────────────────────────────────────────────────────────

describe('extractFilePathsFromSpec', () => {
  // This function should be exported from compile.ts (or a shared module)
  // so pipeline.ts can call it before the compile loop.

  let extractFilePathsFromSpec: (specContent: string) => string[]

  beforeEach(async () => {
    // Import the function that the Engineer will create
    const mod = await import('./compile')
    extractFilePathsFromSpec = (mod as Record<string, unknown>).extractFilePathsFromSpec as typeof extractFilePathsFromSpec
  })

  it('is exported from compile module', () => {
    expect(extractFilePathsFromSpec).toBeDefined()
    expect(typeof extractFilePathsFromSpec).toBe('function')
  })

  it('extracts .ts file paths from specContent', () => {
    const specContent = `
      This spec modifies workers/ff-pipeline/src/stages/compile.ts
      and also touches packages/file-context/src/index.ts to add
      a new export.
    `
    const paths = extractFilePathsFromSpec(specContent)
    expect(paths).toContain('workers/ff-pipeline/src/stages/compile.ts')
    expect(paths).toContain('packages/file-context/src/index.ts')
  })

  it('extracts .tsx file paths', () => {
    const specContent = 'Update the UI at packages/dashboard/src/App.tsx'
    const paths = extractFilePathsFromSpec(specContent)
    expect(paths).toContain('packages/dashboard/src/App.tsx')
  })

  it('returns empty array when specContent has no file paths', () => {
    const specContent = 'This is a high-level requirement with no file references.'
    const paths = extractFilePathsFromSpec(specContent)
    expect(paths).toEqual([])
  })

  it('returns empty array for empty or undefined specContent', () => {
    expect(extractFilePathsFromSpec('')).toEqual([])
  })

  it('deduplicates repeated file paths', () => {
    const specContent = `
      Modify workers/ff-pipeline/src/pipeline.ts (line 247).
      See workers/ff-pipeline/src/pipeline.ts for the compile loop.
    `
    const paths = extractFilePathsFromSpec(specContent)
    const pipelineCount = paths.filter(p => p === 'workers/ff-pipeline/src/pipeline.ts').length
    expect(pipelineCount).toBe(1)
  })

  it('does not extract node_modules paths', () => {
    const specContent = 'Import from node_modules/@babel/parser/src/index.ts'
    const paths = extractFilePathsFromSpec(specContent)
    expect(paths).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// 2. fetchCompileFileContexts: fetch + extract context for compile
// ─────────────────────────────────────────────────────────────────────

describe('fetchCompileFileContexts', () => {
  // This function wraps the GitHub fetch + extractContext pattern
  // from atom-executor-do.ts but adapted for the compile loop.
  // It should be exported from compile.ts (or a shared module).

  let fetchCompileFileContexts: (
    filePaths: string[],
    env: PipelineEnv,
  ) => Promise<FileContext[]>

  let originalFetch: typeof globalThis.fetch

  beforeEach(async () => {
    const mod = await import('./compile')
    fetchCompileFileContexts = (mod as Record<string, unknown>).fetchCompileFileContexts as typeof fetchCompileFileContexts
    originalFetch = globalThis.fetch
    modelCalls.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('is exported from compile module', () => {
    expect(fetchCompileFileContexts).toBeDefined()
    expect(typeof fetchCompileFileContexts).toBe('function')
  })

  it('fetches files from GitHub API and returns FileContext[]', async () => {
    const tsContent = 'export function hello(): string { return "hi" }'
    const encoded = btoa(tsContent)

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('contents/packages/example/src/index.ts')) {
        return new Response(JSON.stringify({
          content: encoded,
          encoding: 'base64',
          sha: 'abc123',
        }), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }) as typeof fetch

    const env = {
      GITHUB_TOKEN: 'ghp_test_token_123',
      ENVIRONMENT: 'test',
    } as unknown as PipelineEnv

    const contexts = await fetchCompileFileContexts(
      ['packages/example/src/index.ts'],
      env,
    )

    expect(contexts).toHaveLength(1)
    expect(contexts[0]!.path).toBe('packages/example/src/index.ts')
    expect(contexts[0]!.language).toBe('typescript')
    expect(contexts[0]!.rawContent).toBe(tsContent)
    expect(contexts[0]!.structure.exports).toContain('hello')
    expect(contexts[0]!.structure.functions.length).toBeGreaterThanOrEqual(1)
    expect(contexts[0]!.confidence).toBe('extracted')
  })

  it('returns empty array when GITHUB_TOKEN is missing (fail-open)', async () => {
    const env = {
      // No GITHUB_TOKEN
      ENVIRONMENT: 'test',
    } as unknown as PipelineEnv

    const contexts = await fetchCompileFileContexts(
      ['packages/example/src/index.ts'],
      env,
    )

    expect(contexts).toEqual([])
  })

  it('returns empty array when filePaths is empty', async () => {
    const env = {
      GITHUB_TOKEN: 'ghp_test_token_123',
      ENVIRONMENT: 'test',
    } as unknown as PipelineEnv

    const contexts = await fetchCompileFileContexts([], env)
    expect(contexts).toEqual([])
  })

  it('skips files that return 404 from GitHub', async () => {
    const tsContent = 'export const x = 1'
    const encoded = btoa(tsContent)

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('contents/src/exists.ts')) {
        return new Response(JSON.stringify({
          content: encoded,
          encoding: 'base64',
          sha: 'def456',
        }), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }) as typeof fetch

    const env = {
      GITHUB_TOKEN: 'ghp_test_token_123',
      ENVIRONMENT: 'test',
    } as unknown as PipelineEnv

    const contexts = await fetchCompileFileContexts(
      ['src/exists.ts', 'src/does-not-exist.ts'],
      env,
    )

    expect(contexts).toHaveLength(1)
    expect(contexts[0]!.path).toBe('src/exists.ts')
  })

  it('sets correct Authorization header with GITHUB_TOKEN', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('Not Found', { status: 404 }),
    ) as unknown as typeof fetch
    globalThis.fetch = fetchSpy

    const env = {
      GITHUB_TOKEN: 'ghp_my_secret_token',
      ENVIRONMENT: 'test',
    } as unknown as PipelineEnv

    await fetchCompileFileContexts(['src/any.ts'], env)

    expect(fetchSpy).toHaveBeenCalled()
    const [, opts] = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer ghp_my_secret_token')
    expect(headers['Accept']).toBe('application/vnd.github+json')
  })

  it('handles fetch errors gracefully (fail-open)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error')
    }) as unknown as typeof fetch

    const env = {
      GITHUB_TOKEN: 'ghp_test_token_123',
      ENVIRONMENT: 'test',
    } as unknown as PipelineEnv

    // Should not throw — file context is best-effort
    const contexts = await fetchCompileFileContexts(
      ['src/broken.ts'],
      env,
    )
    expect(contexts).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// 3. compilePRD decompose pass includes fileContexts in LLM context
// ─────────────────────────────────────────────────────────────────────

describe('compilePRD decompose pass: fileContexts in context', () => {
  const mockEnv = {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    AI: { run: vi.fn() },
  } as Record<string, unknown>

  beforeEach(() => {
    modelCalls.length = 0
    vi.clearAllMocks()
  })

  it('decompose pass forwards fileContexts to LLM context when present in state', async () => {
    const fileContexts: FileContext[] = [
      {
        path: 'workers/ff-pipeline/src/stages/compile.ts',
        language: 'typescript',
        rawContent: 'export async function compilePRD() { /* ... */ }',
        structure: {
          exports: ['compilePRD'],
          imports: ['@factory/arango-client'],
          functions: [{
            name: 'compilePRD',
            params: 'passName: PassName, state: Record<string, unknown>',
            returnType: 'Promise<Record<string, unknown>>',
            startLine: 1,
            endLine: 1,
          }],
          types: [],
          classes: [],
        },
        confidence: 'extracted',
      },
    ]

    const state: Record<string, unknown> = {
      prd: {
        _key: 'PRD-FC',
        title: 'File context test',
        objective: 'Test that fileContexts reach the decompose LLM call',
        invariants: [],
      },
      signalContext: {
        title: 'Test signal',
        description: 'Test description',
        specContent: 'Modify workers/ff-pipeline/src/stages/compile.ts',
      },
      fileContexts,
    }

    await compilePRD(
      'decompose',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      false,
    )

    // The decompose pass should have included fileContexts in the
    // context object sent to the LLM
    expect(modelCalls).toHaveLength(1)
    const sentContext = JSON.parse(modelCalls[0]!.user) as Record<string, unknown>
    expect(sentContext.fileContexts).toBeDefined()
    expect(Array.isArray(sentContext.fileContexts)).toBe(true)

    const sentFileContexts = sentContext.fileContexts as FileContext[]
    expect(sentFileContexts).toHaveLength(1)
    expect(sentFileContexts[0]!.path).toBe('workers/ff-pipeline/src/stages/compile.ts')
    expect(sentFileContexts[0]!.structure.exports).toContain('compilePRD')
  })

  it('decompose pass works normally when fileContexts is absent from state', async () => {
    const state: Record<string, unknown> = {
      prd: {
        _key: 'PRD-NOFC',
        title: 'No file context test',
        objective: 'Test that decompose works without fileContexts',
        invariants: [],
      },
    }

    const result = await compilePRD(
      'decompose',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      false,
    )

    // Should still produce atoms
    expect(result.atoms).toBeDefined()
    expect(modelCalls).toHaveLength(1)

    // When no fileContexts in state, the context should either omit
    // fileContexts or include an empty array — not crash
    const sentContext = JSON.parse(modelCalls[0]!.user) as Record<string, unknown>
    const fc = sentContext.fileContexts
    expect(fc === undefined || (Array.isArray(fc) && fc.length === 0)).toBe(true)
  })

  it('decompose pass does NOT forward fileContexts to non-decompose passes', async () => {
    const fileContexts: FileContext[] = [{
      path: 'src/test.ts',
      language: 'typescript',
      rawContent: 'export const x = 1',
      structure: { exports: ['x'], imports: [], functions: [], types: [], classes: [] },
      confidence: 'extracted',
    }]

    const state: Record<string, unknown> = {
      prd: { _key: 'PRD-DEP', title: 'Test', objective: 'Test', invariants: [] },
      atoms: [{ id: 'atom-001', type: 'implementation', title: 'Test', description: 'Test' }],
      fileContexts,
    }

    await compilePRD(
      'dependency',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      false,
    )

    // dependency pass should NOT include fileContexts — it only needs atoms
    expect(modelCalls).toHaveLength(1)
    const sentContext = JSON.parse(modelCalls[0]!.user) as Record<string, unknown>
    expect(sentContext.fileContexts).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// 4. decompose system prompt references file contexts
// ─────────────────────────────────────────────────────────────────────

describe('decompose prompt: file context awareness', () => {
  const mockEnv = {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    AI: { run: vi.fn() },
  } as Record<string, unknown>

  beforeEach(() => {
    modelCalls.length = 0
    vi.clearAllMocks()
  })

  it('system prompt mentions file contexts when fileContexts are present', async () => {
    const state: Record<string, unknown> = {
      prd: { _key: 'PRD-PROMPT', title: 'Prompt test', objective: 'Test', invariants: [] },
      fileContexts: [{
        path: 'src/example.ts',
        language: 'typescript',
        rawContent: 'export function doThing() {}',
        structure: { exports: ['doThing'], imports: [], functions: [], types: [], classes: [] },
        confidence: 'extracted',
      }],
    }

    await compilePRD(
      'decompose',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      false,
    )

    expect(modelCalls).toHaveLength(1)

    // The user message context should include the file contexts so the
    // LLM knows what the actual files contain when decomposing.
    const sentContext = JSON.parse(modelCalls[0]!.user) as Record<string, unknown>
    expect(sentContext.fileContexts).toBeDefined()

    // The file contexts should carry enough information for the LLM to
    // understand the existing code structure
    const fc = sentContext.fileContexts as FileContext[]
    expect(fc[0]!.path).toBe('src/example.ts')
    expect(fc[0]!.structure).toBeDefined()
  })
})
