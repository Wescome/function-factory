import { z } from "zod"

// ─── Inbound signals (We → I) — bare JSON, no envelope ───────────────────────

export const CommissioningSignal = z.object({
  signalType: z.literal("CommissioningSignal"),
  repoId: z.string().min(1),
  workGraphId: z.string().min(1),               // WG-*
  workGraphVersion: z.string().min(1),
  dispositionEventId: z.string().min(1),        // must match token claim
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
})
export type CommissioningSignal = z.infer<typeof CommissioningSignal>

export const ResumeSignal = z.object({
  signalType: z.literal("ResumeSignal"),
  repoId: z.string().min(1),
  newWorkGraphId: z.string().min(1).optional(),
  newWorkGraphVersion: z.string().min(1).optional(),
  dispositionEventId: z.string().min(1),
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
})
export type ResumeSignal = z.infer<typeof ResumeSignal>

export const PatchAuthSignal = z.object({
  signalType: z.literal("PatchAuthSignal"),
  patchId: z.string().min(1),                   // patch artifact in ArangoDB
  affectedRepoIds: z.array(z.string().min(1)).min(1),
  dispositionEventId: z.string().min(1),
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
})
export type PatchAuthSignal = z.infer<typeof PatchAuthSignal>

export const PipelineConfigAuthSignal = z.object({
  signalType: z.literal("PipelineConfigAuthSignal"),
  configChangeId: z.string().min(1),
  affectedRepoIds: z.array(z.string().min(1)).min(1),
  dispositionEventId: z.string().min(1),
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
})
export type PipelineConfigAuthSignal = z.infer<typeof PipelineConfigAuthSignal>

export const OverrideDirective = z.enum([
  "force-suspend",
  "force-resume",
  "emergency-patch",
])
export type OverrideDirective = z.infer<typeof OverrideDirective>

export const OverrideSignal = z.object({
  signalType: z.literal("OverrideSignal"),
  directive: OverrideDirective,
  targetRepoId: z.string().min(1).optional(),   // absent = Factory-wide
  patchId: z.string().min(1).optional(),        // for emergency-patch
  dispositionEventId: z.string().min(1),
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
  // Note: requires scope 'we-layer:override' AND two-person approval
  // validated upstream by ff-linear-bridge ApprovalFlow
})
export type OverrideSignal = z.infer<typeof OverrideSignal>

export const InboundSignal = z.discriminatedUnion("signalType", [
  CommissioningSignal,
  ResumeSignal,
  PatchAuthSignal,
  PipelineConfigAuthSignal,
  OverrideSignal,
])
export type InboundSignal = z.infer<typeof InboundSignal>

// ─── Outbound signal payloads (I → We) — carried in work_graph.durable_objects ─

export const EscalationPayload = z.object({
  signalType: z.literal("EscalationEvent"),
  escalationId: z.string().min(1),              // unique per escalation; KV key for retry
  repoId: z.string().min(1),
  divergenceIds: z.array(z.string().min(1)),    // INV-* violations that triggered suspension
  hypothesisChain: z.array(z.string().min(1)), // Hypothesis IDs from Mediation Agent
  suspensionState: z.string().min(1),           // current Mediation Agent lifecycle state
  openDivergenceCount: z.number().int().nonnegative(),
  producedAt: z.string().min(1),
  producedBy: z.string().min(1),                // 'mediation-agent:{repoId}'
})
export type EscalationPayload = z.infer<typeof EscalationPayload>

export const HealthSummaryRepoEntry = z.object({
  repoId: z.string().min(1),
  lifecycleState: z.string().min(1),
  lastCommissionAt: z.string().min(1),
  openDivergences: z.number().int().nonnegative(),
})
export type HealthSummaryRepoEntry = z.infer<typeof HealthSummaryRepoEntry>

export const HealthSummaryPayload = z.object({
  signalType: z.literal("HealthSummary"),
  factoryRepos: z.array(HealthSummaryRepoEntry),
  producedAt: z.string().min(1),
})
export type HealthSummaryPayload = z.infer<typeof HealthSummaryPayload>

export const VerdictType = z.enum(["coherence", "fidelity"])
export type VerdictType = z.infer<typeof VerdictType>

export const VerdictValue = z.enum(["favorable", "unfavorable"])
export type VerdictValue = z.infer<typeof VerdictValue>

export const VCRPayload = z.object({
  signalType: z.literal("VCR"),
  vcrId: z.string().min(1),
  dispositionEventId: z.string().min(1),        // the Disposition Event this closes
  verdictType: VerdictType,
  verdict: VerdictValue,
  atomId: z.string().min(1).optional(),         // for fidelity verdicts
  repoId: z.string().min(1),
  producedAt: z.string().min(1),
})
export type VCRPayload = z.infer<typeof VCRPayload>

export const OutboundPayload = z.discriminatedUnion("signalType", [
  EscalationPayload,
  HealthSummaryPayload,
  VCRPayload,
])
export type OutboundPayload = z.infer<typeof OutboundPayload>
