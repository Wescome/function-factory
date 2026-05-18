import type {
  ActiveRunIndex,
  Counterfactual,
  RunErrorClass,
  RunEvent,
  RunEventInput,
  RunEventType,
  RunStage,
  RunStatus,
  RunSummary,
} from "./run-events"

const ACTIVE_INDEX_KEY = "runs/_active-index.json"
const SCHEMA_VERSION = "1.0" as const
const MAX_ACTIVE_INDEX_RETRIES = 5
const ATTEMPT_LOG_PREFIX = "runs/_attempt-logs"

export class RunEventLog {
  constructor(private readonly bucket: R2Bucket) {}

  async emit(input: RunEventInput): Promise<void> {
    try {
      const event = normalizeEvent(input)
      await this.writeEvent(event)
      const summary = await this.updateSummary(event)
      await this.updateAttemptLog(event)
      await this.updateActiveIndex(event, summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[RunEventLog] emit failed run=${input.runId} type=${input.type}: ${message}`)
    }
  }

  async getSummary(runId: string): Promise<RunSummary | null> {
    const obj = await this.bucket.get(summaryKey(runId))
    if (!obj) return null
    try {
      return await obj.json<RunSummary>()
    } catch {
      return null
    }
  }

  async getRecentEvents(runId: string, limit = 20): Promise<RunEvent[]> {
    const listed = await this.bucket.list({ prefix: `runs/${runId}/events/` })
    const keys = listed.objects
      .map((object) => object.key)
      .filter((key) => !key.endsWith("/_summary.json"))
      .sort()
      .slice(-Math.max(1, limit))

    const events: RunEvent[] = []
    for (const key of keys) {
      const obj = await this.bucket.get(key)
      if (!obj) continue
      events.push(await obj.json<RunEvent>())
    }
    return events
  }

  async getLatestAttemptLog(runId: string, stageName: string): Promise<{ key: string; text: string } | null> {
    const key = await this.findLatestAttemptLogKey(
      `${ATTEMPT_LOG_PREFIX}/${safePathPart(runId)}/${safePathPart(stageName)}/`,
    ) ?? await this.findLatestAttemptLogKey(
      `runs/${runId}/logs/${safePathPart(stageName)}/`,
    )
    if (!key) return null
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return { key, text: await obj.text() }
  }

  async getActiveIndex(): Promise<ActiveRunIndex> {
    return (await this.readActiveIndex()).index
  }

  async removeActiveRun(runId: string): Promise<void> {
    const { index, etag } = await this.readActiveIndex()
    await this.writeActiveIndex({
      ...index,
      updatedAt: new Date().toISOString(),
      runs: index.runs.filter((entry) => entry.runId !== runId),
    }, etag)
  }

  private async writeEvent(event: RunEvent): Promise<void> {
    await this.bucket.put(
      eventKey(event),
      JSON.stringify(event, null, 2),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    )
  }

  private async updateSummary(event: RunEvent): Promise<RunSummary> {
    const existing = await this.getSummary(event.runId)
    const summary = buildNextSummary(existing, event)
    await this.bucket.put(
      summaryKey(event.runId),
      JSON.stringify(summary, null, 2),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    )
    return summary
  }

  private async updateAttemptLog(event: RunEvent): Promise<void> {
    if (!event.stageName || !event.attemptNumber) return
    if (!attemptLogEventTypes.has(event.type)) return

    const key = attemptLogKey(event.runId, event.stageName, event.attemptNumber)
    const existing = await this.bucket.get(key)
    let text = existing ? await existing.text() : attemptLogHeader(event)
    text += attemptLogLine(event)
    if (event.type === "stage_completed" || event.type === "stage_failed") {
      text += "===STAGE_RESULT===\n"
      text += JSON.stringify(buildStageResultBlock(event)) + "\n"
    }
    await this.bucket.put(
      key,
      text,
      { httpMetadata: { contentType: "text/plain; charset=utf-8" } },
    )
  }

  private async findLatestAttemptLogKey(prefix: string): Promise<string | undefined> {
    const listed = await this.bucket.list({ prefix })
    return listed.objects
      .map((object) => object.key)
      .filter((candidate) => /\/attempt-\d+\.log$/.test(candidate))
      .sort((a, b) => attemptNumberFromKey(a) - attemptNumberFromKey(b))
      .at(-1)
  }

  private async updateActiveIndex(event: RunEvent, summary: RunSummary): Promise<void> {
    if (event.type === "run_started") {
      await this.writeRunStartedActiveIndex(event, summary)
      return
    }

    if (isTerminalEvent(event.type)) {
      await this.removeActiveRun(event.runId)
      return
    }

    const { index, etag } = await this.readActiveIndex()
    if (!index.runs.some((entry) => entry.runId === event.runId)) return
    await this.writeActiveIndex({
      ...index,
      updatedAt: event.timestamp,
      runs: index.runs.map((entry) =>
        entry.runId === event.runId
          ? {
              runId: entry.runId,
              lastEventAt: summary.lastEventAt,
              ...(summary.currentStage ? { currentStage: summary.currentStage } : {}),
            }
          : entry,
      ),
    }, etag)
  }

  private async writeRunStartedActiveIndex(event: RunEvent, summary: RunSummary): Promise<void> {
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ACTIVE_INDEX_RETRIES; attempt += 1) {
      try {
        const { index, etag } = await this.readActiveIndex()
        const nextRuns = index.runs.filter((entry) => entry.runId !== event.runId)
        nextRuns.push({
          runId: event.runId,
          lastEventAt: summary.lastEventAt,
          ...(summary.currentStage ? { currentStage: summary.currentStage } : {}),
        })
        await this.writeActiveIndex({ ...index, updatedAt: event.timestamp, runs: nextRuns }, etag)
        return
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`active index update failed after ${MAX_ACTIVE_INDEX_RETRIES} attempts`)
  }

  private async readActiveIndex(): Promise<{ index: ActiveRunIndex; etag?: string }> {
    const obj = await this.bucket.get(ACTIVE_INDEX_KEY)
    if (!obj) return { index: emptyActiveIndex() }
    try {
      return { index: normalizeActiveIndex(await obj.json<ActiveRunIndex>()), etag: obj.etag }
    } catch {
      return { index: emptyActiveIndex(), etag: obj.etag }
    }
  }

  private async writeActiveIndex(index: ActiveRunIndex, etag?: string): Promise<void> {
    await this.bucket.put(
      ACTIVE_INDEX_KEY,
      JSON.stringify(normalizeActiveIndex(index), null, 2),
      {
        ...(etag ? { onlyIf: { etagMatches: etag } } : { onlyIf: { etagDoesNotMatch: "*" } }),
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      },
    )
  }
}

export function createRunEventLog(env: { WORKSPACE_BUCKET?: R2Bucket | unknown }): RunEventLog | null {
  const bucket = env.WORKSPACE_BUCKET as Partial<R2Bucket> | undefined
  if (!bucket || typeof bucket.get !== "function" || typeof bucket.put !== "function" || typeof bucket.list !== "function") {
    return null
  }
  return new RunEventLog(bucket as R2Bucket)
}

export async function emitRunEvent(
  env: { WORKSPACE_BUCKET?: R2Bucket | unknown },
  input: RunEventInput,
): Promise<void> {
  const log = createRunEventLog(env)
  if (!log) return
  await log.emit(input)
}

export function classifyRunErrorClass(value: unknown): RunErrorClass | undefined {
  if (value === "infrastructure_error" || value === "step_error" || value === "gate_abort" || value === "dlq_exhausted" || value === "watchdog_stuck") {
    return value
  }
  return undefined
}

function normalizeEvent(input: RunEventInput): RunEvent {
  const timestamp = input.timestamp ?? new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: input.eventId ?? makeEventId(timestamp),
    timestamp,
    runId: input.runId,
    type: input.type,
    emitter: input.emitter,
    data: input.data ?? {},
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    ...(input.stageName ? { stageName: input.stageName } : {}),
    ...(input.attemptNumber ? { attemptNumber: input.attemptNumber } : {}),
    ...(input.error ? { error: truncateError(input.error) } : {}),
  }
}

function makeEventId(timestamp: string): string {
  const millis = Date.parse(timestamp)
  const prefix = Number.isFinite(millis) ? millis.toString(36).padStart(9, "0") : Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0")
  return `${prefix}-${random}`
}

function eventKey(event: RunEvent): string {
  return `runs/${event.runId}/events/${event.timestamp}-${event.eventId}.json`
}

function summaryKey(runId: string): string {
  return `runs/${runId}/events/_summary.json`
}

function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function attemptLogKey(runId: string, stageName: string, attemptNumber: number): string {
  return `${ATTEMPT_LOG_PREFIX}/${safePathPart(runId)}/${safePathPart(stageName)}/attempt-${attemptNumber}.log`
}

function attemptLogHeader(event: RunEvent): string {
  return `=== STAGE: ${event.stageName}  ATTEMPT: ${event.attemptNumber}  STARTED: ${event.timestamp} ===\n`
}

function attemptLogLine(event: RunEvent): string {
  return JSON.stringify({
    ts: event.timestamp,
    type: event.type,
    emitter: event.emitter,
    data: event.data,
    ...(event.error ? { error: event.error } : {}),
  }) + "\n"
}

function buildStageResultBlock(event: RunEvent): Record<string, unknown> {
  const status = event.data.status === "pass" ? "pass" : "fail"
  return {
    stage: event.stageName,
    status,
    failureClass: event.data.failureClass ?? (status === "pass" ? undefined : event.error ? "step_error" : "gate_abort"),
    reason: event.data.reason ?? event.error?.message ?? event.data.message ?? "",
    artifacts: Array.isArray(event.data.artifacts) ? event.data.artifacts : [],
  }
}

function attemptNumberFromKey(key: string): number {
  const match = key.match(/attempt-(\d+)\.log$/)
  return match ? Number(match[1]) : 0
}

const attemptLogEventTypes = new Set<RunEventType>([
  "stage_started",
  "worker_executed",
  "gate_evaluated",
  "stage_completed",
  "stage_failed",
])

function buildNextSummary(existing: RunSummary | null, event: RunEvent): RunSummary {
  const startedAt = existing?.startedAt ?? event.timestamp
  const previousTerminal = existing ? terminalStatus(existing.status) : false
  const currentPhase = previousTerminal ? (existing?.currentPhase ?? phaseForEvent(event)) : phaseForEvent(event)
  const base: RunSummary = existing ?? {
    schemaVersion: SCHEMA_VERSION,
    runId: event.runId,
    slug: slugFromRunId(event.runId),
    status: "running",
    lastEventType: event.type,
    lastEventAt: event.timestamp,
    stageHistory: [],
    stepAccounting: { ok: [], failed: [], neverDispatched: [] },
    startedAt,
    eventCount: 0,
  }

  const status = statusForEvent(event, base.status)
  const stageHistory = updateStageHistory(base.stageHistory, event, currentPhase)
  const stepAccounting = updateStepAccounting(base.stepAccounting, event)
  const verificationResults = updateVerificationResults(base.verificationResults, event)
  const counterfactuals = updateCounterfactuals(base.counterfactuals, event)
  const watchdogThresholdsMs = updateWatchdogThresholds(base.watchdogThresholdsMs, event)
  const errorClass = errorClassForEvent(event) ?? base.errorClass
  const lastError = event.error
    ? { ...(event.error.code ? { code: event.error.code } : {}), message: event.error.message }
    : base.lastError

  return {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    status,
    currentPhase,
    lastEventType: event.type,
    lastEventAt: event.timestamp,
    ...(event.workflowId ?? base.workflowId ? { workflowId: event.workflowId ?? base.workflowId } : {}),
    ...(terminalStatus(status)
      ? base.currentStage ? { currentStage: base.currentStage } : {}
      : event.stageName ?? base.currentStage ? { currentStage: event.stageName ?? base.currentStage } : {}),
    ...(lastError ? { lastError } : {}),
    stageHistory,
    stepAccounting,
    ...(verificationResults ? { verificationResults } : {}),
    ...(errorClass ? { errorClass } : {}),
    ...(counterfactuals.length > 0 ? { counterfactuals } : {}),
    ...(watchdogThresholdsMs ? { watchdogThresholdsMs } : {}),
    startedAt,
    ...(terminalStatus(status) ? { terminalAt: base.terminalAt ?? event.timestamp } : base.terminalAt ? { terminalAt: base.terminalAt } : {}),
    eventCount: base.eventCount + 1,
  }
}

function phaseForEvent(event: RunEvent): RunStage {
  if (event.type === "run_started") return "intent"
  if (event.type === "harness_loaded" || event.type === "run_coordinator_initialized") return "plan"
  if (event.type === "coherence_verified" || event.type === "fidelity_verified" || event.type === "persistence_verified" || event.type === "gate_evaluated") return "eval"
  if (event.type === "counterfactual_recorded" || event.type === "harness_complete" || event.type === "workflow_notified" || event.type === "workflow_notify_failed") return "report"
  return "execution"
}

function statusForEvent(event: RunEvent, previous: RunStatus): RunStatus {
  if (event.type === "dlq_recovered") return "dlq_recovered"
  if (event.type === "stuck_detected") return "stuck"
  if (event.type === "harness_complete") return event.data.overall === "pass" ? "completed" : "failed"
  if (event.type === "coherence_verified" && event.data.status === "blocked") return "coherence_blocked"
  if (event.type === "fidelity_verified" && event.data.status === "blocked") return "fidelity_blocked"
  if (event.type === "persistence_verified" && event.data.status === "blocked") return "persistence_blocked"
  if (event.type === "stage_failed" && event.data.action === "fail") return "failed"
  if (terminalStatus(previous)) return previous
  return "running"
}

function terminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "stuck" || status === "dlq_recovered"
}

function updateStageHistory(
  existing: RunSummary["stageHistory"],
  event: RunEvent,
  phase: RunStage,
): RunSummary["stageHistory"] {
  if (!event.stageName) return existing
  if (event.type !== "stage_started" && event.type !== "stage_completed" && event.type !== "stage_failed") return existing

  const verdict = event.type === "stage_started"
    ? "in_progress"
    : event.type === "stage_completed"
      ? "pass"
      : "fail"
  // attempts = max(attemptNumber) seen for this stage — monotonically increases through retries
  const attempts = event.attemptNumber ?? 1
  const without = existing.filter((entry) => entry.stage !== event.stageName || entry.verdict !== "in_progress")
  return [
    ...without,
    {
      stage: event.stageName,
      phase,
      verdict,
      attempts,
      at: event.timestamp,
    },
  ]
}

function updateStepAccounting(
  existing: RunSummary["stepAccounting"] | undefined,
  event: RunEvent,
): NonNullable<RunSummary["stepAccounting"]> {
  const next = existing ?? { ok: [], failed: [], neverDispatched: [] }
  if (!event.stageName) return next
  if (event.type === "stage_completed") {
    return {
      ok: unique([...next.ok, event.stageName]),
      failed: next.failed.filter((name) => name !== event.stageName),
      neverDispatched: next.neverDispatched.filter((name) => name !== event.stageName),
    }
  }
  if (event.type === "stage_failed") {
    return {
      ok: next.ok.filter((name) => name !== event.stageName),
      failed: unique([...next.failed, event.stageName]),
      neverDispatched: next.neverDispatched.filter((name) => name !== event.stageName),
    }
  }
  return next
}

function updateVerificationResults(
  existing: RunSummary["verificationResults"] | undefined,
  event: RunEvent,
): RunSummary["verificationResults"] | undefined {
  const map = {
    coherence_verified: "coherence",
    fidelity_verified: "fidelity",
    persistence_verified: "persistence",
  } as const
  const key = map[event.type as keyof typeof map]
  if (!key) return existing
  const rawStatus = event.data.status
  const status = rawStatus === "blocked" || rawStatus === "warn" ? rawStatus : "pass"
  return {
    ...(existing ?? {}),
    [key]: { status, at: event.timestamp },
  }
}

function updateCounterfactuals(
  existing: Counterfactual[] | undefined,
  event: RunEvent,
): Counterfactual[] {
  const current = existing ?? []
  if (event.type !== "counterfactual_recorded") return current
  const entry = event.data.counterfactual
  if (!entry || typeof entry !== "object") return current
  const candidate = entry as Partial<Counterfactual>
  if (!candidate.class || !candidate.what || !candidate.why) return current
  return [
    ...current,
    {
      class: candidate.class,
      what: candidate.what,
      why: candidate.why,
      at: candidate.at ?? event.timestamp,
    },
  ]
}

function updateWatchdogThresholds(
  existing: Record<string, number> | undefined,
  event: RunEvent,
): Record<string, number> | undefined {
  if (event.type !== "harness_loaded") return existing
  const thresholds = event.data.watchdogThresholdsMs
  if (!thresholds || typeof thresholds !== "object" || Array.isArray(thresholds)) return existing
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(thresholds as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = value
    }
  }
  return Object.keys(out).length > 0 ? out : existing
}

function errorClassForEvent(event: RunEvent): RunErrorClass | undefined {
  if (event.type === "dlq_recovered") return "dlq_exhausted"
  if (event.type === "stuck_detected") return "watchdog_stuck"
  const explicit = classifyRunErrorClass(event.data.failureClass)
  if (explicit) return explicit
  if (event.type === "stage_failed") return event.error ? "step_error" : "gate_abort"
  if (event.type === "workflow_notify_failed" || event.type === "container_crashed") return "infrastructure_error"
  return undefined
}

function isTerminalEvent(type: RunEventType): boolean {
  return type === "harness_complete" || type === "dlq_recovered" || type === "stuck_detected"
}

function slugFromRunId(runId: string): string {
  return runId
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

function truncateError(error: NonNullable<RunEventInput["error"]>): NonNullable<RunEvent["error"]> {
  return {
    ...(error.code ? { code: error.code } : {}),
    message: error.message.slice(0, 4096),
    ...(error.stack ? { stack: error.stack.slice(0, 2048) } : {}),
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function emptyActiveIndex(): ActiveRunIndex {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), runs: [] }
}

function normalizeActiveIndex(input: ActiveRunIndex): ActiveRunIndex {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
    runs: Array.isArray(input.runs)
      ? input.runs
        .filter((entry) => entry && typeof entry.runId === "string" && typeof entry.lastEventAt === "string")
        .map((entry) => ({
          runId: entry.runId,
          lastEventAt: entry.lastEventAt,
          ...(entry.currentStage ? { currentStage: entry.currentStage } : {}),
        }))
      : [],
  }
}
