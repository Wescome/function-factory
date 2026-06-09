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
    const rows = await db.query<{ json: string }>(
      `SELECT json FROM documents WHERE collection='hot_config' AND key='pipeline' LIMIT 1`,
    )
    const doc = rows[0] ? JSON.parse(rows[0].json) as PipelineHotConfig : undefined
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
    const now = new Date().toISOString()
    await db.query(
      `INSERT INTO documents (collection, key, json) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET json=json_patch(json, json_object('seededAt', ?, 'source', 'hardcoded-defaults'))`,
      ['hot_config', 'pipeline', JSON.stringify({ _key: 'pipeline', crystallizer: { enabled: true }, seededAt: now, source: 'hardcoded-defaults' }), now],
    )
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
