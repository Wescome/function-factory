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

  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  DEEPSEEK_API_KEY?: string

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
  sendEvent(name: string, payload: unknown): Promise<void>
}
