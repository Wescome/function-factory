/**
 * Crystallizer hot-config: cached read of crystallizer.enabled flag.
 *
 * Uses the same never-throw pattern as HotConfigLoader.
 * Reads from `hot_config` collection, `pipeline` document.
 * Default: true (crystallizer stays on after synthesis #11 validation).
 *
 * Traces to: DESIGN-CRYSTALLIZER-NEXT.md Priority 1
 */

import type { ArangoClient } from '@factory/arango-client'

// ── Types ──────────────────────────────────────────────────────

interface PipelineHotConfig {
  _key: string
  crystallizer?: { enabled?: boolean }
}

// ── Read ───────────────────────────────────────────────────────

/**
 * Load the crystallizer.enabled flag from hot_config/pipeline.
 * Never throws. Defaults to true when DB is unreachable or field is missing.
 */
export async function loadCrystallizerEnabled(db: ArangoClient): Promise<boolean> {
  try {
    const results = await db.query<PipelineHotConfig>(
      `FOR c IN hot_config FILTER c._key == 'pipeline' RETURN c`,
    )
    const doc = results[0]
    if (!doc || doc.crystallizer?.enabled === undefined) return true
    return doc.crystallizer.enabled
  } catch {
    return true
  }
}

// ── Seed ───────────────────────────────────────────────────────

/**
 * Seed the pipeline hot-config document with crystallizer defaults.
 * Idempotent via UPSERT. Never throws.
 */
export async function seedPipelineConfig(
  db: ArangoClient,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.ensureCollection('hot_config')
    await db.query(
      `UPSERT { _key: 'pipeline' }
       INSERT { _key: 'pipeline', crystallizer: @crystallizer, seededAt: @now, source: 'hardcoded-defaults' }
       UPDATE { crystallizer: @crystallizer, seededAt: @now, source: 'hardcoded-defaults' }
       IN hot_config`,
      { crystallizer: { enabled: true }, now: new Date().toISOString() },
    )
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
