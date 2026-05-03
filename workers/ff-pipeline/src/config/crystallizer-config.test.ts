/**
 * Priority 1: Crystallizer hot-config flag tests (TDD RED phase).
 *
 * Verifies:
 *   1. HotConfig interface includes crystallizer.enabled field
 *   2. Default config has crystallizer.enabled = true
 *   3. seedHotConfig seeds the pipeline config doc with crystallizer.enabled
 *   4. loadCrystallizerEnabled reads from hot_config collection
 *   5. loadCrystallizerEnabled defaults to true when DB unreachable
 *   6. loadCrystallizerEnabled defaults to true when document missing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadCrystallizerEnabled,
  seedPipelineConfig,
} from './crystallizer-config'

// ── Mock ArangoClient ──────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────

describe('loadCrystallizerEnabled', () => {
  let db: MockDb

  beforeEach(() => {
    db = makeMockDb()
  })

  it('returns true when hot_config doc has crystallizer.enabled = true', async () => {
    db.query.mockResolvedValue([{
      _key: 'pipeline',
      crystallizer: { enabled: true },
    }])

    const enabled = await loadCrystallizerEnabled(db as never)
    expect(enabled).toBe(true)
  })

  it('returns false when hot_config doc has crystallizer.enabled = false', async () => {
    db.query.mockResolvedValue([{
      _key: 'pipeline',
      crystallizer: { enabled: false },
    }])

    const enabled = await loadCrystallizerEnabled(db as never)
    expect(enabled).toBe(false)
  })

  it('defaults to true when DB query fails', async () => {
    db.query.mockRejectedValue(new Error('Connection refused'))

    const enabled = await loadCrystallizerEnabled(db as never)
    expect(enabled).toBe(true)
  })

  it('defaults to true when document is missing', async () => {
    db.query.mockResolvedValue([])

    const enabled = await loadCrystallizerEnabled(db as never)
    expect(enabled).toBe(true)
  })

  it('defaults to true when crystallizer field is missing from doc', async () => {
    db.query.mockResolvedValue([{ _key: 'pipeline' }])

    const enabled = await loadCrystallizerEnabled(db as never)
    expect(enabled).toBe(true)
  })
})

describe('seedPipelineConfig', () => {
  let db: MockDb

  beforeEach(() => {
    db = makeMockDb()
  })

  it('upserts pipeline config doc with crystallizer.enabled = true', async () => {
    await seedPipelineConfig(db as never)

    // Should have called query with upsert for hot_config
    const upsertCalls = db.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('hot_config'),
    )
    expect(upsertCalls.length).toBe(1)

    // Verify the params include crystallizer.enabled
    const params = upsertCalls[0]![1] as Record<string, unknown>
    expect(params.crystallizer).toEqual({ enabled: true })
  })

  it('ensures hot_config collection exists', async () => {
    await seedPipelineConfig(db as never)

    const collectionNames = db.ensureCollection.mock.calls.map((c: unknown[]) => c[0])
    expect(collectionNames).toContain('hot_config')
  })

  it('does not throw on upsert failure', async () => {
    db.query.mockRejectedValue(new Error('DB unavailable'))

    // Should not throw
    const result = await seedPipelineConfig(db as never)
    expect(result.error).toBeDefined()
  })
})
