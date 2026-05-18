import type { FunctionJob } from "@factory/schemas"
import type { HarnessQueueMessage } from "./harness-env"
import type { PiWorkerVersionMetadata } from "./coordinator/pi-container-version"

export interface PipelineEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string

  GATES: {
    evaluateCoherenceVerification(executableSpecification: unknown): Promise<CoherenceVerificationReport>
  }

  FACTORY_PIPELINE: {
    create(opts: { id?: string; params: PipelineParams }): Promise<{ id: string }>
    get(id: string): Promise<WorkflowInstance>
  }

  COORDINATOR: DurableObjectNamespace<import('./coordinator/coordinator').SynthesisCoordinator>

  /** v5.1: AtomExecutor DO namespace — one DO per atom for independent lifetimes */
  ATOM_EXECUTOR: DurableObjectNamespace<import('./coordinator/atom-executor-do').AtomExecutor>

  SYNTHESIS_QUEUE: Queue

  /** Queue for DO -> Worker result relay (avoids self-fetch deadlock) */
  SYNTHESIS_RESULTS: Queue

  /** v5.1: Queue for atom completion results from AtomExecutor DOs */
  ATOM_RESULTS: Queue

  /** Feedback loop: synthesis results become new signals */
  FEEDBACK_QUEUE?: Queue

  OFOX_API_KEY?: string
  CF_API_TOKEN?: string

  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<{ response: string }>
  }

  /** @cloudflare/sandbox binding — activated when container image is deployed */
  SANDBOX?: unknown
  /** R2 bucket for workspace backups */
  WORKSPACE_BUCKET?: unknown

  /** GitHub personal access token for PR creation */
  GITHUB_TOKEN?: string

  // ── Harness path bindings (IS-HARNESS-DSL-v1 §2–§3, ADR-009 Phase 3) ─────
  // Optional here because not every Worker invocation touches the harness
  // path. harness-bridge.ts / run-coordinator.ts / harness-dispatcher.ts
  // narrow these via the HarnessBridgeEnv interface where they are required.
  /** Durable Object namespace for the RunCoordinator (one DO per run) */
  RUN_COORDINATOR?: DurableObjectNamespace
  /** Queue producer for stage dispatch — typed body for callsite safety. */
  HARNESS_QUEUE?: Queue<HarnessQueueMessage>
  /** Pi container service binding */
  PI_CONTAINER?: DurableObjectNamespace
  /** Aider container service binding */
  AIDER_CONTAINER?: { fetch: (req: Request) => Promise<Response> }
  /** Claude Code container service binding */
  CLAUDE_CODE_CONTAINER?: { fetch: (req: Request) => Promise<Response> }

  LEARNING_ENABLED?: string
  LEARNING_OBSERVATIONS_ENABLED?: string
  LEARNING_WRITE_TIMEOUT_MS?: string
  LEARNING_WARMSTART_ENABLED?: string
  DREAM_DO_ENABLED?: string

  ENVIRONMENT: string

  /** Cloudflare Worker version metadata binding. */
  CF_VERSION_METADATA?: PiWorkerVersionMetadata
}

export interface PipelineParams {
  /** Required for synthesis path. Omitted on harness-only runs. */
  signal?: SignalInput
  dryRun?: boolean
  /**
   * Optional FunctionJob descriptor. When `job.harnessKey` is set, the
   * pipeline routes through the harness runtime (IS-HARNESS-DSL-v1 §2)
   * via `startHarnessRun` instead of the synthesis graph. When absent
   * or when `harnessKey` is undefined, the legacy synthesis path runs.
   */
  job?: FunctionJob
}

export interface SignalInput {
  signalType: 'market' | 'customer' | 'competitor' | 'regulatory' | 'internal' | 'meta'
  source: string
  title: string
  description: string
  evidence?: string[]
  sourceRefs?: string[]
  subtype?: string
  raw?: Record<string, unknown>

  /**
   * The substantive specification content this Signal references.
   * When present, this is the ground truth that Stages 2-4 derive from.
   * When absent, Stages 2-4 operate in generation mode (current behavior).
   */
  specContent?: string
}

export interface PipelineResult {
  status: string
  signalId?: string
  pressureId?: string
  capabilityId?: string
  proposalId?: string
  executableSpecificationId?: string
  coherenceVerificationReport?: CoherenceVerificationReport
  report?: unknown
  reason?: string
  synthesisResult?: {
    verdict: { decision: string; confidence: number; reason: string }
    tokenUsage: number
    repairCount: number
  }
  atomResults?: Record<string, unknown>
  harnessResultKey?: string
}

export interface CoherenceVerificationReport {
  verification: "coherence"
  passed: boolean
  timestamp: string
  executableSpecificationId: string
  checks: { name: string; passed: boolean; detail: string }[]
  summary: string
}

export interface SemanticReviewResult {
  alignment: 'aligned' | 'miscast' | 'uncertain'
  confidence: number
  citations: string[]
  rationale: string
  timestamp: string
}

interface WorkflowInstance {
  id: string
  status(): Promise<unknown>
  sendEvent(event: { type: string; payload: unknown }): Promise<void>
}
