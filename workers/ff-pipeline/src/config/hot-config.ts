/**
 * ADR-008 Phase 3: Hot-Reloadable Configuration
 *
 * Loads configuration from ArangoDB with in-memory TTL cache (60s default).
 * Falls back to hardcoded defaults when ArangoDB is unreachable.
 *
 * Three configuration surfaces:
 *   1. Aliases — field alias overrides per ORL schema
 *   2. Routing — model routing overrides per task kind
 *   3. Model Capabilities — per-model capability profiles
 *
 * Key invariants:
 *   - Never throws — always falls back to defaults
 *   - Read-only at runtime — writes come from self-healing loop (ADR-008)
 *   - Hardcoded defaults are the safety floor
 *   - Config changes propagate within TTL (default 60s)
 */

import type { ArangoClient } from '@factory/arango-client'
import { DEFAULT_CONFIG, type RoutingConfig } from '@factory/task-routing'

// ── Types ──────────────────────────────────────────────────────

export interface ModelCapabilities {
  supportsJsonMode: boolean
  supportsFunctionCalling: boolean
  maxOutputTokens: number
  reliabilityTier: 'high' | 'medium' | 'low'
}

export interface HotConfig {
  aliases: Record<string, Record<string, string[]>>  // schema → field → aliases
  routing: RoutingConfig
  modelCapabilities: Record<string, ModelCapabilities>
}

export interface HotConfigLoaderOptions {
  ttlMs?: number
}

// ── Default config (safety floor) ──────────────────────────────

const DEFAULT_HOT_CONFIG: HotConfig = {
  aliases: {},
  routing: DEFAULT_CONFIG,
  modelCapabilities: {},
}

// ── Known model capabilities (CEF-observed) ────────────────────

export const KNOWN_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'llama-3.3-70b': {
    supportsJsonMode: true,
    supportsFunctionCalling: false,
    maxOutputTokens: 4096,
    reliabilityTier: 'medium',
  },
  'deepseek-v4-pro': {
    supportsJsonMode: true,
    supportsFunctionCalling: true,
    maxOutputTokens: 8192,
    reliabilityTier: 'high',
  },
  'gemini-3.1-pro-preview': {
    supportsJsonMode: true,
    supportsFunctionCalling: true,
    maxOutputTokens: 8192,
    reliabilityTier: 'high',
  },
  'claude-opus-4.6': {
    supportsJsonMode: true,
    supportsFunctionCalling: true,
    maxOutputTokens: 16384,
    reliabilityTier: 'high',
  },
  'kimi-k2.6': {
    supportsJsonMode: true,
    supportsFunctionCalling: false,
    maxOutputTokens: 4096,
    reliabilityTier: 'medium',
  },
}

// ── Loader ─────────────────────────────────────────────────────

export class HotConfigLoader {
  private cache: HotConfig | null = null
  private cacheTimestamp: number = 0
  private ttlMs: number

  constructor(
    private db: ArangoClient,
    opts?: HotConfigLoaderOptions,
  ) {
    this.ttlMs = opts?.ttlMs ?? 60_000
  }

  /**
   * Get the current hot config. Returns cached version if within TTL.
   * Never throws — falls back to defaults on any error.
   */
  async get(): Promise<HotConfig> {
    if (this.cache && Date.now() - this.cacheTimestamp < this.ttlMs) {
      return this.cache
    }

    try {
      const loaded = await this.load()
      this.cache = loaded
      this.cacheTimestamp = Date.now()
      return loaded
    } catch {
      // If we have a stale cache, use it
      if (this.cache) return this.cache
      // Otherwise return defaults
      return DEFAULT_HOT_CONFIG
    }
  }

  private async load(): Promise<HotConfig> {
    const [aliases, routing, capabilities] = await Promise.all([
      this.loadAliases(),
      this.loadRouting(),
      this.loadModelCapabilities(),
    ])
    return { aliases, routing, modelCapabilities: capabilities }
  }

  private async loadAliases(): Promise<Record<string, Record<string, string[]>>> {
    try {
      const results = await this.db.query<{
        _key: string
        aliases: Record<string, string[]>
      }>('FOR c IN config_aliases RETURN c')

      const aliasMap: Record<string, Record<string, string[]>> = {}
      for (const doc of results) {
        aliasMap[doc._key] = doc.aliases
      }
      return aliasMap
    } catch {
      return {}
    }
  }

  private async loadRouting(): Promise<RoutingConfig> {
    try {
      const results = await this.db.query<{
        _key: string
        config: RoutingConfig
      }>('FOR c IN config_routing RETURN c')

      const defaultDoc = results.find(r => r._key === 'default')
      if (defaultDoc?.config) return defaultDoc.config
      return DEFAULT_CONFIG
    } catch {
      return DEFAULT_CONFIG
    }
  }

  private async loadModelCapabilities(): Promise<Record<string, ModelCapabilities>> {
    try {
      const results = await this.db.query<{
        _key: string
        supportsJsonMode: boolean
        supportsFunctionCalling: boolean
        maxOutputTokens: number
        reliabilityTier: 'high' | 'medium' | 'low'
      }>('FOR c IN config_model_capabilities RETURN c')

      const capMap: Record<string, ModelCapabilities> = {}
      for (const doc of results) {
        capMap[doc._key] = {
          supportsJsonMode: doc.supportsJsonMode,
          supportsFunctionCalling: doc.supportsFunctionCalling,
          maxOutputTokens: doc.maxOutputTokens,
          reliabilityTier: doc.reliabilityTier,
        }
      }
      return capMap
    } catch {
      return {}
    }
  }
}

// ── Alias merging ──────────────────────────────────────────────

/**
 * Merge DB alias overrides with schema-hardcoded aliases.
 * DB overrides take precedence per field.
 */
export function mergeAliasOverrides(
  schemaAliases: Record<string, string[]> | undefined,
  dbOverrides: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!schemaAliases && !dbOverrides) return {}
  if (!dbOverrides || Object.keys(dbOverrides).length === 0) {
    return { ...(schemaAliases ?? {}) }
  }
  if (!schemaAliases) return { ...dbOverrides }

  return {
    ...schemaAliases,
    ...dbOverrides,  // overrides win
  }
}

// ── Seed function ──────────────────────────────────────────────

import {
  BRIEFING_SCRIPT_SCHEMA,
  PLAN_SCHEMA,
  VERDICT_SCHEMA,
  CODE_ARTIFACT_SCHEMA,
  CRITIQUE_REPORT_SCHEMA,
  TEST_REPORT_SCHEMA,
  SEMANTIC_REVIEW_SCHEMA,
} from '../agents/output-reliability'

/** All ORL schemas that have fieldAliases */
const ORL_SCHEMAS = [
  BRIEFING_SCRIPT_SCHEMA,
  PLAN_SCHEMA,
  VERDICT_SCHEMA,
  CODE_ARTIFACT_SCHEMA,
  CRITIQUE_REPORT_SCHEMA,
  TEST_REPORT_SCHEMA,
  SEMANTIC_REVIEW_SCHEMA,
]

/**
 * Seed the three hot-config collections in ArangoDB with current
 * hardcoded defaults. Idempotent — safe to call on every deploy.
 */
export async function seedHotConfig(
  db: ArangoClient,
): Promise<{ seeded: number; errors: string[] }> {
  const errors: string[] = []
  let seeded = 0

  // Ensure collections exist
  await Promise.all([
    db.ensureCollection('config_aliases'),
    db.ensureCollection('config_routing'),
    db.ensureCollection('config_model_capabilities'),
  ])

  // Seed alias configs from ORL schemas
  for (const schema of ORL_SCHEMAS) {
    if (!schema.fieldAliases) continue
    try {
      await db.save('config_aliases', {
        _key: schema.name,
        aliases: schema.fieldAliases,
        seededAt: new Date().toISOString(),
        source: 'hardcoded-defaults',
      })
      seeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('unique constraint') || msg.includes('conflict')) {
        // Already exists — idempotent, not an error
      } else {
        errors.push(`config_aliases/${schema.name}: ${msg}`)
      }
    }
  }

  // Seed default routing config (upsert — always update to latest defaults)
  try {
    await db.query(
      `UPSERT { _key: 'default' }
       INSERT { _key: 'default', config: @config, seededAt: @now, source: 'hardcoded-defaults' }
       UPDATE { config: @config, seededAt: @now, source: 'hardcoded-defaults' }
       IN config_routing`,
      { config: DEFAULT_CONFIG, now: new Date().toISOString() },
    )
    seeded++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`config_routing/default: ${msg}`)
  }

  // Seed model capabilities
  for (const [modelKey, caps] of Object.entries(KNOWN_MODEL_CAPABILITIES)) {
    try {
      await db.save('config_model_capabilities', {
        _key: modelKey,
        ...caps,
        seededAt: new Date().toISOString(),
        source: 'hardcoded-defaults',
      })
      seeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('unique constraint') && !msg.includes('conflict')) {
        errors.push(`config_model_capabilities/${modelKey}: ${msg}`)
      }
    }
  }

  return { seeded, errors }
}
