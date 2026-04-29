/**
 * Context prefetch tests — validates pre-fetching ArangoDB context
 * for injection into agent prompts (replacing multi-turn tool calling).
 *
 * Validates:
 * 1. prefetchAgentContext returns all 5 collections
 * 2. prefetchAgentContext handles ArangoDB errors gracefully (returns empty arrays)
 * 3. formatContextForPrompt produces readable text
 * 4. formatContextForPrompt handles empty context
 */
import { describe, it, expect } from 'vitest'
import {
  prefetchAgentContext,
  formatContextForPrompt,
  type PrefetchedContext,
} from './context-prefetch'

// ── Mock DB helpers ────────────────────────────────────────

function createMockDb(overrides?: { failCollections?: string[] }) {
  const calls: { query: string }[] = []
  const failSet = new Set(overrides?.failCollections ?? [])

  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (failSet.size > 0) {
          for (const col of failSet) {
            if (query.includes(col)) throw new Error(`collection ${col} not found`)
          }
        }
        if (query.includes('memory_semantic') && query.includes('"decision"')) {
          return [{ key: 'D-012', decision: 'Use JWT with refresh tokens', rationale: 'Industry standard' }]
        }
        if (query.includes('memory_semantic') && query.includes('"lesson"')) {
          return [{ key: 'L-003', lesson: 'Always validate token expiry', painScore: 8 }]
        }
        if (query.includes('mentorscript_rules')) {
          return [{ ruleId: 'MR-001', rule: 'No global state in handlers' }]
        }
        if (query.includes('specs_functions')) {
          return [{ key: 'FN-001', name: 'auth-module', domain: 'identity' }]
        }
        if (query.includes('specs_invariants')) {
          return [{ key: 'INV-001', description: 'All tokens must expire within 24h' }]
        }
        return []
      },
    } as any,
    calls,
  }
}

// ── Tests ──────────────────────────────────────────────────

describe('prefetchAgentContext', () => {
  it('returns all 5 collections when DB responds', async () => {
    const { db, calls } = createMockDb()

    const ctx = await prefetchAgentContext(db)

    expect(ctx.decisions).toHaveLength(1)
    expect(ctx.decisions[0].key).toBe('D-012')
    expect(ctx.decisions[0].decision).toBe('Use JWT with refresh tokens')

    expect(ctx.lessons).toHaveLength(1)
    expect(ctx.lessons[0].key).toBe('L-003')
    expect(ctx.lessons[0].lesson).toBe('Always validate token expiry')

    expect(ctx.mentorRules).toHaveLength(1)
    expect(ctx.mentorRules[0].ruleId).toBe('MR-001')

    expect(ctx.existingFunctions).toHaveLength(1)
    expect(ctx.existingFunctions[0].name).toBe('auth-module')

    expect(ctx.invariants).toHaveLength(1)
    expect(ctx.invariants[0].description).toBe('All tokens must expire within 24h')

    // All 5 queries should have been issued in parallel
    expect(calls).toHaveLength(5)
  })

  it('returns empty arrays when all queries fail', async () => {
    const failDb = {
      query: async () => { throw new Error('DB unavailable') },
    } as any

    const ctx = await prefetchAgentContext(failDb)

    expect(ctx.decisions).toEqual([])
    expect(ctx.lessons).toEqual([])
    expect(ctx.mentorRules).toEqual([])
    expect(ctx.existingFunctions).toEqual([])
    expect(ctx.invariants).toEqual([])
  })

  it('returns partial results when some queries fail', async () => {
    const { db } = createMockDb({ failCollections: ['mentorscript_rules', 'specs_invariants'] })

    const ctx = await prefetchAgentContext(db)

    expect(ctx.decisions).toHaveLength(1)
    expect(ctx.lessons).toHaveLength(1)
    expect(ctx.mentorRules).toEqual([])
    expect(ctx.existingFunctions).toHaveLength(1)
    expect(ctx.invariants).toEqual([])
  })
})

describe('formatContextForPrompt', () => {
  it('produces readable text with all sections populated', () => {
    const ctx: PrefetchedContext = {
      decisions: [{ key: 'D-012', decision: 'Use JWT with refresh tokens', rationale: 'Industry standard' }],
      lessons: [{ key: 'L-003', lesson: 'Always validate token expiry', painScore: 8 }],
      mentorRules: [{ ruleId: 'MR-001', rule: 'No global state in handlers' }],
      existingFunctions: [{ key: 'FN-001', name: 'auth-module', domain: 'identity' }],
      invariants: [{ key: 'INV-001', description: 'All tokens must expire within 24h' }],
    }

    const text = formatContextForPrompt(ctx)

    expect(text).toContain('## Factory Knowledge Graph Context (pre-fetched)')
    expect(text).toContain('### Architectural Decisions')
    expect(text).toContain('[D-012] Use JWT with refresh tokens')
    expect(text).toContain('### Lessons Learned')
    expect(text).toContain('[L-003] Always validate token expiry')
    expect(text).toContain('### Active MentorScript Rules')
    expect(text).toContain('[MR-001] No global state in handlers')
    expect(text).toContain('### Existing Functions')
    expect(text).toContain('[FN-001] auth-module (identity)')
    expect(text).toContain('### Active Invariants')
    expect(text).toContain('[INV-001] All tokens must expire within 24h')
  })

  it('handles empty context gracefully', () => {
    const ctx: PrefetchedContext = {
      decisions: [],
      lessons: [],
      mentorRules: [],
      existingFunctions: [],
      invariants: [],
    }

    const text = formatContextForPrompt(ctx)

    expect(text).toContain('## Factory Knowledge Graph Context (pre-fetched)')
    expect(text).toContain('(No context available in knowledge graph)')
    expect(text).not.toContain('### Architectural Decisions')
  })

  it('handles functions with no domain', () => {
    const ctx: PrefetchedContext = {
      decisions: [],
      lessons: [],
      mentorRules: [],
      existingFunctions: [{ key: 'FN-002', name: 'orphan-fn' }],
      invariants: [],
    }

    const text = formatContextForPrompt(ctx)

    expect(text).toContain('[FN-002] orphan-fn (unknown)')
  })

  it('handles partial context (only some sections populated)', () => {
    const ctx: PrefetchedContext = {
      decisions: [{ key: 'D-001', decision: 'Use TypeScript everywhere' }],
      lessons: [],
      mentorRules: [],
      existingFunctions: [],
      invariants: [{ key: 'INV-001', description: 'No Python' }],
    }

    const text = formatContextForPrompt(ctx)

    expect(text).toContain('### Architectural Decisions')
    expect(text).toContain('### Active Invariants')
    expect(text).not.toContain('### Lessons Learned')
    expect(text).not.toContain('### Active MentorScript Rules')
    expect(text).not.toContain('### Existing Functions')
    expect(text).not.toContain('(No context available in knowledge graph)')
  })
})
