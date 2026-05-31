const MAX_PAYLOAD_BYTES = 1024 * 1024
const VACUUM_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

type JsonRecord = Record<string, unknown>

type TxOp =
  | { kind: "update"; id: string; opts: unknown }
  | { kind: "set_metadata_batch"; id: string; kvs: Record<string, string> }
  | { kind: "close"; id: string }

export class FactoryStore {
  private ctx: DurableObjectState
  private db: SqlStorage
  private token: string

  constructor(ctx: DurableObjectState, env: { GC_SUPERVISOR_TOKEN?: string }) {
    this.ctx = ctx
    this.token = env.GC_SUPERVISOR_TOKEN ?? ""
    this.db = ctx.storage.sql
    this.db.exec("PRAGMA foreign_keys = ON")
    try {
      this.db.exec("PRAGMA auto_vacuum = INCREMENTAL")
      console.log("factory_store: auto_vacuum=INCREMENTAL set")
    } catch (err) {
      console.log(`factory_store: auto_vacuum unsupported: ${String(err)}`)
    }
    this.initSchema()
    ctx.storage.setAlarm(Date.now() + VACUUM_INTERVAL_MS).catch(() => {})
  }

  async alarm(): Promise<void> {
    this.db.exec("PRAGMA incremental_vacuum")
    await this.ctx.storage.setAlarm(Date.now() + VACUUM_INTERVAL_MS)
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const auth = request.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${this.token}`) {
        return this.json({ error: "unauthorized" }, 401)
      }
      const url = new URL(request.url)
      if (url.pathname.startsWith("/beads") || url.pathname.startsWith("/deps") || url.pathname === "/tx" || url.pathname === "/ping") {
        return this.handleBeads(request)
      }
      if (url.pathname.startsWith("/artifacts")) {
        return this.handleArtifacts(request)
      }
      return this.json({ error: "not_found" }, 404)
    } catch (err) {
      return this.sqliteError(err)
    }
  }

  private initSchema(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS beads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      issue_type TEXT NOT NULL DEFAULT 'task',
      priority INTEGER,
      created_at TEXT NOT NULL,
      assignee TEXT,
      from_ TEXT,
      parent_id TEXT,
      ref TEXT,
      needs TEXT,
      description TEXT,
      labels TEXT,
      metadata TEXT,
      ephemeral INTEGER NOT NULL DEFAULT 0
    )`)
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_status ON beads(status)")
    this.db.exec(`CREATE TABLE IF NOT EXISTS deps (
      issue_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      dep_type TEXT NOT NULL,
      PRIMARY KEY (issue_id, depends_on_id)
    )`)

    const ddl = [
      `CREATE TABLE IF NOT EXISTS specifications (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', payload TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS verification_processes (id TEXT PRIMARY KEY, spec_id TEXT NOT NULL REFERENCES specifications(id), kind TEXT NOT NULL, status TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), started_at TEXT NOT NULL, completed_at TEXT, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS verdicts (id TEXT PRIMARY KEY, vp_id TEXT NOT NULL REFERENCES verification_processes(id), spec_id TEXT NOT NULL REFERENCES specifications(id), outcome TEXT NOT NULL, coverage_pct REAL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), produced_at TEXT NOT NULL, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS lineage_edges (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, from_kind TEXT NOT NULL, to_id TEXT NOT NULL, to_kind TEXT NOT NULL, edge_kind TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, source_ref TEXT)`,
      `CREATE TABLE IF NOT EXISTS completion_events (id TEXT PRIMARY KEY, bead_id TEXT NOT NULL UNIQUE, fn_id TEXT NOT NULL, factory_attempt INTEGER NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS fidelity_verdicts (id TEXT PRIMARY KEY, bead_id TEXT NOT NULL, function_id TEXT NOT NULL, overall TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), produced_at TEXT NOT NULL, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS dispatch_log (id TEXT PRIMARY KEY, ep_id TEXT NOT NULL, fn_id TEXT NOT NULL, is_id TEXT NOT NULL, es_id TEXT NOT NULL, form_id TEXT, factory_attempt INTEGER NOT NULL, outcome TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), dispatched_at TEXT NOT NULL, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS specs_functions (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL, purpose TEXT, state TEXT NOT NULL DEFAULT 'draft', status TEXT NOT NULL DEFAULT 'active', source_refs TEXT NOT NULL, function_type TEXT, confidence REAL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS run_envelopes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS divergences (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'divergence', payload TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS hypotheses (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'hypothesis', payload TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS specs_signals (id TEXT PRIMARY KEY, source TEXT NOT NULL, subtype TEXT, status TEXT NOT NULL DEFAULT 'active', source_refs TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS merge_readiness_packs (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, function_id TEXT NOT NULL, es_id TEXT NOT NULL, readiness_verdict TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, payload TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS completion_ledgers (id TEXT PRIMARY KEY, results TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS lifecycle_transitions (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_state TEXT NOT NULL, from_state TEXT, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), ts TEXT NOT NULL)`
    ]
    for (const stmt of ddl) this.db.exec(stmt)

    const generic = ["function_proposals", "workgraphs", "pressures", "capabilities", "prds", "invariants", "consultation_requests", "candidate_sets", "elucidation_artifacts", "crps", "vcrs", "mrps", "mentor_rules", "agents", "assurance_graph", "specs_incidents", "memory_entries", "orl_telemetry"]
    for (const table of generic) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, agent_id TEXT NOT NULL, emission_bead_id TEXT REFERENCES beads(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    }
  }

  private async handleBeads(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/ping") return this.json({ ok: true })
    if (request.method === "POST" && url.pathname === "/beads") return this.createBead(await this.readJson(request))
    if (request.method === "GET" && url.pathname === "/beads") return this.queryBeads(url)
    if (request.method === "POST" && url.pathname === "/beads/close-all") return this.closeAll(await this.readJson(request))
    if (request.method === "POST" && url.pathname === "/tx") return this.runTx(await this.readJson(request))
    if (request.method === "POST" && url.pathname === "/deps") return this.depAdd(await this.readJson(request))
    if (request.method === "GET" && url.pathname.startsWith("/deps/")) return this.depList(url)
    if (request.method === "DELETE" && url.pathname.startsWith("/deps/")) return this.depRemove(url)

    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] === "beads" && parts[1]) {
      const id = parts[1]
      if (request.method === "GET" && parts.length === 2) return this.getBead(id)
      if (request.method === "PATCH" && parts.length === 2) return this.patchBead(id, await this.readJson(request))
      if (request.method === "DELETE" && parts.length === 2) return this.tombstoneBead(id)
      if (request.method === "POST" && parts[2] === "close") return this.closeBead(id)
      if (request.method === "POST" && parts[2] === "reopen") return this.reopenBead(id)
      if (request.method === "POST" && parts[2] === "metadata") return this.setMetadataBatch(id, await this.readJson(request))
    }
    return this.json({ error: "not_found" }, 404)
  }

  private async handleArtifacts(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts[0] !== "artifacts") return this.json({ error: "not_found" }, 404)
    if (request.method === "GET" && parts[1] === "lineage") return this.lineageWalk(url)
    if (request.method === "POST" && parts[1] === "lineage") return this.insertCollection("lineage_edges", await this.readJson(request))
    if (request.method === "POST" && parts[1] === "tx") return this.artifactTx(await this.readJson(request))

    const collection = parts[1]
    if (!collection) return this.json({ error: "not_found" }, 404)
    if (request.method === "POST" && parts.length === 2) return this.insertCollection(collection, await this.readJson(request))
    if (request.method === "GET" && parts.length === 2) return this.queryCollection(collection, url)
    if (request.method === "GET" && parts.length === 3) return this.getCollection(collection, parts[2])
    if (request.method === "PATCH" && parts.length === 3) return this.patchCollection(collection, parts[2], await this.readJson(request))
    return this.json({ error: "not_found" }, 404)
  }

  private createBead(bead: JsonRecord): Response {
    const id = this.nextID()
    this.db.exec(`INSERT INTO beads (id,title,status,issue_type,priority,created_at,assignee,from_,parent_id,ref,needs,description,labels,metadata,ephemeral)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`,
      id, String(bead.title ?? ""), String(bead.status ?? "open"), String(bead.issue_type ?? "task"), bead.priority ?? null, new Date().toISOString(),
      bead.assignee ?? null, bead.from ?? null, bead.parent ?? null, bead.ref ?? null,
      JSON.stringify(bead.needs ?? []), bead.description ?? null, JSON.stringify(bead.labels ?? []), JSON.stringify(bead.metadata ?? {}), bead.ephemeral ? 1 : 0)
    return this.getBead(id)
  }

  private getBead(id: string): Response {
    const row = this.db.exec("SELECT * FROM beads WHERE id = ?1", id).one() as JsonRecord | null
    if (!row) return this.json({ error: "not_found" }, 404)
    return this.json(this.mapBeadRow(row))
  }

  private patchBead(id: string, body: JsonRecord): Response {
    const opts = (body.opts ?? body) as JsonRecord
    const sets: string[] = []
    const values: unknown[] = []
    const add = (k: string, v: unknown): void => { sets.push(`${k} = ?${values.length + 1}`); values.push(v) }
    if (opts.title !== undefined) add("title", opts.title)
    if (opts.status !== undefined) add("status", opts.status)
    if (opts.issue_type !== undefined) add("issue_type", opts.issue_type)
    if (opts.priority !== undefined) add("priority", opts.priority)
    if (opts.description !== undefined) add("description", opts.description)
    if (opts.parent !== undefined) add("parent_id", opts.parent)
    if (opts.assignee !== undefined) add("assignee", opts.assignee)
    if (opts.metadata !== undefined) add("metadata", JSON.stringify(opts.metadata))
    if (opts.labels !== undefined) add("labels", JSON.stringify(opts.labels))
    if (sets.length > 0) this.db.exec(`UPDATE beads SET ${sets.join(", ")} WHERE id = ?${values.length + 1}`, ...values, id)
    return this.getBead(id)
  }

  private closeBead(id: string): Response { this.db.exec("UPDATE beads SET status='closed' WHERE id=?1", id); return this.json({ ok: true }) }
  private reopenBead(id: string): Response { this.db.exec("UPDATE beads SET status='open' WHERE id=?1", id); return this.json({ ok: true }) }
  private tombstoneBead(id: string): Response { this.db.exec("UPDATE beads SET status='deleted', ephemeral=0 WHERE id=?1", id); return this.json({ ok: true }) }

  private setMetadataBatch(id: string, body: JsonRecord): Response {
    const kvs = (body.kvs ?? {}) as Record<string, string>
    const row = this.db.exec("SELECT metadata FROM beads WHERE id=?1", id).one() as { metadata?: string } | null
    const metadata = row?.metadata ? JSON.parse(row.metadata) as Record<string, string> : {}
    Object.assign(metadata, kvs)
    this.db.exec("UPDATE beads SET metadata=?1 WHERE id=?2", JSON.stringify(metadata), id)
    return this.json({ ok: true })
  }

  private closeAll(body: JsonRecord): Response {
    const ids = (body.ids ?? []) as string[]
    for (const id of ids) this.db.exec("UPDATE beads SET status='closed' WHERE id=?1", id)
    return this.json({ closed: ids.length })
  }

  private runTx(body: JsonRecord): Response {
    const ops = (body.ops ?? []) as TxOp[]
    this.db.exec("BEGIN TRANSACTION")
    try {
      for (const op of ops) {
        if (op.kind === "update") this.patchBead(op.id, { opts: op.opts } as JsonRecord)
        if (op.kind === "set_metadata_batch") this.setMetadataBatch(op.id, { kvs: op.kvs })
        if (op.kind === "close") this.closeBead(op.id)
      }
      this.db.exec("COMMIT")
      return this.json({ ok: true })
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  private depAdd(body: JsonRecord): Response {
    this.db.exec("INSERT OR REPLACE INTO deps (issue_id,depends_on_id,dep_type) VALUES (?1,?2,?3)", body.issue_id, body.depends_on_id, body.dep_type)
    return this.json({ ok: true })
  }

  private depRemove(url: URL): Response {
    const parts = url.pathname.split("/")
    this.db.exec("DELETE FROM deps WHERE issue_id=?1 AND depends_on_id=?2", decodeURIComponent(parts[2] ?? ""), decodeURIComponent(parts[3] ?? ""))
    return this.json({ ok: true })
  }

  private depList(url: URL): Response {
    const id = decodeURIComponent(url.pathname.split("/")[2] ?? "")
    const up = url.searchParams.get("direction") === "up"
    const rows = up
      ? this.db.exec("SELECT issue_id, depends_on_id, dep_type FROM deps WHERE depends_on_id=?1", id).toArray()
      : this.db.exec("SELECT issue_id, depends_on_id, dep_type FROM deps WHERE issue_id=?1", id).toArray()
    return this.json(rows)
  }

  private queryBeads(url: URL): Response {
    const q = url.searchParams.get("query")
    if (!q) {
      const rows = this.db.exec("SELECT * FROM beads").toArray() as JsonRecord[]
      return this.json(rows.map((row) => this.mapBeadRow(row)))
    }
    const query = JSON.parse(q) as JsonRecord
    const where: string[] = []
    const values: unknown[] = []
    if (query.status) { where.push(`status=?${values.length + 1}`); values.push(query.status) }
    if (query.assignee) { where.push(`assignee=?${values.length + 1}`); values.push(query.assignee) }
    if (query.parent) { where.push(`parent_id=?${values.length + 1}`); values.push(query.parent) }
    const rows = this.db.exec(`SELECT * FROM beads${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}`, ...values).toArray() as JsonRecord[]
    return this.json(rows.map((row) => this.mapBeadRow(row)))
  }

  private mapBeadRow(row: JsonRecord): JsonRecord {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      issue_type: row.issue_type,
      priority: row.priority ?? null,
      created_at: row.created_at,
      assignee: row.assignee ?? "",
      from: row.from_ ?? "",
      parent: row.parent_id ?? "",
      ref: row.ref ?? "",
      needs: this.parseJSONArray(row.needs),
      description: row.description ?? "",
      labels: this.parseJSONArray(row.labels),
      metadata: this.parseJSONObject(row.metadata),
      ephemeral: Number(row.ephemeral ?? 0) === 1,
    }
  }

  private parseJSONArray(v: unknown): unknown[] {
    if (typeof v !== "string" || v.trim() === "") return []
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private parseJSONObject(v: unknown): Record<string, string> {
    if (typeof v !== "string" || v.trim() === "") return {}
    try {
      const parsed = JSON.parse(v)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
      return parsed as Record<string, string>
    } catch {
      return {}
    }
  }

  private insertCollection(collection: string, doc: JsonRecord): Response {
    this.enforcePayloadLimit(doc.payload)
    const keys = Object.keys(doc)
    const placeholders = keys.map((_, i) => `?${i + 1}`).join(",")
    const values = keys.map((k) => typeof doc[k] === "object" && doc[k] !== null ? JSON.stringify(doc[k]) : doc[k])
    this.db.exec(`INSERT INTO ${collection} (${keys.join(",")}) VALUES (${placeholders})`, ...values)
    return this.json({ ok: true }, 201)
  }

  private getCollection(collection: string, id: string): Response {
    const row = this.db.exec(`SELECT * FROM ${collection} WHERE id=?1`, id).one()
    if (!row) return this.json({ error: "not_found" }, 404)
    return this.json(row)
  }

  private patchCollection(collection: string, id: string, patch: JsonRecord): Response {
    this.enforcePayloadLimit(patch.payload)
    const keys = Object.keys(patch)
    if (keys.length === 0) return this.json({ ok: true })
    const sets = keys.map((k, i) => `${k}=?${i + 1}`).join(",")
    const values = keys.map((k) => typeof patch[k] === "object" && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k])
    this.db.exec(`UPDATE ${collection} SET ${sets} WHERE id=?${keys.length + 1}`, ...values, id)
    return this.json({ ok: true })
  }

  private queryCollection(collection: string, url: URL): Response {
    const q = url.searchParams.get("query")
    if (!q) return this.json(this.db.exec(`SELECT * FROM ${collection}`).toArray())
    const query = JSON.parse(q) as JsonRecord
    const keys = Object.keys(query)
    const where = keys.map((k, i) => `${k}=?${i + 1}`).join(" AND ")
    return this.json(this.db.exec(`SELECT * FROM ${collection}${keys.length > 0 ? ` WHERE ${where}` : ""}`, ...keys.map((k) => query[k])).toArray())
  }

  private artifactTx(body: JsonRecord): Response {
    const ops = (body.ops ?? []) as Array<{ collection: string; doc: JsonRecord }>
    this.db.exec("BEGIN TRANSACTION")
    try {
      for (const op of ops) this.insertCollection(op.collection, op.doc)
      this.db.exec("COMMIT")
      return this.json({ ok: true })
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
  }

  private lineageWalk(url: URL): Response {
    const from = url.searchParams.get("from")
    if (!from) return this.json({ error: "missing_from" }, 400)
    const rows = this.db.exec(`WITH RECURSIVE lineage_walk AS (
      SELECT id, from_id, to_id, from_kind, to_kind, edge_kind, 1 AS depth
      FROM lineage_edges WHERE to_id = ?1
      UNION ALL
      SELECT le.id, le.from_id, le.to_id, le.from_kind, le.to_kind, le.edge_kind, lw.depth + 1
      FROM lineage_edges le
      JOIN lineage_walk lw ON le.to_id = lw.from_id
      WHERE lw.depth < 10
    ) SELECT * FROM lineage_walk`, from).toArray()
    return this.json(rows)
  }

  private nextID(): string {
    const row = this.db.exec("SELECT COALESCE(MAX(CAST(SUBSTR(id,4) AS INT)),0)+1 AS next FROM beads WHERE id LIKE 'do-%'").one() as { next: number } | null
    return `do-${row?.next ?? 1}`
  }

  private async readJson(request: Request): Promise<JsonRecord> {
    const text = await request.text()
    return text.trim() ? JSON.parse(text) as JsonRecord : {}
  }

  private enforcePayloadLimit(payload: unknown): void {
    if (payload === undefined || payload === null) return
    const bytes = new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload)).byteLength
    if (bytes > MAX_PAYLOAD_BYTES) {
      throw new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: { "content-type": "application/json" } })
    }
  }

  private sqliteError(err: unknown): Response {
    if (err instanceof Response) return err
    const msg = String(err)
    if (msg.includes("FOREIGN KEY constraint failed")) return this.json({ error: "foreign_key_violation" }, 409)
    return this.json({ error: "internal_error", detail: msg }, 500)
  }

  private json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
  }
}
