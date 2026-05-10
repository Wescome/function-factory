import {
  CodingDomainAdapterContract,
  DomainExecutionEvidence,
  DomainExecutionRequest,
  ArtifactId,
} from '@factory/schemas'

// ────────────────────────────────────────────────────────────
// PipelineExecutableSpecification — typed ExecutableSpecification as it flows through synthesis
// ────────────────────────────────────────────────────────────

/**
 * ExecutableSpecification as it flows through the synthesis pipeline.
 * Extends the canonical Zod-validated shape (packages/schemas ExecutableSpecification)
 * with ArangoDB document fields and pipeline-specific execution fields.
 *
 * The index signature preserves forward compatibility — the pipeline
 * dynamically adds fields, but known fields are now typed.
 */
export interface PipelineExecutableSpecification {
  // Canonical fields (from @factory/schemas ExecutableSpecification)
  id: string
  functionId?: string
  nodes?: ExecutableSpecificationNodeShape[]
  edges?: ExecutableSpecificationEdgeShape[]
  source_refs?: string[]
  explicitness?: string
  rationale?: string

  // ArangoDB document fields
  _key?: string
  _id?: string
  _rev?: string

  // Pipeline execution fields
  title?: string
  atoms?: Record<string, unknown>[]
  invariants?: Record<string, unknown>[]
  dependencies?: Record<string, unknown>[]
  prdId?: string

  // Sandbox execution fields
  repoUrl?: string
  ref?: string
  branch?: string

  // Index signature for forward compatibility
  [key: string]: unknown
}

export interface ExecutableSpecificationNodeShape {
  id: string
  type: string
  title?: string
  label?: string
  implements?: string
}

export interface ExecutableSpecificationEdgeShape {
  from: string
  to: string
  condition?: string
  label?: string
  dependencyType?: string
}

// ────────────────────────────────────────────────────────────
// Pipeline state types
// ────────────────────────────────────────────────────────────

export interface Plan {
  approach: string
  atoms: { id: string; description: string; assignedTo: string }[]
  executorRecommendation: 'gdk-agent' | 'sandbox' | 'container-openhands'
  estimatedComplexity: 'low' | 'medium' | 'high'
}

export interface CodeArtifactEdit {
  search: string
  replace: string
  scope?: string
}

export interface CodeArtifactFile {
  path: string
  action: 'create' | 'modify' | 'delete'
  content?: string
  edits?: CodeArtifactEdit[]
}

export interface CodeArtifact {
  files: CodeArtifactFile[]
  summary: string
  testsIncluded: boolean

  // Phase 5 additions (sandbox mode)
  diff?: string
  commitLog?: string
  toolCallCount?: number
}

export interface CritiqueReport {
  passed: boolean
  issues: { severity: 'critical' | 'major' | 'minor'; description: string; file?: string; line?: number }[]
  mentorRuleCompliance: { ruleId: string; compliant: boolean }[]
  overallAssessment: string
}

export interface TestReport {
  passed: boolean
  testsRun: number
  testsPassed: number
  testsFailed: number
  failures: { name: string; error: string }[]
  coverage?: { lines: number; branches: number; functions: number }
  summary: string
}

export interface SandboxBackupHandle {
  id: string
  dir: string
  localBucket?: boolean
}

export type VerdictDecision = 'pass' | 'patch' | 'resample' | 'interrupt' | 'fail'

export type DisagreementClass =
  | 'repairable_local'
  | 'architectural'
  | 'governance'

export interface HumanApprovalPayload {
  reason: string
  scope_violation: boolean
  hard_constraint_violation: boolean
  requested_action: 'approve' | 'reject' | 'amend'
  notes?: string
}

export interface Verdict {
  decision: VerdictDecision
  confidence: number
  reason: string
  notes?: string
  artifacts?: CodeArtifact
  /** v4.1: which atoms need retry when decision is 'patch' */
  failedAtomIds?: string[]

  // Canonical escalation fields (from TerminalDecision in literate reference)
  requires_human_approval?: boolean
  human_approval_payload?: HumanApprovalPayload | null
  disagreement_class?: DisagreementClass | null
  escalation_score?: number
}

export interface GraphState {
  [key: string]: unknown
  executableSpecificationId: string
  executableSpecification: PipelineExecutableSpecification

  plan: Plan | null
  code: CodeArtifact | null
  critique: CritiqueReport | null
  tests: TestReport | null
  verdict: Verdict | null

  roleHistory: { role: string; output: unknown; tokenUsage: number; timestamp: string }[]

  repairCount: number
  tokenUsage: number
  maxRepairs: number
  maxTokens: number

  // ── Phase 5 v4: Briefing, gating, and sandbox execution (SS11) ──
  briefingScript: unknown | null
  semanticReview: unknown | null
  coherenceVerificationPassed: boolean
  coherenceVerificationReport: unknown | null
  domainExecutionRequest: DomainExecutionRequest
  domainExecutionEvidence: DomainExecutionEvidence | null
  compiledPrd: unknown | null

  // v4.1: per-atom retry isolation — which atoms need retry (null = retry all)
  failedAtomIds: string[] | null

  // Specification content threaded from the proposal through the Queue
  specContent: string | null

  // Sandbox state
  sandboxName: string | null
  freshBackupHandle: SandboxBackupHandle | null
  coderBackupHandle: SandboxBackupHandle | null
  executionMode: 'dry-run' | 'sandbox' | 'callModel-fallback' | null

  // Tool tracking
  workspaceReady?: boolean
  coderToolCalls?: number
  testerToolCalls?: number
  blockedToolCalls?: { role: string; toolName: string; reason: string }[]
}

export function createInitialState(
  executableSpecificationId: string,
  executableSpecification: PipelineExecutableSpecification,
  opts?: { maxRepairs?: number; maxTokens?: number; specContent?: string | null },
): GraphState {
  const domainExecutionRequest = buildDomainExecutionRequest(executableSpecificationId, executableSpecification)

  return {
    executableSpecificationId,
    executableSpecification,
    plan: null,
    code: null,
    critique: null,
    tests: null,
    verdict: null,
    roleHistory: [],
    repairCount: 0,
    tokenUsage: 0,
    maxRepairs: opts?.maxRepairs ?? 5,
    maxTokens: opts?.maxTokens ?? 150_000,

    // v4.1: per-atom retry isolation
    failedAtomIds: null,

    // Specification content threaded from proposal
    specContent: opts?.specContent ?? null,

    // Phase 5 v4 defaults (SS11)
    briefingScript: null,
    semanticReview: null,
    coherenceVerificationPassed: false,
    coherenceVerificationReport: null,
    domainExecutionRequest,
    domainExecutionEvidence: null,
    compiledPrd: null,
    sandboxName: null,
    freshBackupHandle: null,
    coderBackupHandle: null,
    executionMode: null,
    workspaceReady: false,
  }
}

function buildDomainExecutionRequest(
  executableSpecificationId: string,
  executableSpecification: PipelineExecutableSpecification,
): DomainExecutionRequest {
  const intentSpecificationId = intentSpecificationIdFromExecutableSpecification(
    executableSpecification,
  )

  return DomainExecutionRequest.parse({
    adapterId: CodingDomainAdapterContract.adapterId,
    functionId: artifactIdOrDerived('FN', executableSpecification.functionId ?? executableSpecificationId),
    intentSpecificationId,
    executableSpecificationId: artifactIdOrDerived('WG', executableSpecificationId),
    runId: `synthesis-${executableSpecificationId}`,
    mode: 'execute',
    parameters: {
      substrate: CodingDomainAdapterContract.substrate,
    },
  })
}

function intentSpecificationIdFromExecutableSpecification(
  executableSpecification: PipelineExecutableSpecification,
): ArtifactId {
  if (typeof executableSpecification.prdId === 'string' && executableSpecification.prdId.length > 0) {
    return artifactIdOrDerived('PRD', executableSpecification.prdId)
  }

  const sourceRefs = executableSpecification.source_refs ?? []
  const sourceIntentSpecificationId = sourceRefs.find((ref) => ref.startsWith('PRD-'))
  if (sourceIntentSpecificationId !== undefined) {
    return artifactIdOrDerived('PRD', sourceIntentSpecificationId)
  }

  const id = executableSpecification.id
  const subject = id.startsWith('WG-') ? id.slice(3) : id
  return artifactIdOrDerived('PRD', `PRD-${subject}`)
}

function artifactIdOrDerived(prefix: 'FN' | 'PRD' | 'WG', candidate: string): ArtifactId {
  const parsed = ArtifactId.safeParse(candidate)
  if (parsed.success) return parsed.data

  const subject = candidate
    .replace(/^[A-Za-z]+-/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'UNKNOWN'
  return ArtifactId.parse(`${prefix}-${subject}`)
}

export function buildDomainExecutionEvidence(
  request: DomainExecutionRequest,
  status: DomainExecutionEvidence['status'],
  evidenceRefs: readonly string[],
  observationSummary: string,
): DomainExecutionEvidence {
  return DomainExecutionEvidence.parse({
    adapterId: request.adapterId,
    executableSpecificationId: request.executableSpecificationId,
    runId: request.runId,
    status,
    evidenceRefs: [...evidenceRefs],
    observationSummary,
  })
}
