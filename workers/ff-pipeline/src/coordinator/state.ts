// ────────────────────────────────────────────────────────────
// PipelineWorkGraph — typed WorkGraph as it flows through synthesis
// ────────────────────────────────────────────────────────────

/**
 * WorkGraph as it flows through the synthesis pipeline.
 * Extends the canonical Zod-validated shape (packages/schemas WorkGraph)
 * with ArangoDB document fields and pipeline-specific execution fields.
 *
 * The index signature preserves forward compatibility — the pipeline
 * dynamically adds fields, but known fields are now typed.
 */
export interface PipelineWorkGraph {
  // Canonical fields (from @factory/schemas WorkGraph)
  id: string
  functionId?: string
  nodes?: WorkGraphNodeShape[]
  edges?: WorkGraphEdgeShape[]
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

export interface WorkGraphNodeShape {
  id: string
  type: string
  title?: string
  label?: string
  implements?: string
}

export interface WorkGraphEdgeShape {
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

export type VerdictDecision = 'pass' | 'patch' | 'resample' | 'interrupt' | 'fail'

export interface Verdict {
  decision: VerdictDecision
  confidence: number
  reason: string
  notes?: string
  artifacts?: CodeArtifact
  /** v4.1: which atoms need retry when decision is 'patch' */
  failedAtomIds?: string[]
}

export interface GraphState {
  [key: string]: unknown
  workGraphId: string
  workGraph: PipelineWorkGraph

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
  gate1Passed: boolean
  gate1Report: unknown | null
  compiledPrd: unknown | null

  // v4.1: per-atom retry isolation — which atoms need retry (null = retry all)
  failedAtomIds: string[] | null

  // Specification content threaded from the proposal through the Queue
  specContent: string | null

  // Sandbox state
  sandboxName: string | null
  freshBackupHandle: string | null
  coderBackupHandle: string | null
  executionMode: 'dry-run' | 'sandbox' | 'callModel-fallback' | null

  // Tool tracking
  workspaceReady?: boolean
  coderToolCalls?: number
  testerToolCalls?: number
  blockedToolCalls?: { role: string; toolName: string; reason: string }[]
}

export function createInitialState(
  workGraphId: string,
  workGraph: PipelineWorkGraph,
  opts?: { maxRepairs?: number; maxTokens?: number; specContent?: string | null },
): GraphState {
  return {
    workGraphId,
    workGraph,
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
    gate1Passed: false,
    gate1Report: null,
    compiledPrd: null,
    sandboxName: null,
    freshBackupHandle: null,
    coderBackupHandle: null,
    executionMode: null,
    workspaceReady: false,
  }
}
