/**
 * MemoryCuratorAgent tests — validates the first Orientation Agent.
 *
 * Validates:
 * 1. dry-run returns empty curation result
 * 2. prefetchCuratorContext calls all 4 AQL queries
 * 3. formatCuratorContextForPrompt produces markdown with all sections
 * 4. MEMORY_CURATION_SCHEMA validates a valid curation result
 * 5. persist writes to memory_curated, pattern_library, orientation_assessments
 * 6. persist handles duplicate keys gracefully
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import {
  MemoryCuratorAgent,
  prefetchCuratorContext,
  formatCuratorContextForPrompt,
  MEMORY_CURATION_SCHEMA,
  type MemoryCurationResult,
  type CuratorContext,
} from './memory-curator-agent'
import { processAgentOutput } from './output-reliability'

// ── Valid curation result ────────────────────────────────────────

const VALID_CURATION: MemoryCurationResult = {
  curated_lessons: [
    {
      pattern: 'F1 prose output from agent',
      confidence: 0.85,
      severity: 'high',
      recommendation: 'Reduce context window size for agents producing prose instead of JSON',
      evidence_count: 5,
      last_seen: '2026-04-28T12:00:00.000Z',
      affects_agents: ['coder', 'tester'],
      decay_status: 'active',
    },
  ],
  pattern_library_entries: [
    {
      pattern_name: 'context-overflow-prose',
      description: 'When agent context exceeds model window, output degrades to prose',
      frequency: 5,
      first_seen: '2026-04-20T00:00:00.000Z',
      last_seen: '2026-04-28T12:00:00.000Z',
      related_lessons: ['F1 prose output from agent'],
    },
  ],
  governance_recommendations: [
    {
      recommendation: 'Add context-size guard to agent dispatch',
      priority: 'high',
      rationale: 'Repeated F1 failures indicate systemic context overflow',
      source_patterns: ['context-overflow-prose'],
    },
  ],
  curation_summary: 'Curated 5 lessons into 1 consolidated lesson, identified 1 pattern, produced 1 governance recommendation.',
}

// ── Mock DB ─────────────────────────────────────────────────────

function createMockDb(overrides?: { failCollections?: string[] }) {
  const calls: { query: string; params: Record<string, unknown> | undefined }[] = []
  const saves: { collection: string; data: Record<string, unknown> }[] = []
  const failSet = new Set(overrides?.failCollections ?? [])

  return {
    db: {
      query: async <T>(query: string, params?: Record<string, unknown>): Promise<T[]> => {
        calls.push({ query, params })
        for (const col of failSet) {
          if (query.includes(col)) throw new Error(`collection ${col} not found`)
        }
        if (query.includes('orl_telemetry')) {
          return [
            { schemaName: 'BriefingScript', success_count: 10, fail_count: 2, avg_repairs: 0.5 },
          ] as T[]
        }
        if (query.includes('memory_semantic')) {
          return [
            { _key: 'L-001', type: 'lesson', pattern: 'F1 prose output', evidence: ['atom-1'], count: 3, recommendation: 'Reduce context' },
          ] as T[]
        }
        if (query.includes('memory_episodic')) {
          return [
            { _key: 'E-001', action: 'synthesis', outcome: 'pass', timestamp: '2026-04-28T12:00:00Z' },
          ] as T[]
        }
        if (query.includes('specs_signals')) {
          return [
            { _key: 'SIG-001', subtype: 'synthesis:atom-failed', title: 'Atom failed', createdAt: '2026-04-28T12:00:00Z' },
          ] as T[]
        }
        return [] as T[]
      },
      save: async (collection: string, data: Record<string, unknown>) => {
        saves.push({ collection, data })
        return { _key: data._key ?? 'auto-key' }
      },
      ensureCollection: async () => {},
    } as any,
    calls,
    saves,
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('MemoryCuratorAgent', () => {
  describe('dry-run mode', () => {
    it('returns empty curation result without calling agentLoop', async () => {
      const { db } = createMockDb()
      const curator = new MemoryCuratorAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await curator.curate()

      expect(result.curated_lessons).toEqual([])
      expect(result.pattern_library_entries).toEqual([])
      expect(result.governance_recommendations).toEqual([])
      expect(result.curation_summary).toBe('Dry-run: no curation performed')
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_CURATION)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces curation result', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const curator = new MemoryCuratorAgent({
        db,
        apiKey: 'faux-key',
        model: fauxModel,
      })

      const result = await curator.curate()

      expect(result.curated_lessons).toHaveLength(1)
      expect(result.curated_lessons[0]!.pattern).toBe('F1 prose output from agent')
      expect(result.pattern_library_entries).toHaveLength(1)
      expect(result.governance_recommendations).toHaveLength(1)
      expect(result.curation_summary).toContain('Curated')
    })
  })
})

describe('prefetchCuratorContext', () => {
  it('calls all 4 AQL queries in parallel', async () => {
    const { db, calls } = createMockDb()

    const ctx = await prefetchCuratorContext(db)

    expect(calls).toHaveLength(4)
    expect(calls.some(c => c.query.includes('orl_telemetry'))).toBe(true)
    expect(calls.some(c => c.query.includes('memory_semantic'))).toBe(true)
    expect(calls.some(c => c.query.includes('memory_episodic'))).toBe(true)
    expect(calls.some(c => c.query.includes('specs_signals'))).toBe(true)
  })

  it('returns empty arrays when all queries fail', async () => {
    const failDb = {
      query: async () => { throw new Error('DB unavailable') },
    } as any

    const ctx = await prefetchCuratorContext(failDb)

    expect(ctx.orl_telemetry).toEqual([])
    expect(ctx.memory_semantic).toEqual([])
    expect(ctx.memory_episodic).toEqual([])
    expect(ctx.specs_signals).toEqual([])
  })

  it('returns partial results when some queries fail', async () => {
    const { db } = createMockDb({ failCollections: ['orl_telemetry', 'specs_signals'] })

    const ctx = await prefetchCuratorContext(db)

    expect(ctx.orl_telemetry).toEqual([])
    expect(ctx.memory_semantic).toHaveLength(1)
    expect(ctx.memory_episodic).toHaveLength(1)
    expect(ctx.specs_signals).toEqual([])
  })
})

describe('formatCuratorContextForPrompt', () => {
  it('produces markdown with all sections', () => {
    const ctx: CuratorContext = {
      orl_telemetry: [
        { schemaName: 'BriefingScript', success_count: 10, fail_count: 2, avg_repairs: 0.5 },
      ],
      memory_semantic: [
        { _key: 'L-001', pattern: 'F1 prose output', evidence: ['atom-1'], count: 3, recommendation: 'Reduce context' },
      ],
      memory_episodic: [
        { _key: 'E-001', action: 'synthesis', outcome: 'pass', timestamp: '2026-04-28T12:00:00Z' },
      ],
      specs_signals: [
        { _key: 'SIG-001', subtype: 'synthesis:atom-failed', title: 'Atom failed', createdAt: '2026-04-28T12:00:00Z' },
      ],
    }

    const text = formatCuratorContextForPrompt(ctx)

    expect(text).toContain('## Memory Curation Context')
    expect(text).toContain('### ORL Telemetry (7-day)')
    expect(text).toContain('BriefingScript')
    expect(text).toContain('### Semantic Memory (lessons)')
    expect(text).toContain('F1 prose output')
    expect(text).toContain('### Episodic Memory (recent)')
    expect(text).toContain('synthesis')
    expect(text).toContain('### Feedback Signals')
    expect(text).toContain('Atom failed')
  })

  it('handles empty context', () => {
    const ctx: CuratorContext = {
      orl_telemetry: [],
      memory_semantic: [],
      memory_episodic: [],
      specs_signals: [],
    }

    const text = formatCuratorContextForPrompt(ctx)

    expect(text).toContain('## Memory Curation Context')
    expect(text).toContain('(No data available for curation)')
  })
})

describe('MEMORY_CURATION_SCHEMA', () => {
  it('validates a valid curation result', async () => {
    const result = await processAgentOutput(JSON.stringify(VALID_CURATION), MEMORY_CURATION_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).not.toBeNull()
  })

  it('rejects missing required fields', async () => {
    const result = await processAgentOutput(JSON.stringify({
      curated_lessons: [],
      // missing pattern_library_entries, governance_recommendations, curation_summary
    }), MEMORY_CURATION_SCHEMA)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F3')
  })

  it('coerces wrong types', async () => {
    const result = await processAgentOutput(JSON.stringify({
      curated_lessons: 'not-array',
      pattern_library_entries: 'not-array',
      governance_recommendations: 'not-array',
      curation_summary: 123,
    }), MEMORY_CURATION_SCHEMA)
    expect(result.success).toBe(true)
    expect(Array.isArray(result.data!.curated_lessons)).toBe(true)
    expect(typeof result.data!.curation_summary).toBe('string')
  })
})

describe('persist', () => {
  it('writes to memory_curated, pattern_library, orientation_assessments', async () => {
    const { db, calls, saves } = createMockDb()
    const curator = new MemoryCuratorAgent({ db, apiKey: 'test-key', dryRun: true })

    const { written, errors } = await curator.persist(VALID_CURATION)

    // Should have written: 1 lesson + 1 pattern + 1 governance rec
    expect(written).toBe(3)
    expect(errors).toEqual([])

    // Lessons and patterns use UPSERT (db.query), governance uses db.save
    const upsertQueries = calls.filter(c => c.query.includes('UPSERT'))
    expect(upsertQueries.some(c => c.query.includes('memory_curated'))).toBe(true)
    expect(upsertQueries.some(c => c.query.includes('pattern_library'))).toBe(true)

    // Governance recommendations use db.save
    const govSaves = saves.filter(s => s.collection === 'orientation_assessments')
    expect(govSaves).toHaveLength(1)
  })

  it('handles duplicate keys gracefully', async () => {
    const failDb = {
      query: async () => { throw new Error('unique constraint violated') },
      save: async () => { throw new Error('unique constraint violated') },
      ensureCollection: async () => {},
    } as any

    const curator = new MemoryCuratorAgent({ db: failDb, apiKey: 'test-key', dryRun: true })

    const { written, errors } = await curator.persist(VALID_CURATION)

    expect(written).toBe(0)
    expect(errors.length).toBeGreaterThan(0)
  })
})
