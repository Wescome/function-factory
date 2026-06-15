/**
 * @factory/dream-do — Types
 *
 * All Zod schemas and plain TypeScript types for DreamDO.
 *
 * GAP-013: DreamDO singleton
 */

import { z } from 'zod'

// ── Primitive schemas ──────────────────────────────────────────────────────────

export const PrdSignatureSchema = z.object({
  concernClasses:   z.array(z.string()),
  dependencyTopology: z.string(),
  signalClass:      z.string(),
})
export type PrdSignature = z.infer<typeof PrdSignatureSchema>

// ── PassTemplate ──────────────────────────────────────────────────────────────

export const PassTemplateStateSchema = z.enum(['active', 'stale', 'retired'])
export type PassTemplateState = z.infer<typeof PassTemplateStateSchema>

export const PassTemplateSchema = z.object({
  id:                    z.string(),
  created_at:            z.string(),
  updated_at:            z.string(),
  name:                  z.string().nullable(),
  prd_signal_class:      z.string().nullable(),
  atom_signature:        z.string(),
  pass_coverage:         z.string(), // JSON array [1..8]
  atom_templates:        z.string(), // JSON
  contract_templates:    z.string(), // JSON
  invariant_templates:   z.string(), // JSON
  state:                 PassTemplateStateSchema,
  pinned:                z.number(), // 0 | 1
  retired_at:            z.string().nullable(),
  retire_reason:         z.string().nullable(),
  source_run_id:         z.string().nullable(),
  source_verdict_summary: z.string().nullable(), // JSON
  artifact_graph_ref:    z.string().nullable(),
})
export type PassTemplate = z.infer<typeof PassTemplateSchema>

// ── TemplateDiff ──────────────────────────────────────────────────────────────

export const TemplateDiffSchema = z.object({
  atom_templates:      z.string().optional(), // JSON
  contract_templates:  z.string().optional(), // JSON
  invariant_templates: z.string().optional(), // JSON
  pass_coverage:       z.string().optional(), // JSON
  name:                z.string().optional(),
}).refine(
  (d) => Object.keys(d).length > 0,
  { message: 'TemplateDiff must include at least one field' }
)
export type TemplateDiff = z.infer<typeof TemplateDiffSchema>

// ── PassTemplateUsage ─────────────────────────────────────────────────────────

export const PassTemplateUsageSchema = z.object({
  template_id:        z.string(),
  invocation_count:   z.number(),
  zero_repair_count:  z.number(),
  repair_count:       z.number(),
  gate_pass_rate:     z.number(),
  patch_count:        z.number(),
  last_invoked_at:    z.string().nullable(),
  last_repaired_at:   z.string().nullable(),
  last_patched_at:    z.string().nullable(),
  created_at:         z.string(),
})
export type PassTemplateUsage = z.infer<typeof PassTemplateUsageSchema>

// ── QualitySignal ─────────────────────────────────────────────────────────────

export const VerificationKindSchema = z.enum(['coherence', 'fidelity'])
export type VerificationKind = z.infer<typeof VerificationKindSchema>

export const SignalTypeSchema = z.enum([
  'coherence_failure',
  'fidelity_failure',
  'divergence_detected',
  'amendment_adopted',
  'amendment_rejected',
  'zero_repair',
])
export type SignalType = z.infer<typeof SignalTypeSchema>

export const VerdictSchema = z.enum(['favorable', 'unfavorable'])
export type Verdict = z.infer<typeof VerdictSchema>

export const QualitySignalSchema = z.object({
  id:                  z.string(), // QS-{uuid}
  run_id:              z.string(),
  verification_kind:   VerificationKindSchema,
  atom_id:             z.string().nullable(),
  task_kind:           z.string(),
  signal_type:         SignalTypeSchema,
  verdict:             VerdictSchema,
  repair_required:     z.number(), // 0 | 1
  repair_description:  z.string().nullable(),
  model_used:          z.string().nullable(),
  provider:            z.string().nullable(),
  latency_ms:          z.number().nullable(),
  token_cost_usd:      z.number().nullable(),
  artifact_graph_ref:  z.string().nullable(),
  recorded_at:         z.string(),
})
export type QualitySignal = z.infer<typeof QualitySignalSchema>

// ── RoutingPatch ──────────────────────────────────────────────────────────────

export const PatchStatusSchema = z.enum(['pending', 'applied', 'rejected'])
export type PatchStatus = z.infer<typeof PatchStatusSchema>

export const RoutingPatchSchema = z.object({
  id:                      z.string(), // RP-{uuid}
  proposed_at:             z.string(),
  status:                  PatchStatusSchema,
  evidence_window_runs:    z.number(),
  signal_summary:          z.string(), // JSON
  patches:                 z.string(), // JSON array of patch objects
  apply_command:           z.string(),
  applied_at:              z.string().nullable(),
  rejected_at:             z.string().nullable(),
  artifact_graph_ref:      z.string().nullable(),
})
export type RoutingPatch = z.infer<typeof RoutingPatchSchema>

// ── LLM Proposal (Phase 2 consolidation) ─────────────────────────────────────

export const LlmProposalBaseSchema = z.object({
  templateId: z.string(),
  rationale:  z.string(),
})

export const LlmConsolidateProposalSchema = LlmProposalBaseSchema.extend({
  action: z.literal('consolidate'),
  mergeInto: z.string(),
})
export type LlmConsolidateProposal = z.infer<typeof LlmConsolidateProposalSchema>

export const LlmPatchProposalSchema = LlmProposalBaseSchema.extend({
  action: z.literal('patch'),
  diff:   TemplateDiffSchema,
})
export type LlmPatchProposal = z.infer<typeof LlmPatchProposalSchema>

export const LlmRetireProposalSchema = LlmProposalBaseSchema.extend({
  action:       z.literal('retire'),
  retire_reason: z.string(),
})
export type LlmRetireProposal = z.infer<typeof LlmRetireProposalSchema>

export const LlmPinProposalSchema = LlmProposalBaseSchema.extend({
  action: z.literal('pin'),
})
export type LlmPinProposal = z.infer<typeof LlmPinProposalSchema>

export const LlmProposalSchema = z.discriminatedUnion('action', [
  LlmConsolidateProposalSchema,
  LlmPatchProposalSchema,
  LlmRetireProposalSchema,
  LlmPinProposalSchema,
])
export type LlmProposal = z.infer<typeof LlmProposalSchema>

// ── Crystallize ───────────────────────────────────────────────────────────────

export const CrystallizeActionSchema = z.enum(['created', 'patched', 'signals_only'])
export type CrystallizeAction = z.infer<typeof CrystallizeActionSchema>

export const CrystallizeResultSchema = z.object({
  templateId:  z.string().optional(),
  action:      CrystallizeActionSchema,
  signalCount: z.number(),
})
export type CrystallizeResult = z.infer<typeof CrystallizeResultSchema>

// ── Consolidation Report ──────────────────────────────────────────────────────

export const ConsolidationPhase1TransitionSchema = z.object({
  templateId:  z.string(),
  fromState:   PassTemplateStateSchema,
  toState:     PassTemplateStateSchema,
})
export type ConsolidationPhase1Transition = z.infer<typeof ConsolidationPhase1TransitionSchema>

export const ConsolidationReportSchema = z.object({
  id:                     z.string(),
  started_at:             z.string(),
  completed_at:           z.string(),
  phase1_transitions:     z.array(ConsolidationPhase1TransitionSchema),
  phase2_applied:         z.array(LlmProposalSchema),
  phase2_rejected:        z.array(z.object({
    proposal:  z.unknown(),
    reason:    z.string(),
  })),
  routing_patch_id:       z.string().nullable(),
  rollback_snapshot_key:  z.string(),
  summary:                z.string(),
})
export type ConsolidationReport = z.infer<typeof ConsolidationReportSchema>

// ── Status ────────────────────────────────────────────────────────────────────

export const DreamStatusSchema = z.object({
  templateCounts: z.object({
    active:  z.number(),
    stale:   z.number(),
    retired: z.number(),
    pinned:  z.number(),
  }),
  signalWindowSize:    z.number(),
  pendingPatches:      z.number(),
  lastConsolidation:   z.string().nullable(),
  activePipelines:     z.number(),
})
export type DreamStatus = z.infer<typeof DreamStatusSchema>

// ── RunVerdictSummary (passed from CoordinatorDO via crystallize) ─────────────

export const RunVerdictSummarySchema = z.object({
  coherenceVerdict: VerdictSchema,
  fidelityVerdict:  VerdictSchema,
  allBeadsDone:     z.boolean(),
  noDivergenceNodes: z.boolean(),
  allVerdictsFavorable: z.boolean(),
})
export type RunVerdictSummary = z.infer<typeof RunVerdictSummarySchema>

// ── Env interface for DreamDO ─────────────────────────────────────────────────

export interface Env {
  ARTIFACT_GRAPH: DurableObjectNamespace
  // LLM calls use CF Workers AI (bound as AI) or external via DEEPSEEK_API_KEY
  AI?: Ai
  DEEPSEEK_API_KEY?: string
  DREAM_CONSOLIDATION_INTERVAL_HOURS?: string
  DREAM_SIGNAL_WINDOW_RUNS?: string
}
