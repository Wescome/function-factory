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
import { createClientFromEnv, type ArangoClient, type D1Database } from '@factory/arango-client'

interface QueryEnv {
  DB: D1Database
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

    const items = await db.query<{ json: string }>(
      `SELECT json FROM documents WHERE collection=? ORDER BY json->'$.createdAt' DESC LIMIT ? OFFSET ?`,
      [fullCollection, limit, offset],
    )

    const countResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM documents WHERE collection=?`,
      [fullCollection],
    )

    const parsed = items.map((row) => JSON.parse(row.json) as unknown)
    return { items: parsed, total: countResult?.count ?? 0 }
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

    // OUTBOUND traversal: follow lineage_edges forward from startId.
    // Returns each reachable node with its depth and the edge type on the
    // last hop that reached it.
    const rows = await db.query<{ json: string; depth: number; edge_data: string | null }>(
      `WITH RECURSIVE lineage(id, depth, edge_data) AS (
         SELECT e.to_id, 1, e.data
         FROM edges e
         WHERE e.collection='lineage_edges' AND e.from_id=?
         UNION ALL
         SELECT e.to_id, l.depth+1, e.data
         FROM edges e
         JOIN lineage l ON e.from_id=l.id
         WHERE e.collection='lineage_edges' AND l.depth < ?
       )
       SELECT DISTINCT d.json, l.depth, l.edge_data
       FROM lineage l
       JOIN documents d ON d.collection=SUBSTR(l.id, 1, INSTR(l.id,'/')-1)
                       AND d.key=SUBSTR(l.id, INSTR(l.id,'/')+1)`,
      [startId, maxDepth],
    )
    return rows.map((row) => {
      const doc = JSON.parse(row.json) as Record<string, unknown>
      const edgeData = row.edge_data ? (JSON.parse(row.edge_data) as Record<string, unknown>) : null
      const fullId = (doc._id ?? '') as string
      const slash = fullId.indexOf('/')
      return {
        id: (doc._key ?? '') as string,
        collection: slash >= 0 ? fullId.slice(0, slash) : '',
        type: (doc.type ?? '') as string,
        title: doc.title as string | undefined,
        depth: row.depth,
        edgeType: (edgeData?.type ?? undefined) as string | undefined,
      } satisfies LineageNode
    })
  }

  /** Get all downstream artifacts affected by a given artifact */
  async traceImpact(
    collection: string,
    key: string,
    maxDepth: number = 5,
  ): Promise<LineageNode[]> {
    const startId = `${resolveCollection(collection)}/${key}`
    const db = this.getDb()

    // INBOUND traversal: walk lineage_edges backwards from startId.
    // Swap from_id/to_id relative to the OUTBOUND case.
    const rows = await db.query<{ json: string; depth: number; edge_data: string | null }>(
      `WITH RECURSIVE impact(id, depth, edge_data) AS (
         SELECT e.from_id, 1, e.data
         FROM edges e
         WHERE e.collection='lineage_edges' AND e.to_id=?
         UNION ALL
         SELECT e.from_id, i.depth+1, e.data
         FROM edges e
         JOIN impact i ON e.to_id=i.id
         WHERE e.collection='lineage_edges' AND i.depth < ?
       )
       SELECT DISTINCT d.json, i.depth, i.edge_data
       FROM impact i
       JOIN documents d ON d.collection=SUBSTR(i.id, 1, INSTR(i.id,'/')-1)
                       AND d.key=SUBSTR(i.id, INSTR(i.id,'/')+1)`,
      [startId, maxDepth],
    )
    return rows.map((row) => {
      const doc = JSON.parse(row.json) as Record<string, unknown>
      const edgeData = row.edge_data ? (JSON.parse(row.edge_data) as Record<string, unknown>) : null
      const fullId = (doc._id ?? '') as string
      const slash = fullId.indexOf('/')
      return {
        id: (doc._key ?? '') as string,
        collection: slash >= 0 ? fullId.slice(0, slash) : '',
        type: (doc.type ?? '') as string,
        title: doc.title as string | undefined,
        depth: row.depth,
        edgeType: (edgeData?.type ?? undefined) as string | undefined,
      } satisfies LineageNode
    })
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
        `SELECT COUNT(*) AS count FROM documents WHERE collection=?`,
        [collection],
      )
      collections[name] = result?.count ?? 0
    }

    // Memory tier counts
    const memoryTiers = ['episodic', 'semantic', 'working', 'personal']
    for (const tier of memoryTiers) {
      const result = await db.queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM documents WHERE collection=?`,
        [`memory_${tier}`],
      )
      collections[`memory_${tier}`] = result?.count ?? 0
    }

    // Lineage edge count
    const edgeResult = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM edges WHERE collection='lineage_edges'`,
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
    const rows = await this.getDb().query<{ json: string }>(
      `SELECT json FROM documents
       WHERE collection='consultation_requests'
         AND json->>'$.status'='pending'
       ORDER BY json->>'$.createdAt' DESC`,
    )
    return rows.map((r) => JSON.parse(r.json) as unknown)
  }

  /** List pending MRPs (for ACE inbox) */
  async listPendingMRPs(): Promise<unknown[]> {
    const rows = await this.getDb().query<{ json: string }>(
      `SELECT json FROM documents
       WHERE collection='merge_readiness_packs'
         AND json->>'$.verdict'='merge-ready'
         AND json->>'$.resolution' IS NULL
       ORDER BY json->>'$.createdAt' DESC`,
    )
    return rows.map((r) => JSON.parse(r.json) as unknown)
  }

  /** List active MentorScript rules */
  async listMentorRules(): Promise<unknown[]> {
    const rows = await this.getDb().query<{ json: string }>(
      `SELECT json FROM documents
       WHERE collection='mentorscript_rules'
         AND json->>'$.status'='active'
       ORDER BY key ASC`,
    )
    return rows.map((r) => JSON.parse(r.json) as unknown)
  }
}

// ── Types ──

interface LineageNode {
  id: string
  collection: string
  type: string
  title?: string | undefined
  depth: number
  edgeType?: string | undefined
}

interface SystemHealth {
  status: 'healthy' | 'degraded'
  arango: boolean
  collections: Record<string, number>
  timestamp: string
}
