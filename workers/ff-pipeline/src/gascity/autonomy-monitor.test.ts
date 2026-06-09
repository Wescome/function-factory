import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  db: null as unknown,
}))

vi.mock("@factory/db-client", () => ({
  createClientFromEnv: () => state.db,
}))

class MemoryDb {
  collections = new Map<string, Map<string, Record<string, unknown>>>()
  edges: Record<string, unknown>[] = []
  indexes: Record<string, unknown>[] = []

  collection(name: string): Map<string, Record<string, unknown>> {
    let collection = this.collections.get(name)
    if (!collection) {
      collection = new Map()
      this.collections.set(name, collection)
    }
    return collection
  }

  async ensureCollection(name: string): Promise<void> {
    this.collection(name)
  }

  async ensureIndex(collection: string, options: Record<string, unknown>): Promise<void> {
    this.indexes.push({ collection, ...options })
  }

  async get(collection: string, key: string): Promise<Record<string, unknown> | null> {
    return this.collection(collection).get(key) ?? null
  }

  async save(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const key = typeof doc._key === "string" ? doc._key : crypto.randomUUID()
    if (this.collection(collection).has(key)) throw new Error("409 conflict")
    const saved = { ...doc, _key: key }
    this.collection(collection).set(key, saved)
    return saved
  }

  async update(collection: string, key: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const existing = this.collection(collection).get(key)
    if (!existing) throw new Error("404 missing")
    const updated = { ...existing, ...patch }
    this.collection(collection).set(key, updated)
    return updated
  }

  async saveEdge(collection: string, from: string, to: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const edge = { _from: from, _to: to, ...data }
    this.edges.push({ collection, ...edge })
    return edge
  }

  // Wrap a doc in D1 row shape so parseRows() works
  private wrap<T extends Record<string, unknown>>(doc: T): { json: string } {
    return { json: JSON.stringify(doc) }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    // Aggregate: state counts
    if (sql.includes("GROUP BY") && sql.includes("specs_functions")) {
      const counts = new Map<string, number>()
      for (const fn of this.collection("specs_functions").values()) {
        const stateValue = typeof fn.state === "string" ? fn.state : "unknown"
        counts.set(stateValue, (counts.get(stateValue) ?? 0) + 1)
      }
      return [...counts].map(([stateValue, count]) => ({ state: stateValue, count })) as T[]
    }
    // Aggregate: escalation groups
    if (sql.includes("specs_incidents") && sql.includes("GROUP BY")) {
      const threshold = Number(params[0] ?? 3)
      const groups = new Map<string, { incidentType: string; functionId: string; incidentIds: string[] }>()
      for (const inc of this.collection("specs_incidents").values()) {
        if (inc.status !== "open" || typeof inc.incidentType !== "string" || !inc.incidentType.startsWith("gascity_")) continue
        const functionIds = Array.isArray(inc.functionIds) ? inc.functionIds : []
        const functionId = typeof functionIds[0] === "string" ? functionIds[0] : "FN-GC-DISPATCH-WIRE"
        const key = `${inc.incidentType}|${functionId}`
        const group = groups.get(key) ?? { incidentType: inc.incidentType, functionId, incidentIds: [] }
        group.incidentIds.push(String(inc.id))
        groups.set(key, group)
      }
      return [...groups.values()]
        .filter((group) => group.incidentIds.length >= threshold)
        .map((group) => ({ ...group, count: group.incidentIds.length, incidentIdsList: group.incidentIds.join(',') })) as T[]
    }
    // Document queries — return { json } rows so parseRows() works
    if (sql.includes("specs_functions") && sql.includes("'accepted'")) {
      return [...this.collection("specs_functions").values()]
        .filter((fn) => fn.state === "accepted")
        .map(doc => this.wrap(doc)) as T[]
    }
    if (sql.includes("specs_functions") && sql.includes("'monitored'")) {
      return [...this.collection("specs_functions").values()]
        .filter((fn) => fn.state === "monitored")
        .map(doc => this.wrap(doc)) as T[]
    }
    if (sql.includes("persistence_verdicts")) {
      return [...this.collection("persistence_verdicts").values()]
        .map(doc => this.wrap(doc)) as T[]
    }
    if (sql.includes("dispatch_log")) {
      const cutoff = String(params[0] ?? "")
      const completions = new Set([...this.collection("completion_events").values()].map((ce) => ce.bead_id))
      return [...this.collection("dispatch_log").values()]
        .filter((dl) => dl.outcome === "dispatched" && String(dl.started_at) < cutoff && !completions.has(dl.gc_bead_id))
        .map(doc => this.wrap(doc)) as T[]
    }
    if (sql.includes("specs_incidents")) {
      return [...this.collection("specs_incidents").values()]
        .map(doc => this.wrap(doc)) as T[]
    }
    if (sql.includes("specs_pressures")) {
      return [...this.collection("specs_pressures").values()]
        .map(doc => this.wrap(doc)) as T[]
    }
    return []
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (sql.includes("fidelity_verdicts")) {
      const functionId = params[0] as string
      const found = [...this.collection("fidelity_verdicts").values()]
        .filter((vr) => vr.function_id === functionId && vr.overall === "pass")
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))[0]
      return (found ? this.wrap(found) : null) as T | null
    }
    if (sql.includes("completion_events")) {
      const functionId = params[0] as string
      const found = [...this.collection("completion_events").values()]
        .filter((ce) => ce.fn_id === functionId)
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))[0]
      return (found ? this.wrap(found) : null) as T | null
    }
    if (sql.includes("persistence_verdicts")) {
      const functionId = params[0] as string
      const found = [...this.collection("persistence_verdicts").values()]
        .filter((vr) => vr.function_id === functionId)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0]
      return (found ? this.wrap(found) : null) as T | null
    }
    const rows = await this.query<T>(sql, params)
    return rows[0] ?? null
  }
}

describe("Gas City autonomy monitor", () => {
  let db: MemoryDb

  beforeEach(() => {
    db = new MemoryDb()
    state.db = db
  })

  it("promotes accepted Functions to monitored only after fresh fidelity and persistence evidence", async () => {
    const { runGasCityAutonomyMonitor } = await import("./autonomy-monitor.js")
    const now = new Date().toISOString()
    await db.save("specs_functions", { _key: "FN-GC-DISPATCH-WIRE", id: "FN-GC-DISPATCH-WIRE", state: "accepted", source_refs: ["FN-GC-DISPATCH-WIRE"] })
    await db.save("fidelity_verdicts", {
      _key: "VR-FIDELITY-1",
      id: "VR-FIDELITY-1",
      function_id: "FN-GC-DISPATCH-WIRE",
      overall: "pass",
      received_at: now,
    })
    await db.save("completion_events", {
      _key: "gc-1",
      bead_id: "gc-1",
      fn_id: "FN-GC-DISPATCH-WIRE",
      received_at: now,
      fidelity_verdict_id: "VR-FIDELITY-1",
    })

    const summary = await runGasCityAutonomyMonitor({ GAS_CITY_PERSISTENCE_FRESHNESS_HOURS: "24" } as never, "manual")

    expect(summary.lifecycle_promotions).toBe(1)
    expect(summary.persistence_reports_written).toBe(1)
    expect(await db.get("specs_functions", "FN-GC-DISPATCH-WIRE")).toMatchObject({ state: "monitored" })
    expect([...db.collection("persistence_verdicts").values()][0]).toMatchObject({
      verification: "persistence",
      function_id: "FN-GC-DISPATCH-WIRE",
      overall: "pass",
    })
    expect(db.edges[0]).toMatchObject({
      collection: "lifecycle_transitions",
      from: "accepted",
      to: "monitored",
      trigger: "gascity-autonomy:manual",
    })
  })

  it("escalates recurring Gas City incidents into an operational Pressure", async () => {
    const { runGasCityAutonomyMonitor } = await import("./autonomy-monitor.js")
    for (let i = 1; i <= 3; i += 1) {
      await db.save("specs_incidents", {
        _key: `INC-GC-DISPATCH-STALE-${i}`,
        id: `INC-GC-DISPATCH-STALE-${i}`,
        incidentType: "gascity_dispatch_stale",
        status: "open",
        functionIds: ["FN-GC-DISPATCH-WIRE"],
        source_refs: ["FN-GC-DISPATCH-WIRE"],
      })
    }

    const summary = await runGasCityAutonomyMonitor({ GAS_CITY_RECURRING_INCIDENT_THRESHOLD: "3" } as never, "cron")

    expect(summary.pressures_created).toBe(1)
    expect([...db.collection("specs_pressures").values()][0]).toMatchObject({
      category: "reliability",
      name: "Recurring gascity_dispatch_stale for FN-GC-DISPATCH-WIRE",
    })
  })

  it("creates a dispatched Function record after successful Gas City dispatch", async () => {
    const { markFunctionDispatched } = await import("./autonomy-monitor.js")

    await markFunctionDispatched(db as never, {
      functionId: "FN-GC-DISPATCH-WIRE",
      isId: "IS-GC-DISPATCH-WIRE",
      esId: "ES-GC-DISPATCH-WIRE",
      epId: "EP-GC-DISPATCH-WIRE",
      formId: "FORM-ABC",
      dispatchLogKey: "DL-1",
      timestamp: "2026-05-28T00:00:00.000Z",
    })

    expect(await db.get("specs_functions", "FN-GC-DISPATCH-WIRE")).toMatchObject({
      id: "FN-GC-DISPATCH-WIRE",
      state: "dispatched",
      state_evidence_key: "DL-1",
      source_refs: ["FN-GC-DISPATCH-WIRE", "IS-GC-DISPATCH-WIRE", "ES-GC-DISPATCH-WIRE", "EP-GC-DISPATCH-WIRE", "FORM-ABC"],
    })
  })
})
