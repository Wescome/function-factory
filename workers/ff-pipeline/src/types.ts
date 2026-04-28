export interface PipelineEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string

  GATES: {
    evaluateGate1(workGraph: unknown): Promise<Gate1Report>
  }

  FACTORY_PIPELINE: {
    create(opts: { params: PipelineParams }): Promise<{ id: string }>
    get(id: string): Promise<WorkflowInstance>
  }

  COORDINATOR: DurableObjectNamespace<import('./coordinator/coordinator').SynthesisCoordinator>

  SYNTHESIS_QUEUE: Queue

  /** Queue for DO -> Worker result relay (avoids self-fetch deadlock) */
  SYNTHESIS_RESULTS: Queue

  OFOX_API_KEY?: string

  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<{ response: string }>
  }

  /** @cloudflare/sandbox binding — activated when container image is deployed */
  SANDBOX?: unknown
  /** R2 bucket for workspace backups */
  WORKSPACE_BUCKET?: unknown

  ENVIRONMENT: string
}

export interface PipelineParams {
  signal: SignalInput
  dryRun?: boolean
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
  workGraphId?: string
  gate1Report?: Gate1Report
  report?: unknown
  reason?: string
  synthesisResult?: {
    verdict: { decision: string; confidence: number; reason: string }
    tokenUsage: number
    repairCount: number
  }
}

export interface Gate1Report {
  gate: 1
  passed: boolean
  timestamp: string
  workGraphId: string
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
