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
  | "dlq_recovered"
  | "stuck_detected"
  | "container_started"
  | "container_stderr_flush"
  | "container_crashed"

export type RunEventEmitter =
  | "harness-bridge"
  | "run-coordinator"
  | "harness-dispatcher"
  | "pi-container"
  | "dlq-consumer"
  | "watchdog"

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

export type RunEventInput =
  & Omit<RunEvent, "schemaVersion" | "eventId" | "timestamp">
  & {
    eventId?: string
    timestamp?: string
  }
