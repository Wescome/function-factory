/**
 * @factory/commissioning-agent — Zod schemas
 *
 * DomainProfile, CommissioningSignal, DivergenceNotification.
 */

import { z } from 'zod'

// ── DomainProfile ─────────────────────────────────────────────────────────────

export const DomainConstraintSchema = z.object({
  id: z.string().min(1), // CONS-{nanoid}
  description: z.string().min(1),
  severity: z.enum(['blocking', 'advisory']),
})
export type DomainConstraint = z.infer<typeof DomainConstraintSchema>

export const VerticalSchema = z.enum([
  'gtm-engineering',
  'healthcare-operations',
  'comeflow-commerce',
  'fintech-compliance',
  'generic',
])
export type Vertical = z.infer<typeof VerticalSchema>

export const DomainProfileSchema = z.object({
  vertical: VerticalSchema,
  orgContext: z.string(), // free-form org description for soul block
  constraints: z.array(DomainConstraintSchema),
  additionalSkillRefs: z.array(z.string()).optional(),
  version: z.string().default('1.0'),
})
export type DomainProfile = z.infer<typeof DomainProfileSchema>

// ── CommissioningSignal ───────────────────────────────────────────────────────

export const CommissioningSignalSchema = z.object({
  orgId: z.string().min(1),
  workGraphId: z.string().optional(), // if pre-specified by We-layer (WG-*)
  workGraphVersion: z.string().optional(),
  domainProfile: DomainProfileSchema,
  dispositionEventId: z.string().min(1), // ELC-* ref (A9)
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
  requireHumanApproval: z.boolean().default(true),
})
export type CommissioningSignal = z.infer<typeof CommissioningSignalSchema>

// ── DivergenceNotification ────────────────────────────────────────────────────

export const DivergenceNotificationSchema = z.object({
  divergenceId: z.string().min(1), // INV-* violation id from LoopClosureService
  specificationId: z.string().min(1), // SpecificationNode id in ArtifactGraphDO
  runId: z.string().min(1), // active run that produced the Divergence
})
export type DivergenceNotification = z.infer<typeof DivergenceNotificationSchema>

// ── WorkspaceWrite ────────────────────────────────────────────────────────────

export const WorkspaceWriteSchema = z.object({
  path: z.string().min(1), // '/spec/skills/{name}/SKILL.md' — virtual path in Think workspace
  content: z.string(), // raw Markdown skill content (T2 spec: injection)
})
export type WorkspaceWrite = z.infer<typeof WorkspaceWriteSchema>

// ── Internal session context ──────────────────────────────────────────────────

export type Phase =
  | 'idle'
  | 'pattern-appraisal'
  | 'deliberation'
  | 'workgraph-authoring'
  | 'hypothesis-formation'
  | 'amendment-proposal'

export interface SessionContext {
  orgId: string
  currentPhase: Phase
  domainProfile: DomainProfile
  activeRunId: string | null
  lastSignalAt: string | null
  lastDivergenceAt: string | null
  updatedAt: string
}

// ── Phase runner result types ─────────────────────────────────────────────────

export interface PatternAppraisalResult {
  matches: boolean
  reason: string
  patternId?: string | undefined
}

export interface CandidateSet {
  candidates: Array<{
    id: string
    description: string
    score: number
    feasible: boolean
  }>
  nominated: string // id of nominated candidate
  nominationReason: string
}

export interface WorkGraph {
  id: string // WG-*
  orgId: string
  dispositionEventId: string
  producedBy: string // CommissioningAgentDO:{orgId}
  producedAt: string
  pressure: unknown
  capability: unknown
  functionProposal: unknown
  prd: unknown
}

export interface HypothesisNode {
  id: string // HYP-*
  divergenceId: string
  specificationId: string
  runId: string
  faultAttribution: 'SPECIFICATION_GAP' | 'TOOLING_FAILURE' | 'INVARIANT_MISMATCH' | 'ENVIRONMENTAL'
  explanation: string
  evidenceChain: string
  amendmentScope: string
  authorModelId: string
  severity: 'advisory' | 'blocking'
  producedAt: string
  surfaced: boolean
  surfacedAt: string | null
}

export interface Amendment {
  id: string // AMD-*
  hypothesisId: string
  workGraphId: string | null
  proposedChange: unknown
  status: 'CANDIDATE' | 'ACCEPTED' | 'REJECTED'
  producedAt: string
}

export interface CycleContext {
  cycleId: string
  cycleName: string
  startDate: string
  endDate: string
  isLastTwoDays: boolean
  isCycleEnd: boolean
  teamId: string
}
