export type RunStage = "intent" | "plan" | "execution" | "eval" | "report"

export type RunEventType =
  | "run_started"
  | "seed_written"
  | "seed_failed"
  | "harness_loaded"
  | "run_coordinator_initialized"
  | "stage_dispatched"
  | "stage_started"
  | "worker_executed"
  | "coherence_verified"
  | "fidelity_verified"
  | "persistence_verified"
  | "gate_evaluated"
  | "stage_completed"
  | "stage_failed"
  | "counterfactual_recorded"
  | "harness_complete"
  | "workflow_notified"
  | "workflow_notify_failed"
  | "operator_note_added"
  | "run_cancel_requested"
  | "stage_retry_requested"
  | "stage_redispatch_requested"
  | "dlq_recovered"
  | "stuck_detected"
  | "container_started"
  | "container_dispatch_retried"
  | "container_dispatch_recovered"
  | "container_backpressure_rejected"
  | "container_backpressure_waited"
  | "container_execute_timed_out"
  | "container_stderr_flush"
  | "container_crashed"

export type RunEventEmitter =
  | "harness-bridge"
  | "run-coordinator"
  | "harness-dispatcher"
  | "pi-container"
  | "dlq-consumer"
  | "watchdog"
  | "operator"

export interface RunEvent {
  schemaVersion: "1.0"
  eventId: string
  runId: string
  workflowId?: string
  stageName?: string
  attemptNumber?: number
  type: RunEventType
  timestamp: string
  data: Record<string, unknown>
  error?: {
    code?: string
    message: string
    stack?: string
  }
  emitter: RunEventEmitter
}

export type CounterfactualClass =
  | "model_candidate_skipped"
  | "stage_branch_not_taken"
  | "retry_budget_exhausted"
  | "gate_early_exit"
  | "watchdog_terminated"

export interface Counterfactual {
  class: CounterfactualClass
  what: string
  why: string
  at: string
}

export type RunStatus =
  | "running"
  | "coherence_blocked"
  | "fidelity_blocked"
  | "persistence_blocked"
  | "completed"
  | "failed"
  | "stuck"
  | "dlq_recovered"

export type RunErrorClass =
  | "infrastructure_error"
  | "step_error"
  | "gate_abort"
  | "dlq_exhausted"
  | "watchdog_stuck"
  | "operator_cancelled"

export interface RunSummary {
  schemaVersion: "1.0"
  runId: string
  slug: string
  workflowId?: string
  status: RunStatus
  currentPhase?: RunStage
  currentStage?: string
  lastEventType: RunEventType
  lastEventAt: string
  lastError?: { code?: string; message: string }
  stageHistory: Array<{
    stage: string
    phase: RunStage
    verdict: "pass" | "fail" | "in_progress"
    attempts: number
    at: string
  }>
  verificationResults?: {
    coherence?: { status: "pass" | "blocked" | "warn"; at: string }
    fidelity?: { status: "pass" | "blocked" | "warn"; at: string }
    persistence?: { status: "pass" | "blocked" | "warn"; at: string }
  }
  stepAccounting?: {
    ok: string[]
    failed: string[]
    neverDispatched: string[]
  }
  errorClass?: RunErrorClass
  counterfactuals?: Counterfactual[]
  watchdogThresholdsMs?: Record<string, number>
  startedAt: string
  terminalAt?: string
  eventCount: number
}

export interface ActiveRunIndex {
  schemaVersion: "1.0"
  updatedAt: string
  runs: Array<{
    runId: string
    lastEventAt: string
    currentStage?: string
  }>
}

export interface RunArtifactManifest {
  schemaVersion: "1.0"
  runId: string
  rootKey: string
  summaryKey: string
  eventPrefix: string
  attemptLogPrefix: string
  createdAt: string
  updatedAt: string
  workflowId?: string
  status?: RunStatus
  harness?: {
    key?: string
    name?: string
    executionNodes?: string[]
    workerNames?: string[]
    watchdogThresholdsMs?: Record<string, number>
  }
  phases: {
    intent?: { key: string; updatedAt: string }
    plan?: { key: string; updatedAt: string }
    execution?: { key: string; updatedAt: string }
    traces?: { key: string; updatedAt: string }
    eval?: { key: string; updatedAt: string }
    report?: { key: string; updatedAt: string }
  }
  stages: Array<{
    name: string
    worker?: string
    role?: string
    status?: "running" | "pass" | "fail"
    attempts: number
    startedAt?: string
    completedAt?: string
    elapsedMs?: number
    declaredInputs?: string[]
    declaredOutputs?: string[]
    artifacts?: string[]
    gateResults?: Array<Record<string, unknown>>
    observationKeys?: string[]
    contractEvaluationKeys?: string[]
    containerDispatchRetries?: Array<{
      status: "retry_scheduled" | "recovered"
      attempt: number
      maxAttempts: number
      delayMs?: number
      reason?: string
      at: string
    }>
    reason?: string
  }>
  artifacts: Array<{
    name: string
    key: string
    stage?: string
    producedAt: string
  }>
  diagnostics: {
    observations: string[]
    contractEvaluations: string[]
    attemptLogsPrefix: string
  }
  terminalAt?: string
}

export interface RunMonitorSnapshot {
  schemaVersion: "1.0"
  runId: string
  status: RunStatus
  currentPhase?: RunStage
  currentStage?: string
  summary: RunSummary
  manifest?: RunArtifactManifest
  stages: RunArtifactManifest["stages"]
  timeline: Array<{
    at: string
    type: RunEventType
    emitter: RunEventEmitter
    stageName?: string
    attemptNumber?: number
    message?: string
    error?: string
  }>
  interventions: Array<{
    at: string
    type: Extract<RunEventType, "operator_note_added" | "run_cancel_requested" | "stage_retry_requested" | "stage_redispatch_requested">
    operator?: string
    stageName?: string
    message?: string
    effect?: string
  }>
  diagnostics: {
    observations: string[]
    contractEvaluations: string[]
    attemptLogsPrefix?: string
    infrastructureFailures?: Array<{
      at: string
      type: Extract<RunEventType, "container_crashed" | "container_execute_timed_out">
      stageName?: string
      attemptNumber?: number
      message: string
    }>
  }
  artifacts: RunArtifactManifest["artifacts"]
  updatedAt: string
}

export type RunEventInput =
  & Omit<RunEvent, "schemaVersion" | "eventId" | "timestamp">
  & {
    eventId?: string
    timestamp?: string
  }
