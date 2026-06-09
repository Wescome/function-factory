import type {
  ActiveRunIndex,
  Counterfactual,
  RunArtifactManifest,
  RunMonitorSnapshot,
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
const MAX_SUMMARY_RETRIES = 5
const ATTEMPT_LOG_PREFIX = "runs/_attempt-logs"
const PHASE_KEYS = {
  intent: "00_intent/intent.json",
  plan: "01_plan/harness.json",
  execution: "02_execution/execution.json",
  traces: "03_traces/trace-index.json",
  eval: "04_eval/eval.json",
  report: "05_report/report.json",
} as const

export class RunEventLog {
  constructor(private readonly bucket: R2Bucket) {}

  async emit(input: RunEventInput): Promise<void> {
    try {
      const event = normalizeEvent(input)
      await this.writeEvent(event)
      const summary = await this.updateSummary(event)
      await this.updateAttemptLog(event)
      await this.updateManifest(event, summary)
      await this.updateActiveIndex(event, summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[RunEventLog] emit failed run=${input.runId} type=${input.type}: ${message}`)
    }
  }

  async getSummary(runId: string): Promise<RunSummary | null> {
    const replayed = await this.replaySummary(runId)
    if (replayed) return replayed
    const obj = await this.bucket.get(summaryKey(runId))
    if (!obj) return null
    try {
      return await obj.json<RunSummary>()
    } catch {
      return null
    }
  }

  async getRecentEvents(runId: string, limit = 20): Promise<RunEvent[]> {
    return (await this.getEvents(runId)).slice(-Math.max(1, limit))
  }

  async getEvents(runId: string): Promise<RunEvent[]> {
    const listed = await this.bucket.list({ prefix: `runs/${runId}/events/` })
    const keys = listed.objects
      .map((object) => object.key)
      .filter((key) => !key.endsWith("/_summary.json"))
      .sort()

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

  async getManifest(runId: string): Promise<RunArtifactManifest | null> {
    const replayed = await this.replayManifest(runId)
    if (replayed) return replayed
    const obj = await this.bucket.get(manifestKey(runId))
    if (!obj) return null
    try {
      return await obj.json<RunArtifactManifest>()
    } catch {
      return null
    }
  }

  async getMonitorSnapshot(runId: string, limit = 50): Promise<RunMonitorSnapshot | null> {
    const summary = await this.getSummary(runId)
    if (!summary) return null
    const manifest = await this.getManifest(runId)
    const events = await this.getRecentEvents(runId, limit)
    return {
      schemaVersion: SCHEMA_VERSION,
      runId,
      status: summary.status,
      ...(summary.currentPhase ? { currentPhase: summary.currentPhase } : {}),
      ...(summary.currentStage ? { currentStage: summary.currentStage } : {}),
      summary,
      ...(manifest ? { manifest } : {}),
      stages: manifest?.stages ?? stagesFromSummary(summary),
      timeline: events.map((event) => ({
        at: event.timestamp,
        type: event.type,
        emitter: event.emitter,
        ...(event.stageName ? { stageName: event.stageName } : {}),
        ...(event.attemptNumber ? { attemptNumber: event.attemptNumber } : {}),
        ...(typeof event.data.message === "string" ? { message: event.data.message } : {}),
        ...(event.error?.message ? { error: event.error.message } : {}),
      })),
      interventions: events
        .filter(isInterventionEvent)
        .map((event) => ({
          at: event.timestamp,
          type: event.type,
          ...(typeof event.data.operator === "string" ? { operator: event.data.operator } : {}),
          ...(event.stageName ? { stageName: event.stageName } : {}),
          ...(typeof event.data.message === "string" ? { message: event.data.message } : {}),
          ...(typeof event.data.effect === "string" ? { effect: event.data.effect } : {}),
        })),
      diagnostics: {
        observations: manifest?.diagnostics.observations ?? [],
        contractEvaluations: manifest?.diagnostics.contractEvaluations ?? [],
        ...(manifest?.diagnostics.attemptLogsPrefix ? { attemptLogsPrefix: manifest.diagnostics.attemptLogsPrefix } : {}),
        ...monitorInfrastructureFailures(events),
      },
      artifacts: manifest?.artifacts ?? [],
      updatedAt: manifest?.updatedAt ?? summary.lastEventAt,
    }
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
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_SUMMARY_RETRIES; attempt += 1) {
      const { summary: existing, etag } = await this.readSummary(event.runId)
      const summary = buildNextSummary(existing, event)
      try {
        await this.writeSummary(event.runId, summary, etag)
        return summary
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`summary update failed after ${MAX_SUMMARY_RETRIES} attempts`)
  }

  private async updateAttemptLog(event: RunEvent): Promise<void> {
    if (!event.stageName || !event.attemptNumber) return
    if (!attemptLogEventTypes.has(event.type)) return

    const key = attemptLogKey(event.runId, event.stageName, event.attemptNumber)
    const existing = await this.bucket.get(key)
    let text = existing ? await existing.text() : attemptLogHeader(event)
    text += attemptLogLine(event)
    if (
      event.type === "stage_completed" ||
      event.type === "stage_failed" ||
      event.type === "container_execute_timed_out" ||
      event.type === "container_crashed"
    ) {
      text += "===STAGE_RESULT===\n"
      text += JSON.stringify(buildStageResultBlock(event)) + "\n"
    }
    await this.bucket.put(
      key,
      text,
      { httpMetadata: { contentType: "text/plain; charset=utf-8" } },
    )
  }

  private async updateManifest(event: RunEvent, summary: RunSummary): Promise<void> {
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_SUMMARY_RETRIES; attempt += 1) {
      const { manifest: existing, etag } = await this.readManifest(event.runId)
      const manifest = buildNextManifest(existing, event, summary)
      try {
        await this.writePhaseArtifacts(event, summary, manifest)
        await this.writeManifest(event.runId, manifest, etag)
        return
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`manifest update failed after ${MAX_SUMMARY_RETRIES} attempts`)
  }

  private async writePhaseArtifacts(
    event: RunEvent,
    summary: RunSummary,
    manifest: RunArtifactManifest,
  ): Promise<void> {
    const postTerminalExecutionEvent = terminalStatus(summary.status)
      && summary.terminalAt !== event.timestamp
      && isExecutionProjectionEvent(event)
    const writes: Array<{ key: string; value: unknown }> = [
      {
        key: phaseKey(event.runId, "traces"),
        value: {
          schemaVersion: SCHEMA_VERSION,
          runId: event.runId,
          eventPrefix: `runs/${event.runId}/events/`,
          summaryKey: summaryKey(event.runId),
          latestEvent: event,
          updatedAt: event.timestamp,
        },
      },
    ]

    if (event.type === "run_started") {
      writes.push({
        key: phaseKey(event.runId, "intent"),
        value: {
          schemaVersion: SCHEMA_VERSION,
          runId: event.runId,
          workflowId: event.workflowId,
          harnessKey: typeof event.data.harnessKey === "string" ? event.data.harnessKey : undefined,
          objectiveBytes: typeof event.data.objectiveBytes === "number" ? event.data.objectiveBytes : undefined,
          eventKey: eventKey(event),
          at: event.timestamp,
        },
      })
    }

    if (event.type === "harness_loaded") {
      writes.push({
        key: phaseKey(event.runId, "plan"),
        value: {
          schemaVersion: SCHEMA_VERSION,
          runId: event.runId,
          workflowId: event.workflowId ?? summary.workflowId,
          harness: manifest.harness,
          eventKey: eventKey(event),
          at: event.timestamp,
        },
      })
    }

    if (event.stageName && (
      event.type === "stage_started" ||
      event.type === "container_dispatch_retried" ||
      event.type === "container_dispatch_recovered" ||
      event.type === "worker_executed" ||
      event.type === "container_execute_timed_out" ||
      event.type === "container_crashed" ||
      event.type === "stage_completed" ||
      event.type === "stage_failed"
    ) && !postTerminalExecutionEvent) {
      const stage = manifest.stages.find((entry) => entry.name === event.stageName)
      writes.push({
        key: phaseKey(event.runId, "execution"),
        value: {
          schemaVersion: SCHEMA_VERSION,
          runId: event.runId,
          stages: manifest.stages,
          updatedBy: event.type,
          updatedStage: stage,
          at: event.timestamp,
        },
      })
    }

    if ((event.type === "gate_evaluated" || event.type === "coherence_verified" || event.type === "fidelity_verified" || event.type === "persistence_verified") && !postTerminalExecutionEvent) {
      writes.push({
        key: phaseKey(event.runId, "eval"),
        value: {
          schemaVersion: SCHEMA_VERSION,
          runId: event.runId,
          stageName: event.stageName,
          verificationResults: summary.verificationResults,
          gateResults: Array.isArray(event.data.results) ? event.data.results : undefined,
          allPassed: event.data.allPassed,
          eventKey: eventKey(event),
          at: event.timestamp,
        },
      })
    }

    if (terminalStatus(summary.status) && !postTerminalExecutionEvent) {
      writes.push({
        key: phaseKey(event.runId, "report"),
        value: {
          schemaVersion: SCHEMA_VERSION,
          runId: event.runId,
          summary,
          manifestKey: manifestKey(event.runId),
          at: event.timestamp,
        },
      })
    }

    for (const write of writes) {
      await this.bucket.put(
        write.key,
        JSON.stringify(dropUndefined(write.value), null, 2),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
      )
    }
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

  private async readSummary(runId: string): Promise<{ summary: RunSummary | null; etag?: string }> {
    const obj = await this.bucket.get(summaryKey(runId))
    if (!obj) return { summary: null }
    try {
      return { summary: await obj.json<RunSummary>(), etag: obj.etag }
    } catch {
      return { summary: null, etag: obj.etag }
    }
  }

  private async writeSummary(runId: string, summary: RunSummary, etag?: string): Promise<void> {
    await this.bucket.put(
      summaryKey(runId),
      JSON.stringify(summary, null, 2),
      {
        ...(etag ? { onlyIf: { etagMatches: etag } } : { onlyIf: { etagDoesNotMatch: "*" } }),
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      },
    )
  }

  private async readManifest(runId: string): Promise<{ manifest: RunArtifactManifest | null; etag?: string }> {
    const obj = await this.bucket.get(manifestKey(runId))
    if (!obj) return { manifest: null }
    try {
      return { manifest: await obj.json<RunArtifactManifest>(), etag: obj.etag }
    } catch {
      return { manifest: null, etag: obj.etag }
    }
  }

  private async writeManifest(runId: string, manifest: RunArtifactManifest, etag?: string): Promise<void> {
    await this.bucket.put(
      manifestKey(runId),
      JSON.stringify(manifest, null, 2),
      {
        ...(etag ? { onlyIf: { etagMatches: etag } } : { onlyIf: { etagDoesNotMatch: "*" } }),
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      },
    )
  }

  private async replaySummary(runId: string): Promise<RunSummary | null> {
    const events = await this.getEvents(runId)
    if (events.length === 0) return null
    return events.reduce<RunSummary | null>((summary, event) => buildNextSummary(summary, event), null)
  }

  private async replayManifest(runId: string): Promise<RunArtifactManifest | null> {
    const events = await this.getEvents(runId)
    let summary: RunSummary | null = null
    let manifest: RunArtifactManifest | null = null
    for (const event of events) {
      summary = buildNextSummary(summary, event)
      manifest = buildNextManifest(manifest, event, summary)
    }
    return manifest
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
  if (value === "infrastructure_error" || value === "step_error" || value === "gate_abort" || value === "dlq_exhausted" || value === "watchdog_stuck" || value === "operator_cancelled") {
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

function manifestKey(runId: string): string {
  return `runs/${runId}/manifest.json`
}

function phaseKey(runId: string, phase: keyof typeof PHASE_KEYS): string {
  return `runs/${runId}/${PHASE_KEYS[phase]}`
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

function monitorInfrastructureFailures(events: RunEvent[]): Pick<RunMonitorSnapshot["diagnostics"], "infrastructureFailures"> {
  const infrastructureFailures = events
    .filter((event): event is RunEvent & { type: "container_crashed" | "container_execute_timed_out" } =>
      event.type === "container_crashed" || event.type === "container_execute_timed_out",
    )
    .map((event) => ({
      at: event.timestamp,
      type: event.type,
      ...(event.stageName ? { stageName: event.stageName } : {}),
      ...(event.attemptNumber ? { attemptNumber: event.attemptNumber } : {}),
      message: event.error?.message ?? (typeof event.data.message === "string" ? event.data.message : event.type),
    }))
  return infrastructureFailures.length > 0 ? { infrastructureFailures } : {}
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

function buildNextManifest(
  existing: RunArtifactManifest | null,
  event: RunEvent,
  summary: RunSummary,
): RunArtifactManifest {
  const base = existing ?? emptyManifest(event, summary)
  if (terminalStatus(base.status ?? "running") && isExecutionProjectionEvent(event)) {
    return base
  }
  const workflowId = event.workflowId ?? summary.workflowId ?? base.workflowId
  const harness = updateManifestHarness(base.harness, event)
  const manifest: RunArtifactManifest = {
    ...base,
    ...(workflowId ? { workflowId } : {}),
    status: summary.status,
    updatedAt: event.timestamp,
    ...(summary.terminalAt ? { terminalAt: summary.terminalAt } : base.terminalAt ? { terminalAt: base.terminalAt } : {}),
    ...(harness ? { harness } : {}),
    phases: updateManifestPhases(base.phases, event, summary),
    stages: updateManifestStages(base.stages, event),
    artifacts: mergeManifestArtifacts(base.artifacts, event),
    diagnostics: updateManifestDiagnostics(base.diagnostics, event),
  }
  return manifest
}

function emptyManifest(event: RunEvent, summary: RunSummary): RunArtifactManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: event.runId,
    rootKey: `runs/${event.runId}/`,
    summaryKey: summaryKey(event.runId),
    eventPrefix: `runs/${event.runId}/events/`,
    attemptLogPrefix: `${ATTEMPT_LOG_PREFIX}/${safePathPart(event.runId)}/`,
    createdAt: summary.startedAt,
    updatedAt: event.timestamp,
    ...(event.workflowId ?? summary.workflowId ? { workflowId: event.workflowId ?? summary.workflowId } : {}),
    status: summary.status,
    phases: {},
    stages: [],
    artifacts: [],
    diagnostics: {
      observations: [],
      contractEvaluations: [],
      attemptLogsPrefix: `${ATTEMPT_LOG_PREFIX}/${safePathPart(event.runId)}/`,
    },
    ...(summary.terminalAt ? { terminalAt: summary.terminalAt } : {}),
  }
}

function updateManifestHarness(
  existing: RunArtifactManifest["harness"] | undefined,
  event: RunEvent,
): RunArtifactManifest["harness"] | undefined {
  const harness = { ...(existing ?? {}) }
  if (event.type === "run_started" && typeof event.data.harnessKey === "string") {
    harness.key = event.data.harnessKey
  }
  if (event.type === "harness_loaded") {
    if (typeof event.data.harnessKey === "string") harness.key = event.data.harnessKey
    if (typeof event.data.harnessName === "string") harness.name = event.data.harnessName
    if (Array.isArray(event.data.executionNodes)) {
      harness.executionNodes = event.data.executionNodes.filter((node): node is string => typeof node === "string")
    }
    if (Array.isArray(event.data.workerNames)) {
      harness.workerNames = event.data.workerNames.filter((name): name is string => typeof name === "string")
    }
    const thresholds = normalizeNumberMap(event.data.watchdogThresholdsMs)
    if (thresholds) harness.watchdogThresholdsMs = thresholds
  }
  return Object.keys(harness).length > 0 ? harness : existing
}

function updateManifestPhases(
  existing: RunArtifactManifest["phases"],
  event: RunEvent,
  summary: RunSummary,
): RunArtifactManifest["phases"] {
  const phases = { ...existing }
  phases.traces = { key: phaseKey(event.runId, "traces"), updatedAt: event.timestamp }

  if (event.type === "run_started") {
    phases.intent = { key: phaseKey(event.runId, "intent"), updatedAt: event.timestamp }
  }
  if (event.type === "harness_loaded") {
    phases.plan = { key: phaseKey(event.runId, "plan"), updatedAt: event.timestamp }
  }
  if (event.stageName && (
    event.type === "stage_started" ||
    event.type === "container_dispatch_retried" ||
    event.type === "container_dispatch_recovered" ||
    event.type === "worker_executed" ||
    event.type === "container_execute_timed_out" ||
    event.type === "container_crashed" ||
    event.type === "stage_completed" ||
    event.type === "stage_failed"
  )) {
    phases.execution = { key: phaseKey(event.runId, "execution"), updatedAt: event.timestamp }
  }
  if (event.type === "gate_evaluated" || event.type === "coherence_verified" || event.type === "fidelity_verified" || event.type === "persistence_verified") {
    phases.eval = { key: phaseKey(event.runId, "eval"), updatedAt: event.timestamp }
  }
  if (terminalStatus(summary.status)) {
    phases.report = { key: phaseKey(event.runId, "report"), updatedAt: event.timestamp }
  }
  return phases
}

function updateManifestStages(
  existing: RunArtifactManifest["stages"],
  event: RunEvent,
): RunArtifactManifest["stages"] {
  const stageName = event.stageName ?? (
    event.type === "harness_complete" && typeof event.data.finalExecutionNode === "string"
      ? event.data.finalExecutionNode
      : undefined
  )
  if (!stageName) return existing
  if (!stageManifestEventTypes.has(event.type)) return existing
  const current = existing.find((stage) => stage.name === stageName) ?? {
    name: stageName,
    attempts: 0,
  }
  const next: RunArtifactManifest["stages"][number] = { ...current }
  if (event.attemptNumber) next.attempts = Math.max(next.attempts, event.attemptNumber)
  if (event.type === "stage_started") {
    if ((current.status === "pass" || current.status === "fail") && (event.attemptNumber ?? 1) <= current.attempts) {
      return existing
    }
    next.status = "running"
    next.startedAt = next.startedAt ?? event.timestamp
    if (typeof event.data.worker === "string") next.worker = event.data.worker
    if (typeof event.data.role === "string") next.role = event.data.role
    if (Array.isArray(event.data.declaredInputs)) next.declaredInputs = stringArray(event.data.declaredInputs)
    if (Array.isArray(event.data.declaredOutputs)) next.declaredOutputs = stringArray(event.data.declaredOutputs)
  }
  if (event.type === "worker_executed") {
    if (typeof event.data.elapsedMs === "number") next.elapsedMs = event.data.elapsedMs
    next.artifacts = unique([...(next.artifacts ?? []), ...stringArray(event.data.artifacts)])
    const extracted = extractDiagnosticKeys(event)
    next.observationKeys = unique([...(next.observationKeys ?? []), ...extracted.observations])
    next.contractEvaluationKeys = unique([...(next.contractEvaluationKeys ?? []), ...extracted.contractEvaluations])
    if (typeof event.data.reason === "string") next.reason = event.data.reason
  }
  if (event.type === "container_dispatch_retried" || event.type === "container_dispatch_recovered") {
    next.containerDispatchRetries = [
      ...(next.containerDispatchRetries ?? []),
      {
        status: event.type === "container_dispatch_recovered" ? "recovered" : "retry_scheduled",
        attempt: typeof event.data.attempt === "number" ? event.data.attempt : 0,
        maxAttempts: typeof event.data.maxAttempts === "number" ? event.data.maxAttempts : 0,
        ...(typeof event.data.delayMs === "number" ? { delayMs: event.data.delayMs } : {}),
        ...(typeof event.data.reason === "string" ? { reason: event.data.reason } : {}),
        at: event.timestamp,
      },
    ]
  }
  if (event.type === "gate_evaluated" && Array.isArray(event.data.results)) {
    next.gateResults = event.data.results.filter((result): result is Record<string, unknown> =>
      Boolean(result && typeof result === "object" && !Array.isArray(result)),
    )
  }
  if (event.type === "stage_completed" || event.type === "stage_failed") {
    next.status = event.type === "stage_completed" ? "pass" : "fail"
    next.completedAt = event.timestamp
    next.artifacts = unique([...(next.artifacts ?? []), ...stringArray(event.data.artifacts)])
    const extracted = extractDiagnosticKeys(event)
    next.observationKeys = unique([...(next.observationKeys ?? []), ...extracted.observations])
    next.contractEvaluationKeys = unique([...(next.contractEvaluationKeys ?? []), ...extracted.contractEvaluations])
    if (typeof event.data.reason === "string") next.reason = event.data.reason
  }
  if (event.type === "container_execute_timed_out" || event.type === "container_crashed") {
    next.status = "fail"
    next.completedAt = event.timestamp
    const extracted = extractDiagnosticKeys(event)
    next.observationKeys = unique([...(next.observationKeys ?? []), ...extracted.observations])
    next.contractEvaluationKeys = unique([...(next.contractEvaluationKeys ?? []), ...extracted.contractEvaluations])
    next.reason = event.error?.message
      ?? (typeof event.data.message === "string" ? event.data.message : undefined)
      ?? (event.type === "container_execute_timed_out" ? "pi container execute timed out" : "pi container crashed")
  }
  if (event.type === "harness_complete") {
    next.status = event.data.overall === "pass" ? "pass" : "fail"
    next.completedAt = event.timestamp
    if (typeof event.data.reason === "string") next.reason = event.data.reason
  }

  return [...existing.filter((stage) => stage.name !== stageName), next]
}

const stageManifestEventTypes = new Set<RunEventType>([
  "stage_started",
  "container_dispatch_retried",
  "container_dispatch_recovered",
  "worker_executed",
  "gate_evaluated",
  "container_execute_timed_out",
  "container_crashed",
  "stage_completed",
  "stage_failed",
  "harness_complete",
])

function mergeManifestArtifacts(
  existing: RunArtifactManifest["artifacts"],
  event: RunEvent,
): RunArtifactManifest["artifacts"] {
  const byName = new Map(existing.map((artifact) => [artifact.name, artifact]))
  for (const name of stringArray(event.data.artifacts)) {
    if (!name || name.startsWith("__observability/")) continue
    byName.set(name, {
      ...(byName.get(name) ?? {}),
      name,
      key: `runs/${event.runId}/artifacts/${name}`,
      ...(event.stageName ? { stage: event.stageName } : {}),
      producedAt: event.timestamp,
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function updateManifestDiagnostics(
  existing: RunArtifactManifest["diagnostics"],
  event: RunEvent,
): RunArtifactManifest["diagnostics"] {
  const extracted = extractDiagnosticKeys(event)
  return {
    attemptLogsPrefix: existing.attemptLogsPrefix,
    observations: unique([...existing.observations, ...extracted.observations]),
    contractEvaluations: unique([...existing.contractEvaluations, ...extracted.contractEvaluations]),
  }
}

function extractDiagnosticKeys(event: RunEvent): { observations: string[]; contractEvaluations: string[] } {
  const out = { observations: [] as string[], contractEvaluations: [] as string[] }
  for (const key of ["observationKey", "contractEvaluationKey"]) {
    const value = event.data[key]
    if (typeof value === "string") {
      if (key === "observationKey") out.observations.push(value)
      if (key === "contractEvaluationKey") out.contractEvaluations.push(value)
    }
  }
  for (const text of diagnosticReferenceTexts(event)) {
    const observation = text.match(/\bobservation=(runs\/\S+)/)?.[1]
    const contractEvaluation = text.match(/\bcontractEvaluation=(runs\/\S+)/)?.[1]
    if (observation) out.observations.push(observation)
    if (contractEvaluation) out.contractEvaluations.push(contractEvaluation)
  }
  return out
}

function diagnosticReferenceTexts(event: RunEvent): string[] {
  return [
    event.data.message,
    event.data.reason,
    event.error?.message,
  ].filter((value): value is string => typeof value === "string")
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function normalizeNumberMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) out[key] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function dropUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function attemptNumberFromKey(key: string): number {
  const match = key.match(/attempt-(\d+)\.log$/)
  return match ? Number(match[1]) : 0
}

const attemptLogEventTypes = new Set<RunEventType>([
  "stage_started",
  "container_dispatch_retried",
  "container_dispatch_recovered",
  "worker_executed",
  "gate_evaluated",
  "container_execute_timed_out",
  "container_crashed",
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

  if (previousTerminal && isExecutionProjectionEvent(event)) {
    return {
      ...base,
      eventCount: base.eventCount + 1,
    }
  }

  const status = statusForEvent(event, base.status)
  const stageHistory = updateStageHistory(base.stageHistory, event, currentPhase)
  const stepAccounting = updateStepAccounting(base.stepAccounting, event)
  const verificationResults = updateVerificationResults(base.verificationResults, event)
  const counterfactuals = updateCounterfactuals(base.counterfactuals, event)
  const watchdogThresholdsMs = updateWatchdogThresholds(base.watchdogThresholdsMs, event)
  const errorClass = mergeRunErrorClass(base.errorClass, errorClassForEvent(event))
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
  if (event.type === "counterfactual_recorded" || event.type === "harness_complete" || event.type === "workflow_notified" || event.type === "workflow_notify_failed" || isInterventionEvent(event)) return "report"
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
  if ((event.type === "container_execute_timed_out" || event.type === "container_crashed") && event.stageName) return "failed"
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
  const stageName = event.stageName ?? (
    event.type === "harness_complete" && typeof event.data.finalExecutionNode === "string"
      ? event.data.finalExecutionNode
      : undefined
  )
  if (!stageName) return existing
  if (
    event.type !== "stage_started" &&
    event.type !== "stage_completed" &&
    event.type !== "stage_failed" &&
    event.type !== "container_execute_timed_out" &&
    event.type !== "container_crashed" &&
    event.type !== "harness_complete"
  ) return existing

  const verdict = event.type === "stage_started"
    ? "in_progress"
    : event.type === "stage_completed" || (event.type === "harness_complete" && event.data.overall === "pass")
      ? "pass"
      : "fail"
  const current = existing.find((entry) => entry.stage === stageName)
  if (event.type === "stage_started" && current && current.verdict !== "in_progress" && (event.attemptNumber ?? 1) <= current.attempts) {
    return existing
  }
  // attempts = max(attemptNumber) seen for this stage — monotonically increases through retries
  const attempts = Math.max(current?.attempts ?? 0, event.attemptNumber ?? current?.attempts ?? 1)
  const without = existing.filter((entry) => entry.stage !== stageName)
  return [
    ...without,
    {
      stage: stageName,
      phase,
      verdict,
      attempts,
      at: event.timestamp,
    },
  ]
}

function stagesFromSummary(summary: RunSummary): RunArtifactManifest["stages"] {
  return summary.stageHistory.map((entry) => ({
    name: entry.stage,
    status: entry.verdict === "in_progress" ? "running" : entry.verdict,
    attempts: entry.attempts,
    ...(entry.verdict === "in_progress" ? { startedAt: entry.at } : { completedAt: entry.at }),
  }))
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
  if (event.type === "container_execute_timed_out" || event.type === "container_crashed") {
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
  if (event.type === "run_cancel_requested") return "operator_cancelled"
  const explicit = classifyRunErrorClass(event.data.failureClass)
  if (explicit) return explicit
  if (event.type === "stage_failed") return event.error ? "step_error" : "gate_abort"
  if (event.type === "workflow_notify_failed" || event.type === "container_crashed" || event.type === "container_execute_timed_out") return "infrastructure_error"
  return undefined
}

function mergeRunErrorClass(existing: RunErrorClass | undefined, next: RunErrorClass | undefined): RunErrorClass | undefined {
  if (!next) return existing
  if (!existing) return next
  return errorClassRank(next) >= errorClassRank(existing) ? next : existing
}

function errorClassRank(errorClass: RunErrorClass): number {
  switch (errorClass) {
    case "operator_cancelled": return 6
    case "watchdog_stuck": return 5
    case "dlq_exhausted": return 4
    case "infrastructure_error": return 3
    case "step_error": return 2
    case "gate_abort": return 1
  }
}

function isTerminalEvent(type: RunEventType): boolean {
  return type === "harness_complete" || type === "dlq_recovered" || type === "stuck_detected" || type === "container_crashed" || type === "container_execute_timed_out"
}

function isExecutionProjectionEvent(event: RunEvent): boolean {
  return event.type === "stage_dispatched"
    || event.type === "stage_started"
    || event.type === "worker_executed"
    || event.type === "gate_evaluated"
    || event.type === "stage_completed"
    || event.type === "stage_failed"
    || event.type === "harness_complete"
    || event.type === "container_dispatch_retried"
    || event.type === "container_dispatch_recovered"
    || event.type === "container_execute_timed_out"
    || event.type === "container_stderr_flush"
    || event.type === "container_crashed"
}

function isInterventionEvent(event: RunEvent): event is RunEvent & {
  type: "operator_note_added" | "run_cancel_requested" | "stage_retry_requested" | "stage_redispatch_requested"
} {
  return event.type === "operator_note_added"
    || event.type === "run_cancel_requested"
    || event.type === "stage_retry_requested"
    || event.type === "stage_redispatch_requested"
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
