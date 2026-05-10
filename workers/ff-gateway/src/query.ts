/**
 * @module query-worker
 *
 * Read-path Worker for the Factory API. Serves spec lookups, lineage
 * traversals, health checks, and gate status queries.
 *
 * Reads ArangoDB directly — no write operations. This is the fast path
 * for operator dashboards and ACE queries.
 *
 * Exposed via WorkerEntrypoint for Service Binding from ff-gateway.
 * No public route.
 */

import { WorkerEntrypoint } from 'cloudflare:workers'
import { createClientFromEnv, type ArangoClient } from '@factory/arango-client'

interface QueryEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
}

/** Public collection names accepted by the gateway and their Arango collections. */
const SPEC_COLLECTIONS: Record<string, string> = {
  signals: 'specs_signals',
  pressures: 'specs_pressures',
  capabilities: 'specs_capabilities',
  functions: 'specs_functions',
  'intent-specifications': 'intent_specifications',
  intent_specifications: 'intent_specifications',
  'executable-specifications': 'executable_specifications',
  executable_specifications: 'executable_specifications',
  invariants: 'specs_invariants',
  'verification-reports': 'verification_reports',
  verification_reports: 'verification_reports',
}

const NON_SPEC_COLLECTIONS = new Set([
  'execution_artifacts',
  'memory_episodic',
  'memory_semantic',
  'memory_working',
  'memory_personal',
  'verification_status',
])

function resolveCollection(collection: string): string {
  return SPEC_COLLECTIONS[collection] ?? (NON_SPEC_COLLECTIONS.has(collection) ? collection : `specs_${collection}`)
}

export default class QueryService extends WorkerEntrypoint<QueryEnv> {
  private db!: ArangoClient

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
    }
    return this.db
  }

  // ── Spec lookups ──

  /** Get a single spec artifact by collection and key */
  async getSpec(collection: string, key: string): Promise<unknown> {
    return this.getDb().get(resolveCollection(collection), key)
  }

  /** List specs in a collection (paginated) */
  async listSpecs(
    collection: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ items: unknown[]; total: number }> {
    const { limit = 25, offset = 0 } = opts
    const fullCollection = resolveCollection(collection)
    const db = this.getDb()

    const items = await db.query(
      `FOR doc IN @@collection
         SORT doc.createdAt DESC
         LIMIT @offset, @limit
         RETURN doc`,
      { '@collection': fullCollection, offset, limit },
    )

    const countResult = await db.queryOne<{ count: number }>(
      `RETURN { count: LENGTH(@@collection) }`,
      { '@collection': fullCollection },
    )

    return { items, total: countResult?.count ?? 0 }
  }

  // ── Lineage ──

  /** Trace an artifact's full lineage back to its originating Signal */
  async traceLineage(
    collection: string,
    key: string,
    maxDepth: number = 10,
  ): Promise<LineageNode[]> {
    const startId = `${resolveCollection(collection)}/${key}`
    const db = this.getDb()

    return db.query<LineageNode>(
      `FOR v, e, p IN 1..@maxDepth OUTBOUND @start lineage_edges
         RETURN {
           id: v._key,
           collection: PARSE_IDENTIFIER(v._id).collection,
           type: v.type,
           title: v.title,
           depth: LENGTH(p.edges),
           edgeType: LAST(p.edges).type
         }`,
      { start: startId, maxDepth },
    )
  }

  /** Get all downstream artifacts affected by a given artifact */
  async traceImpact(
    collection: string,
    key: string,
    maxDepth: number = 5,
  ): Promise<LineageNode[]> {
    const startId = `${resolveCollection(collection)}/${key}`
    const db = this.getDb()

    return db.query<LineageNode>(
      `FOR v, e, p IN 1..@maxDepth INBOUND @start lineage_edges
         RETURN {
           id: v._key,
           collection: PARSE_IDENTIFIER(v._id).collection,
           type: v.type,
           title: v.title,
           depth: LENGTH(p.edges),
           edgeType: LAST(p.edges).type
         }`,
      { start: startId, maxDepth },
    )
  }

  // ── Health + status ──

  /** Get gate status for a specific artifact */
  async getGateStatus(gateNumber: number, artifactId: string): Promise<unknown> {
    return this.getDb().get('verification_status', `gate:${gateNumber}:${artifactId}`)
  }

  /** Get trust score for a Function */
  async getTrustScore(functionId: string): Promise<unknown> {
    return this.getDb().get('trust_scores', `trust:${functionId}`)
  }

  /** Get invariant health for an invariant */
  async getInvariantHealth(invariantId: string): Promise<unknown> {
    return this.getDb().get('invariant_health', `inv:${invariantId}`)
  }

  /** System health — ArangoDB connectivity + collection stats */
  async getSystemHealth(): Promise<SystemHealth> {
    const db = this.getDb()
    const arangoUp = await db.ping()

    if (!arangoUp) {
      return {
        status: 'degraded',
        arango: false,
        collections: {},
        timestamp: new Date().toISOString(),
      }
    }

    const collections: Record<string, number> = {}
    for (const [name, collection] of Object.entries(SPEC_COLLECTIONS)) {
      const result = await db.queryOne<{ count: number }>(
        `RETURN { count: LENGTH(@@col) }`,
        { '@col': collection },
      )
      collections[name] = result?.count ?? 0
    }

    // Memory tier counts
    const memoryTiers = ['episodic', 'semantic', 'working', 'personal']
    for (const tier of memoryTiers) {
      const result = await db.queryOne<{ count: number }>(
        `RETURN { count: LENGTH(@@col) }`,
        { '@col': `memory_${tier}` },
      )
      collections[`memory_${tier}`] = result?.count ?? 0
    }

    // Lineage edge count
    const edgeResult = await db.queryOne<{ count: number }>(
      `RETURN { count: LENGTH(lineage_edges) }`,
    )
    collections['lineage_edges'] = edgeResult?.count ?? 0

    return {
      status: 'healthy',
      arango: true,
      collections,
      timestamp: new Date().toISOString(),
    }
  }

  // ── SDLC artifact queries ──

  /** List pending CRPs (for ACE inbox) */
  async listPendingCRPs(): Promise<unknown[]> {
    return this.getDb().query(
      `FOR crp IN consultation_requests
         FILTER crp.status == 'pending'
         SORT crp.createdAt DESC
         RETURN crp`,
    )
  }

  /** List pending MRPs (for ACE inbox) */
  async listPendingMRPs(): Promise<unknown[]> {
    return this.getDb().query(
      `FOR mrp IN merge_readiness_packs
         FILTER mrp.verdict == 'merge-ready'
         FILTER mrp.resolution == null
         SORT mrp.createdAt DESC
         RETURN mrp`,
    )
  }

  /** List active MentorScript rules */
  async listMentorRules(): Promise<unknown[]> {
    return this.getDb().query(
      `FOR rule IN mentorscript_rules
         FILTER rule.status == 'active'
         SORT rule._key ASC
         RETURN rule`,
    )
  }
}

// ── Types ──

interface LineageNode {
  id: string
  collection: string
  type: string
  title?: string
  depth: number
  edgeType?: string
}

interface SystemHealth {
  status: 'healthy' | 'degraded'
  arango: boolean
  collections: Record<string, number>
  timestamp: string
}
