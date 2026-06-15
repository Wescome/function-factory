/**
 * @factory/architect-agent — Types
 *
 * Shared type definitions for ArchitectAgentDO and all four domain handlers.
 * All CRP references from the original spec are renamed CRD (Coverage Reconciliation Directive).
 */

// ── D1: Patch Governance ──────────────────────────────────────────────────────

export type PatchUrgency = 'normal' | 'emergency'
export type PatchStatus = 'propagating' | 'complete' | 'partial-failure'

export interface PatchRequest {
  changedArtifactId: string
  changeDescription: string
  authorizedBy: string
  urgency: PatchUrgency
}

export interface PatchResponse {
  patchId: string
  affectedRepoCount: number
  status: 'propagating'
}

export interface PatchRow {
  patch_id: string
  trigger: string
  change_description: string
  authorized_by: string
  urgency: PatchUrgency
  status: PatchStatus
  affected_repo_ids: string // JSON: string[]
  applied_repo_ids: string  // JSON: string[]
  pending_repo_ids: string  // JSON: string[]
  issued_at: string
  completed_at: string | null
}

// ── D2: CRD Resolution (was CRP) ─────────────────────────────────────────────

export type CrdStatus =
  | 'pending'
  | 'in-resolution'
  | 'resolved'
  | 'escalated-to-we-layer'

export type CrdFailureClass =
  | 'SCHEMA_VIOLATION'
  | 'INVARIANT_CONFLICT'
  | 'COVERAGE_GAP'
  | 'LINEAGE_BREAK'

export interface CrdRequest {
  repoId: string
  amendmentId: string            // AMD-* that failed Coherence Verification
  coherenceVerdictDetail: string
  hypothesisId: string           // HYP-* that motivated the Amendment
  divergenceIds: string[]        // DIV-* that motivated the Hypothesis
}

export interface CrdResponse {
  crdId: string
  status: 'queued' | 'in-resolution'
  estimatedResolutionMs?: number
}

export interface CrdRow {
  crd_id: string
  repo_id: string
  amendment_id: string
  coherence_verdict: string
  hypothesis_id: string
  divergence_ids: string  // JSON: string[]
  failure_class: CrdFailureClass | null
  status: CrdStatus
  resolution_attempts: number
  resolution_action: string | null
  corrected_artifact_id: string | null
  received_at: string
  resolved_at: string | null
}

// ── D3: Vertical Slice Policy ─────────────────────────────────────────────────

export interface VsliceConfig {
  configId: string
  atomRetryIsolation: boolean
  maxAtomRetries: number
  parallelSliceThreshold: number
  dagDispatchEnabled: boolean
  triggerReason: string
  effectiveFrom: string
}

export interface VsliceConfigRow {
  [key: string]: SqlStorageValue
  config_id: string
  atom_retry_isolation: number  // SQLite bool (0/1)
  max_atom_retries: number
  parallel_slice_threshold: number
  dag_dispatch_enabled: number  // SQLite bool (0/1)
  trigger_reason: string
  effective_from: string
  superseded_at: string | null
}

// ── D4: Pipeline Configuration ────────────────────────────────────────────────

export type ModelId = 'gpt-5-5' | 'deepseek-flash' | 'claude-opus' | 'local'

export interface PassRoutingConfig {
  passId: string // 'pass-1' through 'pass-8'
  model: ModelId
  fallback: Extract<ModelId, 'gpt-5-5' | 'claude-opus'>
  maxRetries: number
}

export interface GateThresholdConfig {
  coherenceMinCoverage: number          // 0-1; default 1.0
  fidelityMaxOpenBlockingDivergences: number  // default 0
  assuranceMaxDetectorStalenessHours: number  // default 24
}

export interface PipelineConfig {
  configId: string
  passRouting: PassRoutingConfig[]
  gateThresholds: GateThresholdConfig
  verticalSlicePolicy: VsliceConfig
  effectiveFrom: string
  reason: string
}

export interface PipelineConfigRow {
  [key: string]: SqlStorageValue
  config_id: string
  pass_routing: string           // JSON: PassRoutingConfig[]
  coherence_min_coverage: number
  fidelity_max_open_blocking_divs: number
  assurance_max_detector_staleness: number
  effective_from: string
  reason: string
  anomaly_evidence_ids: string   // JSON: string[]
  superseded_at: string | null
}

// ── Repo Registry ─────────────────────────────────────────────────────────────

export type RepoHealthStatus = 'healthy' | 'degraded' | 'suspended' | 'unknown'

export interface RegisterRepoRequest {
  repoId: string
  commissioningAgentUrl: string
  mediationAgentDoKey: string
}

export interface DeregisterRepoRequest {
  repoId: string
}

export interface RepoRow {
  [key: string]: SqlStorageValue
  repo_id: string
  commissioning_agent_url: string
  mediation_agent_do_key: string
  health_status: RepoHealthStatus
  active_blocking_divergences: number
  pending_crd_count: number
  last_health_poll_at: string | null
  registered_at: string
}

// ── Factory Lifecycle State ────────────────────────────────────────────────────

export type FactoryLifecycleState = 'ACTIVE' | 'EMERGENCY_SUSPEND' | 'MAINTENANCE'

export interface FactoryStateRow {
  [key: string]: SqlStorageValue
  factory_id: string
  lifecycle_state: FactoryLifecycleState
  last_anomaly_at: string | null
  last_patch_at: string | null
  active_pipeline_cfg: string | null
  active_vslice_cfg: string | null
  updated_at: string
}

// ── Anomaly Records ───────────────────────────────────────────────────────────

export type AnomalyClass =
  | 'PASS_FAILURE_RATE'
  | 'AMENDMENT_COHERENCE'
  | 'PATCH_STALL'
  | 'DEADLOCK'
  | 'SEQUENTIAL_FAILURE'
  | 'WEOPS_AUTH_REQUIRED'

export interface AnomalyRecord {
  anomalyId: string
  anomalyClass: AnomalyClass
  domain: 'D1' | 'D2' | 'D3' | 'D4'
  evidence: Record<string, unknown>
  triggeredAt: string
  resolved: boolean
}

export interface AnomalyRow {
  anomaly_id: string
  anomaly_class: AnomalyClass
  domain: string
  evidence: string  // JSON
  triggered_at: string
  resolved: number  // SQLite bool (0/1)
}

// ── Health Response ───────────────────────────────────────────────────────────

export interface HealthResponse {
  lifecycleState: FactoryLifecycleState
  activeRepoCount: number
  reposByHealth: Record<RepoHealthStatus, number>
  pendingCrdCount: number
  activePatchCount: number
  activePipelineConfigId: string | null
  activeVsliceConfigId: string | null
}

// ── ArtifactGraph write payload ───────────────────────────────────────────────

export interface GovernanceArtifactPayload {
  type:
    | 'PATCH'
    | 'CRD-RESOLUTION'
    | 'VSLICE-CONFIG'
    | 'PIPELINE-CONFIG'
    | 'ELUCIDATION'
  id: string
  domain: 'D1' | 'D2' | 'D3' | 'D4'
  source: 'architect-agent'
  explicitness: 'stated'
  payload: Record<string, unknown>
}
