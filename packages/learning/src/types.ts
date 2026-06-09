import { z } from "zod"
import { ArtifactId, Explicitness } from "@factory/schemas"

const DateTime = z.string().datetime()

const SourceRefs = z.array(ArtifactId).min(1)

export const VerificationResultSummary = z.object({
  verification: z.string().min(1),
  passed: z.boolean(),
  report_id: ArtifactId.optional(),
  summary: z.string().optional(),
})
export type VerificationResultSummary = z.infer<typeof VerificationResultSummary>

export const RepairLogEntry = z.object({
  kind: z.string().min(1),
  summary: z.string().min(1),
  explicitness: Explicitness,
  rationale: z.string().min(1),
})
export type RepairLogEntry = z.infer<typeof RepairLogEntry>

export const ModelRoleTelemetry = z.object({
  role: z.string().min(1),
  model: z.string().min(1),
  task_kind: z.string().min(1).optional(),
  latency_ms: z.number().int().nonnegative().optional(),
  token_usage: z.number().int().nonnegative().optional(),
  outcome: z.string().min(1).optional(),
})
export type ModelRoleTelemetry = z.infer<typeof ModelRoleTelemetry>

export const FinalVerdict = z.object({
  status: z.string().min(1),
  reason: z.string().optional(),
  synthesis_decision: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})
export type FinalVerdict = z.infer<typeof FinalVerdict>

export const RunTranscript = z.object({
  _key: z.string().min(1).optional(),
  run_id: z.string().min(1),
  signal_id: ArtifactId.optional(),
  pressure_id: ArtifactId.optional(),
  capability_id: ArtifactId.optional(),
  proposal_id: ArtifactId.optional(),
  intent_specification_id: ArtifactId.optional(),
  executable_specification_id: ArtifactId.optional(),
  trellis_execution_packet_id: ArtifactId.optional(),
  trellis_execution_packet_hash: z.string().min(1).optional(),
  verification_results: z.array(VerificationResultSummary).default([]),
  repair_count: z.number().int().nonnegative(),
  repair_log: z.array(RepairLogEntry).default([]),
  atom_results: z.record(z.unknown()).optional(),
  model_role_telemetry: z.array(ModelRoleTelemetry).default([]),
  final_verdict: FinalVerdict,
  terminal_state: z.string().min(1),
  source_refs: SourceRefs,
  explicitness: Explicitness,
  rationale: z.string().min(1),
  created_at: DateTime,
})
export type RunTranscript = z.infer<typeof RunTranscript>

export const LearningObservationKind = z.enum([
  "terminal_verdict",
  "verification_block",
  "verification_pass",
  "zero_repair_completion",
  "repair_required",
  "model_role_outcome",
  "template_candidate_usage",
])
export type LearningObservationKind = z.infer<typeof LearningObservationKind>

export const LearningObservation = z.object({
  _key: z.string().min(1).optional(),
  observation_id: z.string().min(1),
  run_id: z.string().min(1),
  kind: LearningObservationKind,
  fact: z.record(z.unknown()),
  explicitness: Explicitness,
  rationale: z.string().min(1),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type LearningObservation = z.infer<typeof LearningObservation>

export const TemplateCandidateState = z.enum([
  "candidate",
  "pending_approval",
  "approved",
  "retired",
])
export type TemplateCandidateState = z.infer<typeof TemplateCandidateState>

export const TemplateCandidate = z.object({
  _key: z.string().min(1).optional(),
  template_candidate_id: z.string().min(1),
  state: TemplateCandidateState,
  executable_specification_id: ArtifactId,
  evidence_run_ids: z.array(z.string().min(1)).min(1),
  evidence_summary: z.string().min(1),
  explicitness: Explicitness,
  rationale: z.string().min(1),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type TemplateCandidate = z.infer<typeof TemplateCandidate>

export const TemplateUsage = z.object({
  _key: z.string().min(1).optional(),
  template_candidate_id: z.string().min(1),
  run_id: z.string().min(1),
  outcome: z.enum(["used", "skipped", "rejected"]),
  reason: z.string().min(1),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type TemplateUsage = z.infer<typeof TemplateUsage>

export const RoutingObservation = z.object({
  _key: z.string().min(1).optional(),
  run_id: z.string().min(1),
  task_kind: z.string().min(1),
  model: z.string().min(1),
  outcome: z.string().min(1),
  latency_ms: z.number().int().nonnegative().optional(),
  token_usage: z.number().int().nonnegative().optional(),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type RoutingObservation = z.infer<typeof RoutingObservation>

const GovernanceState = z.enum(["pending", "approved", "rejected", "applied", "rolled_back"])

export const RoutingProposal = z.object({
  _key: z.string().min(1).optional(),
  proposal_id: z.string().min(1),
  task_kind: z.string().min(1),
  current_model: z.string().min(1),
  proposed_model: z.string().min(1),
  evidence_window: z.object({
    started_at: DateTime,
    ended_at: DateTime,
    sample_count: z.number().int().positive(),
  }),
  evidence_summary: z.string().min(1),
  requested_by: z.string().min(1),
  state: GovernanceState,
  reviewer: z.string().min(1).optional(),
  decision_rationale: z.string().min(1).optional(),
  apply_target: z.string().min(1).optional(),
  mutation_batch_id: z.string().min(1).optional(),
  rollback_ref: z.string().min(1).optional(),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type RoutingProposal = z.infer<typeof RoutingProposal>

export const TemplatePromotionRequest = z.object({
  _key: z.string().min(1).optional(),
  request_id: z.string().min(1),
  template_candidate_id: z.string().min(1),
  requested_by: z.string().min(1),
  requested_at: DateTime,
  state: GovernanceState,
  evidence_refs: SourceRefs,
  reviewer: z.string().min(1).optional(),
  reviewed_at: DateTime.optional(),
  decision_rationale: z.string().min(1).optional(),
  apply_target: z.string().min(1).optional(),
  mutation_batch_id: z.string().min(1).optional(),
  rollback_ref: z.string().min(1).optional(),
  source_refs: SourceRefs,
})
export type TemplatePromotionRequest = z.infer<typeof TemplatePromotionRequest>

export const ConsolidationReport = z.object({
  _key: z.string().min(1).optional(),
  report_id: z.string().min(1),
  summary: z.string().min(1),
  candidate_count: z.number().int().nonnegative(),
  mutation_count: z.number().int().nonnegative(),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type ConsolidationReport = z.infer<typeof ConsolidationReport>

export const MutationJournalEntry = z.object({
  _key: z.string().min(1).optional(),
  mutation_batch_id: z.string().min(1),
  actor: z.string().min(1),
  affected_collection: z.string().min(1),
  affected_key: z.string().min(1),
  before_image: z.record(z.unknown()),
  after_image: z.record(z.unknown()),
  source_refs: SourceRefs,
  created_at: DateTime,
})
export type MutationJournalEntry = z.infer<typeof MutationJournalEntry>
