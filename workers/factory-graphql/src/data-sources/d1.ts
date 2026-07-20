/**
 * D1DataSource — queries over factory-ops (FACTORY_OPS_DB) and factory-artifacts (DB).
 *
 * factory-ops tables used:  session_state
 * factory-artifacts tables used: artifacts (main artifact store)
 *
 * Cursor-based pagination: cursor is a base64-encoded last session_id.
 */

export interface SessionRow {
  session_id: string
  assembly_id: string
  work_order_id: string | null
  status: string
  created_at: string
  updated_at: string
  run_id: string | null
  org_id: string | null
  intent_spec_id: string | null
  intent_spec_version: string | null
  intent_spec_domain: string | null
}

export interface ArtifactRow {
  id: string
  session_id: string
  kind: string
  content_ref: string | null
  content_hash: string | null
  created_at: string
  metadata: string | null   // JSON string
}

export interface LineageEdgeRow {
  source_id: string
  target_id: string
  rel: string
  props: string | null   // JSON string
}

export interface VerificationReportRow {
  report_id: string
  session_id: string
  kind: string
  verdict: string
  score: number | null
  notes: string | null
  produced_at: string
  artifact_id: string | null
}

export class D1DataSource {
  private readonly db: D1Database
  private readonly opsDb: D1Database

  constructor(db: D1Database, opsDb: D1Database) {
    this.db = db
    this.opsDb = opsDb
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const result = await this.opsDb
      .prepare(`SELECT * FROM session_state WHERE session_id = ?`)
      .bind(id)
      .first<SessionRow>()
    return result ?? null
  }

  async getSessions(
    assemblyId: string,
    status?: string | null,
    limit = 20,
    cursor?: string | null,
  ): Promise<{ sessions: SessionRow[]; cursor: string | null }> {
    const cap = Math.min(limit, 100)

    // Decode cursor (base64-encoded last session_id)
    let afterId: string | null = null
    if (cursor !== undefined && cursor !== null && cursor !== '') {
      try {
        afterId = atob(cursor)
      } catch {
        afterId = null
      }
    }

    let sql: string
    const bindings: unknown[] = [assemblyId]

    if (status !== undefined && status !== null && status !== '') {
      if (afterId !== null) {
        sql = `SELECT * FROM session_state
               WHERE assembly_id = ? AND status = ? AND session_id > ?
               ORDER BY session_id ASC LIMIT ?`
        bindings.push(status, afterId, cap)
      } else {
        sql = `SELECT * FROM session_state
               WHERE assembly_id = ? AND status = ?
               ORDER BY session_id ASC LIMIT ?`
        bindings.push(status, cap)
      }
    } else {
      if (afterId !== null) {
        sql = `SELECT * FROM session_state
               WHERE assembly_id = ? AND session_id > ?
               ORDER BY session_id ASC LIMIT ?`
        bindings.push(afterId, cap)
      } else {
        sql = `SELECT * FROM session_state
               WHERE assembly_id = ?
               ORDER BY session_id ASC LIMIT ?`
        bindings.push(cap)
      }
    }

    const bound = this.opsDb.prepare(sql).bind(...bindings)
    const { results } = await bound.all<SessionRow>()
    const sessions = results ?? []

    let nextCursor: string | null = null
    if (sessions.length === cap) {
      const last = sessions[sessions.length - 1]
      if (last !== undefined) {
        nextCursor = btoa(last.session_id)
      }
    }

    return { sessions, cursor: nextCursor }
  }

  async getArtifact(id: string): Promise<ArtifactRow | null> {
    const result = await this.db
      .prepare(`SELECT * FROM artifacts WHERE id = ?`)
      .bind(id)
      .first<ArtifactRow>()
    return result ?? null
  }

  async getLineageEdges(artifactId: string, depth: number): Promise<LineageEdgeRow[]> {
    const safeDepth = Math.min(depth, 5)
    // Recursive CTE traversing forward from the root artifact up to safeDepth hops.
    const sql = `
      WITH RECURSIVE lineage(source_id, target_id, rel, props, depth) AS (
        SELECT source_id, target_id, rel, props, 1
        FROM artifact_edges
        WHERE source_id = ?
        UNION ALL
        SELECT e.source_id, e.target_id, e.rel, e.props, l.depth + 1
        FROM artifact_edges e
        JOIN lineage l ON l.target_id = e.source_id
        WHERE l.depth < ?
      )
      SELECT source_id, target_id, rel, props FROM lineage
    `
    const { results } = await this.db
      .prepare(sql)
      .bind(artifactId, safeDepth)
      .all<LineageEdgeRow>()
    return results ?? []
  }

  async getSessionsByWorkOrder(workOrderId: string): Promise<SessionRow[]> {
    const { results } = await this.opsDb
      .prepare(`SELECT * FROM session_state WHERE work_order_id = ? ORDER BY created_at ASC`)
      .bind(workOrderId)
      .all<SessionRow>()
    return results ?? []
  }

  async getArtifactsForSession(sessionId: string, kinds?: string[] | null): Promise<ArtifactRow[]> {
    if (kinds !== undefined && kinds !== null && kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(', ')
      const sql = `SELECT * FROM artifacts WHERE session_id = ? AND kind IN (${placeholders}) ORDER BY created_at ASC`
      const { results } = await this.db
        .prepare(sql)
        .bind(sessionId, ...kinds)
        .all<ArtifactRow>()
      return results ?? []
    }
    const { results } = await this.db
      .prepare(`SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC`)
      .bind(sessionId)
      .all<ArtifactRow>()
    return results ?? []
  }

  async getVerificationReports(sessionId: string): Promise<VerificationReportRow[]> {
    const { results } = await this.opsDb
      .prepare(`SELECT * FROM verification_reports WHERE session_id = ? ORDER BY produced_at ASC`)
      .bind(sessionId)
      .all<VerificationReportRow>()
    return results ?? []
  }
}
