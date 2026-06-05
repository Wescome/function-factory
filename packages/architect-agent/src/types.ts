// Architect Agent DO — factory state and decision domain types
// SPEC-ARCHITECT-AGENT-DO-001

export type RepoSummary = {
  repoId: string
  commissioningAgentUrl: string
  mediationAgentDoKey: string
  lastHealthPollAt: string
  healthStatus: 'healthy' | 'degraded' | 'suspended' | 'unknown'
  activeBlockingDivergences: number
  pendingCrpCount: number
}

export type VerticalSlicePolicy = {
  atomRetryIsolation: boolean
  maxAtomRetries: number
  parallelSliceThreshold: number
  dagDispatchEnabled: boolean
}

export type PassRoutingConfig = {
  passId: string
  model: 'gpt-5-5' | 'deepseek-flash' | 'claude-opus' | 'local'
  fallback: 'gpt-5-5' | 'claude-opus'
  maxRetries: number
}

export type GateThresholdConfig = {
  coherenceMinCoverage: number
  fidelityMaxOpenBlockingDivergences: number
  assuranceMaxDetectorStalenessHours: number
}

export type PipelineConfig = {
  configId: string
  passRouting: PassRoutingConfig[]
  gateThresholds: GateThresholdConfig
  verticalSlicePolicy: VerticalSlicePolicy
  effectiveFrom: string
  reason: string
}

export type FactoryState = {
  activeRepos: RepoSummary[]
  pipelineConfig: PipelineConfig
  lifecycleState: 'ACTIVE' | 'EMERGENCY_SUSPEND' | 'MAINTENANCE'
}

export type CRPItem = {
  crpId: string
  repoId: string
  amendmentId: string
  coherenceVerdict: string
  status: 'pending' | 'in-resolution' | 'resolved' | 'escalated-to-we-layer'
  receivedAt: string
  resolvedAt?: string
}

export type PatchRecord = {
  patchId: string
  trigger: string
  affectedRepoIds: string[]
  appliedToRepoIds: string[]
  pendingRepoIds: string[]
  status: 'propagating' | 'complete' | 'partial-failure'
  issuedAt: string
  completedAt?: string
}

export type CRPFailureClass =
  | 'SCHEMA_VIOLATION'
  | 'INVARIANT_CONFLICT'
  | 'COVERAGE_GAP'
  | 'LINEAGE_BREAK'
  | 'UNKNOWN'         // fallback — escalates to We-layer by default
