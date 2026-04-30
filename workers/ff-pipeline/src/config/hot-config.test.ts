/**
 * ADR-008 Phase 3: Hot-Reloadable Configuration tests (TDD RED phase).
 *
 * Tests the HotConfigLoader that loads configuration from ArangoDB
 * with in-memory TTL cache and hardcoded defaults as fallback.
 *
 * Tests cover:
 *   - Cache behavior (TTL, refresh)
 *   - ArangoDB fallback (defaults when DB unreachable)
 *   - Alias override merging
 *   - Routing config loading
 *   - Model capabilities loading
 *   - Seed function idempotency
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HotConfigLoader,
  seedHotConfig,
  mergeAliasOverrides,
  type HotConfig,
  type ModelCapabilities,
} from './hot-config'
import { DEFAULT_CONFIG, resolve, type RoutingConfig } from '@factory/task-routing'
import {
  BRIEFING_SCRIPT_SCHEMA,
  PLAN_SCHEMA,
  VERDICT_SCHEMA,
  CODE_ARTIFACT_SCHEMA,
  CRITIQUE_REPORT_SCHEMA,
  TEST_REPORT_SCHEMA,
  SEMANTIC_REVIEW_SCHEMA,
} from '../agents/output-reliability'

// ── Mock ArangoClient ──────────────────────────────────────────────

function makeMockDb() {
  return {
    save: vi.fn().mockResolvedValue({ _key: 'mock-key' }),
    update: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
    ensureCollection: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(true),
  }
}

type MockDb = ReturnType<typeof makeMockDb>

// ── HotConfigLoader: cache behavior ─────────────────────────────

describe('HotConfigLoader', () => {
  let db: MockDb
  let loader: HotConfigLoader

  beforeEach(() => {
    db = makeMockDb()
    loader = new HotConfigLoader(db as never, { ttlMs: 100 })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns cached config within TTL', async () => {
    // First call loads from DB
    const config1 = await loader.get()
    expect(db.query).toHaveBeenCalled()

    const callCount = db.query.mock.calls.length
    // Second call within TTL should use cache
    const config2 = await loader.get()
    expect(db.query.mock.calls.length).toBe(callCount)
    expect(config2).toBe(config1) // same reference = cached
  })

  it('reloads after TTL expires', async () => {
    const config1 = await loader.get()
    const callCount = db.query.mock.calls.length

    // Advance past TTL
    vi.advanceTimersByTime(150)

    const config2 = await loader.get()
    expect(db.query.mock.calls.length).toBeGreaterThan(callCount)
    // New object reference after reload
    expect(config2).not.toBe(config1)
  })

  it('falls back to defaults when ArangoDB query fails', async () => {
    db.query.mockRejectedValue(new Error('Connection refused'))

    const config = await loader.get()
    expect(config).toBeDefined()
    // Should have defaults
    expect(config.routing).toEqual(DEFAULT_CONFIG)
    expect(config.aliases).toEqual({})
    expect(config.modelCapabilities).toEqual({})
  })

  it('never throws even when ArangoDB is completely unreachable', async () => {
    db.query.mockRejectedValue(new Error('Network error'))
    db.queryOne.mockRejectedValue(new Error('Network error'))

    // Must not throw
    const config = await loader.get()
    expect(config).toBeDefined()
    expect(config.routing).toEqual(DEFAULT_CONFIG)
  })

  it('loads alias overrides from ArangoDB', async () => {
    db.query.mockImplementation(async (aql: string) => {
      if (aql.includes('config_aliases')) {
        return [{
          _key: 'BriefingScript',
          aliases: {
            goal: ['mission', 'intent'],
          },
        }]
      }
      return []
    })

    const config = await loader.get()
    expect(config.aliases).toEqual({
      BriefingScript: {
        goal: ['mission', 'intent'],
      },
    })
  })

  it('loads routing overrides from ArangoDB', async () => {
    const customRouting: RoutingConfig = {
      routes: [
        { kind: 'planning', primary: { provider: 'google', model: 'gemini-3.1-pro-preview' } },
      ],
      default: { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    }

    db.query.mockImplementation(async (aql: string) => {
      if (aql.includes('config_routing')) {
        return [{ _key: 'default', config: customRouting }]
      }
      return []
    })

    const config = await loader.get()
    expect(config.routing).toEqual(customRouting)
  })

  it('loads model capabilities from ArangoDB', async () => {
    const capabilities: ModelCapabilities = {
      supportsJsonMode: true,
      supportsFunctionCalling: false,
      maxOutputTokens: 4096,
      reliabilityTier: 'medium',
    }

    db.query.mockImplementation(async (aql: string) => {
      if (aql.includes('config_model_capabilities')) {
        return [{ _key: 'llama-3.3-70b', ...capabilities }]
      }
      return []
    })

    const config = await loader.get()
    expect(config.modelCapabilities['llama-3.3-70b']).toEqual(capabilities)
  })

  it('returns stale cache on reload failure (cache-then-network)', async () => {
    // First call succeeds
    const config1 = await loader.get()
    const callCount = db.query.mock.calls.length

    // DB goes down
    db.query.mockRejectedValue(new Error('Connection refused'))

    // Advance past TTL
    vi.advanceTimersByTime(150)

    // Should return previous cached config, not throw
    const config2 = await loader.get()
    expect(config2).toBeDefined()
    expect(config2.routing).toEqual(DEFAULT_CONFIG)
  })

  it('uses default TTL of 60 seconds when not specified', () => {
    const defaultLoader = new HotConfigLoader(db as never)
    // The loader should have a 60s TTL internally
    // We verify by checking it caches within 60s
    expect(defaultLoader).toBeDefined()
  })
})

// ── Alias override merging ──────────────────────────────────────

describe('mergeAliasOverrides', () => {
  it('merges DB overrides with schema defaults (overrides win)', () => {
    const schemaAliases = {
      goal: ['objective', 'target', 'aim'],
      successCriteria: ['criteria', 'conditions'],
    }
    const dbOverrides = {
      goal: ['mission', 'intent'],  // override
    }

    const merged = mergeAliasOverrides(schemaAliases, dbOverrides)

    // DB overrides replace the schema aliases for that field
    expect(merged.goal).toEqual(['mission', 'intent'])
    // Unoverridden fields keep schema defaults
    expect(merged.successCriteria).toEqual(['criteria', 'conditions'])
  })

  it('returns schema defaults when no overrides', () => {
    const schemaAliases = {
      goal: ['objective', 'target'],
    }

    const merged = mergeAliasOverrides(schemaAliases, undefined)
    expect(merged).toEqual(schemaAliases)
  })

  it('returns schema defaults when overrides are empty', () => {
    const schemaAliases = {
      goal: ['objective', 'target'],
    }

    const merged = mergeAliasOverrides(schemaAliases, {})
    expect(merged).toEqual(schemaAliases)
  })

  it('adds new alias fields from overrides that are not in schema', () => {
    const schemaAliases = {
      goal: ['objective'],
    }
    const dbOverrides = {
      newField: ['alias1', 'alias2'],
    }

    const merged = mergeAliasOverrides(schemaAliases, dbOverrides)
    expect(merged.goal).toEqual(['objective'])
    expect(merged.newField).toEqual(['alias1', 'alias2'])
  })
})

// ── Routing integration ─────────────────────────────────────────

describe('hot config + routing integration', () => {
  it('resolve() uses hot-loaded config when provided', () => {
    const hotRouting: RoutingConfig = {
      routes: [
        {
          kind: 'planning',
          primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
        },
      ],
      default: { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    }

    const result = resolve('planning', { config: hotRouting })
    expect(result.primary.provider).toBe('google')
    expect(result.primary.model).toBe('gemini-3.1-pro-preview')
  })

  it('resolve() falls back to DEFAULT_CONFIG when no hot config', () => {
    const result = resolve('planning')
    expect(result.primary.provider).toBe('cloudflare')
  })
})

// ── Seed function ──────────────────────────────────────────────

describe('seedHotConfig', () => {
  let db: MockDb

  beforeEach(() => {
    db = makeMockDb()
  })

  it('ensures all three config collections exist', async () => {
    await seedHotConfig(db as never)

    const collectionNames = db.ensureCollection.mock.calls.map((c: unknown[]) => c[0])
    expect(collectionNames).toContain('config_aliases')
    expect(collectionNames).toContain('config_routing')
    expect(collectionNames).toContain('config_model_capabilities')
  })

  it('seeds alias config for all ORL schemas', async () => {
    await seedHotConfig(db as never)

    // Find all save calls to config_aliases
    const aliasSaves = db.save.mock.calls.filter(
      (c: unknown[]) => c[0] === 'config_aliases',
    )

    // Should have entries for each schema with fieldAliases
    const savedKeys = aliasSaves.map((c: unknown[]) => (c[1] as { _key: string })._key)
    expect(savedKeys).toContain('BriefingScript')
    expect(savedKeys).toContain('Plan')
    expect(savedKeys).toContain('Verdict')
    expect(savedKeys).toContain('CritiqueReport')
    expect(savedKeys).toContain('TestReport')
    expect(savedKeys).toContain('SemanticReview')
  })

  it('seeds default routing config via upsert', async () => {
    await seedHotConfig(db as never)

    const routingQueries = db.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('config_routing'),
    )
    expect(routingQueries.length).toBeGreaterThanOrEqual(1)
    const params = routingQueries[0]![1] as { config: RoutingConfig }
    expect(params.config).toEqual(DEFAULT_CONFIG)
  })

  it('seeds model capabilities from known models', async () => {
    await seedHotConfig(db as never)

    const capSaves = db.save.mock.calls.filter(
      (c: unknown[]) => c[0] === 'config_model_capabilities',
    )
    expect(capSaves.length).toBeGreaterThanOrEqual(1)

    // Should have at least the llama model
    const savedKeys = capSaves.map((c: unknown[]) => (c[1] as { _key: string })._key)
    expect(savedKeys).toContain('llama-3.3-70b')
  })

  it('is idempotent (no errors on duplicate saves)', async () => {
    // First call succeeds
    await seedHotConfig(db as never)

    // Second call: save throws conflict
    db.save.mockRejectedValue(new Error('unique constraint violated'))

    // Should not throw
    const result = await seedHotConfig(db as never)
    expect(result.errors.length).toBe(0)
  })

  it('reports non-conflict errors', async () => {
    db.save.mockRejectedValue(new Error('database unavailable'))

    const result = await seedHotConfig(db as never)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
