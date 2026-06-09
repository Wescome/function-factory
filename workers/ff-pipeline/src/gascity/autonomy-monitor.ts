import { createClientFromEnv } from "@factory/db-client"
import { Incident, PersistenceVerificationReport, Pressure } from "@factory/schemas"
import type { PipelineEnv } from "../types.js"
import { ensureGasCityCollections } from "./collection-schema.js"
import { transitionFunctionState, type FunctionState } from "./function-lifecycle.js"

interface AutonomyDb {
  ensureCollection(collection: string, options?: { type?: "document" | "edge" }): Promise<void>
  ensureIndex?(
    collection: string,
    options: {
      type: "hash" | "persistent" | "skiplist"
      fields: string[]
      unique?: boolean
      sparse?: boolean
      name?: string
    },
  ): Promise<void>
  get<T = unknown>(collection: string, key: string): Promise<T | null>
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>
  save<T = unknown>(collection: string, doc: Record<string, unknown>): Promise<T>
  update<T = unknown>(collection: string, key: string, patch: Record<string, unknown>): Promise<T>
  saveEdge(collection: string, from: string, to: string, data: Record<string, unknown>): Promise<unknown>
}

// Parse json rows returned by D1 document queries
function parseRows<T>(rows: { json: string }[]): T[] {
  return rows.map(r => JSON.parse(r.json) as T)
}
function parseRow<T>(row: { json: string } | null): T | null {
  return row ? JSON.parse(row.json) as T : null
}

interface FunctionRecord {
  _key?: string
  id?: string
  functionId?: string
  state?: string
  source_refs?: string[]
}

interface FidelityRecord {
  id?: string
  _key?: string
  function_id?: string
  overall?: string
  received_at?: string
  timestamp?: string
}

interface CompletionEventRecord {
  bead_id?: string
  fn_id?: string
  received_at?: string
  fidelity_verdict_id?: string
}

interface IncidentRecord {
  id?: string
  _key?: string
  incidentType?: string
  status?: string
  functionIds?: string[]
}

interface PressureRecord {
  id?: string
  _key?: string
}

export interface GasCityAutonomySummary {
  ok: boolean
  trigger: "cron" | "manual" | "smoke"
  timestamp: string
  accepted_checked: number
  monitored_checked: number
  persistence_reports_written: number
  lifecycle_promotions: number
  regressions: number
  incidents_created: number
  pressures_created: number
  stale_dispatches: number
}

const DEFAULT_FRESHNESS_HOURS = 24
const DEFAULT_DISPATCH_STALE_MINUTES = 60
const DEFAULT_RECURRING_INCIDENT_THRESHOLD = 3

export async function runGasCityAutonomyMonitor(
  env: PipelineEnv,
  trigger: GasCityAutonomySummary["trigger"] = "cron",
): Promise<GasCityAutonomySummary> {
  const db = createClientFromEnv(env) as unknown as AutonomyDb
  await ensureAutonomyCollections(db)

  const now = new Date()
  const timestamp = now.toISOString()
  const freshnessHours = positiveNumber(env.GAS_CITY_PERSISTENCE_FRESHNESS_HOURS, DEFAULT_FRESHNESS_HOURS)
  const staleDispatchMinutes = positiveNumber(env.GAS_CITY_DISPATCH_STALE_MINUTES, DEFAULT_DISPATCH_STALE_MINUTES)
  const recurringThreshold = positiveNumber(env.GAS_CITY_RECURRING_INCIDENT_THRESHOLD, DEFAULT_RECURRING_INCIDENT_THRESHOLD)
  const freshnessCutoff = new Date(now.getTime() - freshnessHours * 60 * 60 * 1000)
  const staleDispatchCutoff = new Date(now.getTime() - staleDispatchMinutes * 60 * 1000).toISOString()

  const summary: GasCityAutonomySummary = {
    ok: true,
    trigger,
    timestamp,
    accepted_checked: 0,
    monitored_checked: 0,
    persistence_reports_written: 0,
    lifecycle_promotions: 0,
    regressions: 0,
    incidents_created: 0,
    pressures_created: 0,
    stale_dispatches: 0,
  }

  // Smoke mode is a bounded liveness probe for operator workflows
  // (e.g. first-dispatch.sh step 6). It intentionally avoids the
  // full monitor sweep to keep response time tight and predictable.
  if (trigger === "smoke") {
    const ping = await queryWithTimeout(
      db.query<{ ok: number }>("SELECT 1 AS ok"),
      [] as Array<{ ok: number }>,
      5000,
    )
    if (ping.length === 0) {
      return { ...summary, ok: false }
    }
    return summary
  }

  const accepted = await queryWithTimeout(
    db.query<{ json: string }>(
      `SELECT json FROM documents WHERE collection='specs_functions' AND json_extract(json,'$.state')='accepted' LIMIT 100`,
    ).then(rows => parseRows<FunctionRecord>(rows)),
    [] as FunctionRecord[],
    8000,
  )
  summary.accepted_checked = accepted.length
  for (const fn of accepted) {
    const functionId = functionIdOf(fn)
    if (!functionId) continue
    const evaluation = await evaluateFunctionPersistence(db, functionId, freshnessCutoff, timestamp)
    if (evaluation.reportWritten) summary.persistence_reports_written += 1
    if (evaluation.overall === "pass") {
      await transitionFunctionState(db, {
        functionId,
        from: "accepted",
        to: "monitored",
        evidenceKey: evaluation.reportId,
        trigger: `gascity-autonomy:${trigger}`,
        timestamp,
      })
      summary.lifecycle_promotions += 1
    } else {
      const created = await writePersistenceIncident(db, functionId, evaluation.reportId, timestamp)
      if (created) summary.incidents_created += 1
    }
  }

  const monitored = await queryWithTimeout(
    db.query<{ json: string }>(
      `SELECT json FROM documents WHERE collection='specs_functions' AND json_extract(json,'$.state')='monitored' LIMIT 100`,
    ).then(rows => parseRows<FunctionRecord>(rows)),
    [] as FunctionRecord[],
    8000,
  )
  summary.monitored_checked = monitored.length
  for (const fn of monitored) {
    const functionId = functionIdOf(fn)
    if (!functionId) continue
    const latest = await latestPersistenceReport(db, functionId)
    if (!latest || latest.overall !== "pass" || !isFresh(isoValue(latest.timestamp), freshnessCutoff)) {
      const report = await writePersistenceReport(db, {
        functionId,
        timestamp,
        overall: "fail",
        stale: true,
        fidelity: null,
        completion: null,
      })
      const created = await writePersistenceIncident(db, functionId, report.id, timestamp)
      if (created) summary.incidents_created += 1
      await transitionFunctionState(db, {
        functionId,
        from: "monitored",
        to: "regressed",
        evidenceKey: report.id,
        trigger: `gascity-autonomy:${trigger}`,
        timestamp,
      })
      summary.regressions += 1
    }
  }

  const staleDispatches = await queryWithTimeout(
    db.query<{ json: string }>(
      `SELECT d.json FROM documents d
       WHERE d.collection='dispatch_log'
         AND json_extract(d.json,'$.outcome')='dispatched'
         AND json_extract(d.json,'$.started_at') < ?
         AND NOT EXISTS (
           SELECT 1 FROM documents ce
           WHERE ce.collection='completion_events'
             AND json_extract(ce.json,'$.bead_id')=json_extract(d.json,'$.gc_bead_id')
         )
       LIMIT 100`,
      [staleDispatchCutoff],
    ).then(rows => parseRows<Record<string, unknown>>(rows)),
    [] as Record<string, unknown>[],
    8000,
  )
  summary.stale_dispatches = staleDispatches.length
  for (const dispatch of staleDispatches) {
    const created = await writeDispatchStaleIncident(db, dispatch, timestamp, staleDispatchMinutes)
    if (created) summary.incidents_created += 1
  }

  const pressures = await escalateRecurringIncidents(db, timestamp, recurringThreshold)
  summary.pressures_created += pressures
  return summary
}

export async function getGasCityAutonomyStatus(env: PipelineEnv): Promise<Record<string, unknown>> {
  const db = createClientFromEnv(env) as unknown as AutonomyDb
  const [states, recentPersistence, openIncidents, pressures] = await Promise.all([
    queryWithTimeout(
      db.query<{ state: string; count: number }>(
        `SELECT json_extract(json,'$.state') as state, COUNT(*) as count
         FROM documents WHERE collection='specs_functions'
         GROUP BY json_extract(json,'$.state')`,
      ),
      [],
      6000,
    ),
    queryWithTimeout(
      db.query<{ json: string }>(
        `SELECT json FROM documents WHERE collection='persistence_verdicts'
         ORDER BY json_extract(json,'$.timestamp') DESC LIMIT 10`,
      ).then(rows => parseRows<Record<string, unknown>>(rows)),
      [],
      6000,
    ),
    queryWithTimeout(
      db.query<{ json: string }>(
        `SELECT json FROM documents WHERE collection='specs_incidents'
         AND json_extract(json,'$.status')='open'
         ORDER BY json_extract(json,'$.openedAt') DESC LIMIT 10`,
      ).then(rows => parseRows<Record<string, unknown>>(rows)),
      [],
      6000,
    ),
    queryWithTimeout(
      db.query<{ json: string }>(
        `SELECT json FROM documents WHERE collection='specs_pressures'
         AND json_extract(json,'$.id') LIKE 'PRS-OPS-GC-%'
         ORDER BY json_extract(json,'$.createdAt') DESC LIMIT 10`,
      ).then(rows => parseRows<Record<string, unknown>>(rows)),
      [],
      6000,
    ),
  ])
  return {
    ok: true,
    timestamp: new Date().toISOString(),
    function_states: Object.fromEntries(states.map((row) => [row.state || "unknown", row.count])),
    recent_persistence: recentPersistence,
    open_incidents: openIncidents,
    operational_pressures: pressures,
  }
}

async function queryWithTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function markFunctionDispatched(
  db: AutonomyDb,
  input: {
    functionId: string
    isId?: string
    esId?: string
    epId?: string
    formId?: string
    dispatchLogKey?: string
    timestamp: string
  },
): Promise<void> {
  await db.ensureCollection("specs_functions")
  const existing = await db.get<FunctionRecord>("specs_functions", input.functionId)
  const sourceRefs = [input.functionId, input.isId, input.esId, input.epId, input.formId]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
  if (!existing) {
    await db.save("specs_functions", {
      _key: input.functionId,
      id: input.functionId,
      functionId: input.functionId,
      state: "dispatched",
      state_updated_at: input.timestamp,
      state_evidence_key: input.dispatchLogKey ?? input.formId ?? input.epId,
      source_refs: sourceRefs.length > 0 ? sourceRefs : [input.functionId],
      explicitness: "explicit",
      rationale: "Function record created from successful Gas City dispatch.",
    })
    return
  }

  const current = typeof existing.state === "string" ? existing.state : ""
  if (current === "accepted" || current === "monitored" || current === "regressed" || current === "retired") return
  await db.update("specs_functions", input.functionId, {
    state: "dispatched",
    state_updated_at: input.timestamp,
    state_evidence_key: input.dispatchLogKey ?? input.formId ?? input.epId,
  })
}

async function ensureAutonomyCollections(db: AutonomyDb): Promise<void> {
  await ensureGasCityCollections(db)
  for (const collection of ["specs_functions", "verification_reports", "persistence_verdicts", "specs_incidents", "specs_pressures", "gascity_drift_events"]) {
    await db.ensureCollection(collection)
  }
  if (!db.ensureIndex) return
  await db.ensureIndex("persistence_verdicts", { type: "hash", fields: ["function_id", "overall"], name: "idx_persistence_function_overall" })
  await db.ensureIndex("persistence_verdicts", { type: "skiplist", fields: ["timestamp"], name: "idx_persistence_timestamp" })
  await db.ensureIndex("specs_incidents", { type: "hash", fields: ["incidentType", "status"], name: "idx_incident_type_status" })
  await db.ensureIndex("specs_pressures", { type: "hash", fields: ["id"], unique: true, name: "idx_pressure_id" })
}

async function evaluateFunctionPersistence(
  db: AutonomyDb,
  functionId: string,
  freshnessCutoff: Date,
  timestamp: string,
): Promise<{ overall: "pass" | "fail"; reportId: string; reportWritten: boolean }> {
  const fidelity = await db.queryOne<{ json: string }>(
    `SELECT json FROM documents WHERE collection='fidelity_verdicts'
     AND json_extract(json,'$.function_id')=?
     AND json_extract(json,'$.overall')='pass'
     ORDER BY json_extract(json,'$.received_at') DESC LIMIT 1`,
    [functionId],
  ).then(row => parseRow<FidelityRecord>(row))
  const completion = await db.queryOne<{ json: string }>(
    `SELECT json FROM documents WHERE collection='completion_events'
     AND json_extract(json,'$.fn_id')=?
     ORDER BY json_extract(json,'$.received_at') DESC LIMIT 1`,
    [functionId],
  ).then(row => parseRow<CompletionEventRecord>(row))
  const fresh = !!fidelity && !!completion && isFresh(isoValue(fidelity.received_at ?? fidelity.timestamp), freshnessCutoff) && isFresh(isoValue(completion.received_at), freshnessCutoff)
  const report = await writePersistenceReport(db, {
    functionId,
    timestamp,
    overall: fresh ? "pass" : "fail",
    stale: !fresh,
    fidelity,
    completion,
  })
  return { overall: fresh ? "pass" : "fail", reportId: report.id, reportWritten: true }
}

async function latestPersistenceReport(db: AutonomyDb, functionId: string): Promise<Record<string, unknown> | null> {
  return db.queryOne<{ json: string }>(
    `SELECT json FROM documents WHERE collection='persistence_verdicts'
     AND json_extract(json,'$.function_id')=?
     ORDER BY json_extract(json,'$.timestamp') DESC LIMIT 1`,
    [functionId],
  ).then(row => parseRow<Record<string, unknown>>(row))
}

async function writePersistenceReport(
  db: AutonomyDb,
  input: {
    functionId: string
    timestamp: string
    overall: "pass" | "fail"
    stale: boolean
    fidelity: FidelityRecord | null
    completion: CompletionEventRecord | null
  },
): Promise<{ id: string }> {
  const base = `${input.functionId}|${input.timestamp}|${input.overall}`
  const id = `VR-GC-PERSIST-${(await sha256Hex(base)).slice(0, 12).toUpperCase()}`
  const report = PersistenceVerificationReport.parse({
    id,
    verification: "persistence",
    function_id: input.functionId,
    timestamp: input.timestamp,
    overall: input.overall,
    checks: {
      detector_freshness: {
        status: input.stale ? "fail" : "pass",
        details: [{
          detail: input.stale ? "No fresh Gas City fidelity/completion evidence found." : "Latest Gas City fidelity/completion evidence is fresh.",
        }],
        stale_detectors: input.stale ? [{
          invariant_id: input.functionId,
          detector: "gascity-completion-events",
          last_report: isoValue(input.fidelity?.received_at ?? input.fidelity?.timestamp ?? input.completion?.received_at) ?? null,
          threshold: `${DEFAULT_FRESHNESS_HOURS}h`,
        }] : [],
      },
      evidence_source_liveness: {
        status: input.completion && !input.stale ? "pass" : "fail",
        details: [{
          detail: input.completion ? "Gas City completion event source emitted evidence." : "Gas City completion event source has no evidence for this Function.",
        }],
        quiet_sources: input.completion && !input.stale ? [] : [{
          source: "completion_events",
          last_emission: isoValue(input.completion?.received_at) ?? null,
          expected_cadence: `${DEFAULT_FRESHNESS_HOURS}h`,
        }],
      },
      audit_pipeline_integrity: {
        status: input.fidelity && input.completion ? "pass" : "fail",
        details: [{
          detail: input.fidelity && input.completion ? "Fidelity verdict and completion event are both present." : "Missing fidelity verdict or completion event.",
        }],
        expected_vs_observed: {
          expected: 2,
          observed: Number(!!input.fidelity) + Number(!!input.completion),
          divergence_pct: input.fidelity && input.completion ? 0 : 50,
        },
      },
    },
    remediation: input.overall === "pass" ? "Continue monitoring through Cloudflare cron." : "Investigate missing or stale Gas City completion/fidelity evidence.",
    source_refs: [input.functionId, input.fidelity?.id ?? input.fidelity?._key, input.completion?.fidelity_verdict_id]
      .filter((value): value is string => typeof value === "string" && value.length > 0),
    explicitness: "explicit",
    rationale: "Cloudflare scheduled Gas City autonomy monitor evaluated detector freshness and evidence liveness.",
  })
  const doc = { _key: id, ...report }
  await saveIfMissing(db, "persistence_verdicts", id, doc)
  await saveIfMissing(db, "verification_reports", id, doc)
  return { id }
}

async function writePersistenceIncident(db: AutonomyDb, functionId: string, reportId: string, timestamp: string): Promise<boolean> {
  const id = `INC-GC-PERSISTENCE-${(await sha256Hex(`${functionId}|${reportId}`)).slice(0, 12).toUpperCase()}`
  const incident = Incident.parse({
    id,
    invariantIds: [functionId],
    functionIds: [functionId],
    severity: "sev3",
    status: "open",
    confidence: 0.9,
    source_refs: [functionId, reportId],
    explicitness: "explicit",
    rationale: "Gas City Persistence Verification failed or went stale.",
  })
  return saveIfMissing(db, "specs_incidents", id, {
    _key: id,
    ...incident,
    incidentType: "gascity_persistence_stale",
    title: `Gas City Persistence Verification stale for ${functionId}`,
    description: `Persistence Verification ${reportId} did not pass.`,
    openedAt: timestamp,
    persistence_verdict_id: reportId,
  })
}

async function writeDispatchStaleIncident(
  db: AutonomyDb,
  dispatch: Record<string, unknown>,
  timestamp: string,
  staleDispatchMinutes: number,
): Promise<boolean> {
  const functionId = stringValue(dispatch.fn_id) ?? "FN-GC-DISPATCH-WIRE"
  const dispatchKey = stringValue(dispatch._key) ?? stringValue(dispatch.dispatch_log_key) ?? "unknown"
  const id = `INC-GC-DISPATCH-STALE-${(await sha256Hex(`${functionId}|${dispatchKey}`)).slice(0, 12).toUpperCase()}`
  const incident = Incident.parse({
    id,
    invariantIds: [],
    functionIds: [functionId],
    severity: "sev2",
    status: "open",
    confidence: 0.85,
    source_refs: [functionId],
    explicitness: "explicit",
    rationale: "Gas City dispatch stayed in dispatched state without a completion callback beyond the stale threshold.",
  })
  return saveIfMissing(db, "specs_incidents", id, {
    _key: id,
    ...incident,
    incidentType: "gascity_dispatch_stale",
    title: `Gas City dispatch stale for ${functionId}`,
    description: `No completion event arrived within ${staleDispatchMinutes} minutes.`,
    openedAt: timestamp,
    dispatch_log_key: dispatchKey,
    bead_id: stringValue(dispatch.gc_bead_id),
  })
}

async function escalateRecurringIncidents(db: AutonomyDb, timestamp: string, threshold: number): Promise<number> {
  const groups = await db.query<{ incidentType: string; functionId: string; count: number; incidentIdsList: string }>(
    `SELECT
       json_extract(json,'$.incidentType') as incidentType,
       COALESCE(json_extract(json,'$.functionIds[0]'), 'FN-GC-DISPATCH-WIRE') as functionId,
       COUNT(*) as count,
       GROUP_CONCAT(json_extract(json,'$.id')) as incidentIdsList
     FROM documents
     WHERE collection='specs_incidents'
       AND json_extract(json,'$.status')='open'
       AND json_extract(json,'$.incidentType') LIKE 'gascity_%'
     GROUP BY json_extract(json,'$.incidentType'), functionId
     HAVING COUNT(*) >= ?`,
    [threshold],
  )
  // Reshape to match expected interface (incidentIdsList → incidentIds array)
  const typedGroups = groups.map(g => ({
    ...g,
    incidentIds: g.incidentIdsList ? g.incidentIdsList.split(',') : [],
  }))
  let created = 0
  for (const group of typedGroups) {
    const id = `PRS-OPS-GC-${(await sha256Hex(`${group.incidentType}|${group.functionId}`)).slice(0, 12).toUpperCase()}`
    const pressure = Pressure.parse({
      id,
      category: "reliability",
      name: `Recurring ${group.incidentType} for ${group.functionId}`,
      description: `${group.count} open Gas City incidents crossed the autonomous escalation threshold.`,
      derivedFromSignalIds: group.incidentIds,
      affectedDomains: ["function-factory", "gas-city"],
      affectedPersonas: ["operator"],
      strength: Math.min(1, 0.4 + group.count / 10),
      urgency: Math.min(1, 0.5 + group.count / 10),
      frequency: Math.min(1, group.count / threshold),
      confidence: 0.85,
      source_refs: group.incidentIds,
      explicitness: "explicit",
      rationale: "Cloudflare autonomy monitor escalated recurring Gas City incidents into an operational Pressure.",
    })
    const saved = await saveIfMissing(db, "specs_pressures", id, {
      _key: id,
      ...pressure,
      createdAt: timestamp,
      incidentType: group.incidentType,
      functionId: group.functionId,
    })
    if (saved) created += 1
  }
  return created
}

async function saveIfMissing(db: AutonomyDb, collection: string, key: string, doc: Record<string, unknown>): Promise<boolean> {
  const existing = await db.get(collection, key)
  if (existing) return false
  try {
    await db.save(collection, doc)
    return true
  } catch (err) {
    if (/409|conflict|unique/i.test(err instanceof Error ? err.message : String(err))) return false
    throw err
  }
}

function functionIdOf(fn: FunctionRecord): string | null {
  return stringValue(fn.id) ?? stringValue(fn.functionId) ?? stringValue(fn._key) ?? null
}

function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "string" && typeof value !== "number") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isFresh(value: string | null, cutoff: Date): boolean {
  if (!value) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= cutoff.getTime()
}

function isoValue(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
