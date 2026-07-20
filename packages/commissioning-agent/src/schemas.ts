/**
 * @factory/commissioning-agent — Zod schemas
 *
 * CommissioningSignal, DivergenceNotification.
 */

import { z } from 'zod'

// ── CommissioningSignal ───────────────────────────────────────────────────────

export const CommissioningSignalSchema = z.object({
  sessionId: z.string(),
  orgId: z.string().min(1),
  repoId: z.string().min(1),
  workGraphId: z.string().optional(), // if pre-specified by We-layer (WG-*)
  workGraphVersion: z.string().optional(),
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
  | 'commissioning'         // workflow running (steps 1–5)
  | 'suspended-approval'    // step 6 suspend()
  | 'hypothesis-formation'  // /divergence handler active
  | 'amendment-proposal'    // amendment handler active

export interface SessionContext {
  orgId: string
  currentPhase: Phase
  activeRunId: string | null    // Mastra workflow run ID
  isNodeId: string | null       // IS-* set after step 5 completes
  lastSignalAt: string | null
  lastDivergenceAt: string | null
  updatedAt: string
}

// ── Compiler pass output types ────────────────────────────────────────────────

export const PressureArtifactSchema = z.object({
  id: z.string().regex(/^PRS-/),
  kind: z.literal('pressure'),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.string().min(1),
  sourceSignalId: z.string().min(1),
  evidence: z.array(z.string()),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})
export type PressureArtifact = z.infer<typeof PressureArtifactSchema>

export const CapabilityArtifactSchema = z.object({
  id: z.string().regex(/^BC-/),
  kind: z.literal('capability'),
  title: z.string().min(1),
  description: z.string().min(1),
  gapAnalysis: z.string().min(1),
  sourcePressureId: z.string().min(1),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>

export const FunctionProposalSchema = z.object({
  id: z.string().regex(/^FP-/),
  kind: z.literal('function-proposal'),
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
  successCriteria: z.array(z.string()).min(1),
  sourceCapabilityId: z.string().min(1),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})
export type FunctionProposal = z.infer<typeof FunctionProposalSchema>

// ── Hypothesis / Amendment ────────────────────────────────────────────────────

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
  /** Number of Linear cycles this advisory has been surfaced in without resolution. */
  surfacedCycleCount: number
}

export interface Amendment {
  id: string // AMD-*
  hypothesisId: string
  specificationId: string | null   // was workGraphId (WorkGraph is retired)
  proposedChange: unknown
  status: 'CANDIDATE' | 'ACCEPTED' | 'REJECTED'
  producedAt: string
}

export interface CycleContext {
  cycleId: string
  cycleName: string
  startDate: string
  endDate: string
  /** Fractional days remaining until cycle end. Negative when cycle has ended. */
  daysRemaining: number
  isLastTwoDays: boolean
  isCycleEnd: boolean
  teamId: string
}
