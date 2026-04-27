// stream/data-parts.ts - WGSP §5-§6 data part type definitions
// These are the stream-facing types sent over SSE to frontend clients.
// They project kernel types into the Vercel AI SDK data part convention.

import type {
  WorkOrderStatus,
  AutonomyTier,
  RiskTier,
  ConflictRule,
  ApprovalStatus,
  PDPDecision,
  ObligationType,
  EscalationTriggerType,
} from "../kernel/enums";

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

/** WGSP §6: Escalation rungs 0-6 */
export type EscalationRung = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** WGSP §3.3: Compensation sub-states within COMPENSATING */
export type CompensationSubState =
  | "COMPENSATION_ACTIVE"
  | "COMPENSATION_PENDING"
  | "COMPENSATION_ESCALATED"
  | "COMPENSATION_DISPUTED"
  | "COMPENSATION_COMPLETE";

// ---------------------------------------------------------------------------
// data-workorder
// ---------------------------------------------------------------------------

export interface PendingApproval {
  type: string;
  status: ApprovalStatus;
  required_role: string;
  approver_ref: string | null;
  granted_at: string | null;
}

export interface WorkOrderDataPart {
  work_order_id: string;
  parent_work_order_id: string | null;
  status: WorkOrderStatus;
  primary_purpose: string;
  acting_role: string;
  stakeholders: string[];
  autonomy_tier: AutonomyTier;
  risk_tier: RiskTier;
  decision_rule_on_conflict: ConflictRule;
  compensation_sub_state: CompensationSubState | null;
  pending_approvals: PendingApproval[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-governance
// ---------------------------------------------------------------------------

export interface PolicyReason {
  code: string;
  severity: "INFO" | "WARNING" | "ERROR";
  summary: string;
  detail: string;
  next_steps: string | null;
}

export interface PolicyObligation {
  type: ObligationType;
  value: Record<string, unknown>;
  satisfied: boolean;
}

export interface GovernanceDataPart {
  policy_decision_id: string;
  decision: PDPDecision;
  reasons: PolicyReason[];
  obligations: PolicyObligation[];
  escalation_rung: EscalationRung | null;
  escalation_trigger: EscalationTriggerType | null;
  work_order_id: string;
  invocation_id: string | null;
  tool_id: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-planvalidation
// ---------------------------------------------------------------------------

export type PlanDimensionName =
  | "ORDERING_DEPENDENCIES"
  | "AGGREGATE_COST"
  | "DATA_FLOW_MINIMIZATION"
  | "COMPENSATION_COVERAGE"
  | "CONSTRAINT_SATISFACTION"
  | "RISK_ASSESSMENT";

export interface PlanDimension {
  dimension: PlanDimensionName;
  result: "PASS" | "FAIL";
  details: string;
}

export interface PlanValidationDataPart {
  pvr_id: string;
  work_order_id: string;
  plan_hash: string;
  result: "VALID" | "INVALID";
  dimensions: PlanDimension[];
  compliance_certificate: string | null;
  re_planning_attempt: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-execution
// ---------------------------------------------------------------------------

export type ExecutionPhase =
  | "PRE_EXECUTION"
  | "EXECUTING"
  | "MID_CHECKPOINT"
  | "COMPENSATING"
  | "COMPLETE";

export interface ExecutionStep {
  step_index: number;
  tool_id: string;
  tool_label: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "COMPENSATED" | "SKIPPED";
  invocation_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  output_summary: string | null;
}

export interface TemporalState {
  plan_start_time: string;
  elapsed_ms: number;
  estimated_remaining_ms: number;
  tightest_deadline: string | null;
  deadline_margin_ms: number | null;
}

export interface ExecutionDataPart {
  work_order_id: string;
  plan_hash: string;
  phase: ExecutionPhase;
  current_step_index: number;
  total_steps: number;
  steps: ExecutionStep[];
  temporal: TemporalState;
  compensation_sub_state: CompensationSubState | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-escalation
// ---------------------------------------------------------------------------

export interface EscalationAction {
  action_type: string;
  target_role: string;
  description: string;
  completed: boolean;
}

export interface EscalationDataPart {
  escalation_id: string;
  work_order_id: string;
  rung: EscalationRung;
  rung_name: string;
  trigger: EscalationTriggerType;
  trigger_detail: string;
  required_actions: EscalationAction[];
  resolved: boolean;
  resolved_at: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-reasoning
// ---------------------------------------------------------------------------

export interface ToolConsideration {
  tool_id: string;
  tool_label: string;
  selected: boolean;
  reason: string;
  constraint_impact: string[];
}

export interface ReasoningDataPart {
  trace_id: string;
  work_order_id: string;
  granularity: "STRUCTURED" | "PARSED" | "OPAQUE";
  tools_considered: ToolConsideration[];
  constraints_referenced: string[];
  plan_justification: string;
  confidence_signals: Record<string, number>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-drift
// ---------------------------------------------------------------------------

export type DriftSignalCategory =
  | "POLICY"
  | "BEHAVIORAL"
  | "SKILL"
  | "PERFORMANCE"
  | "ESCALATION"
  | "EVIDENCE";

export interface DriftDataPart {
  alert_id: string;
  signal_category: DriftSignalCategory;
  metric: string;
  current_value: number;
  baseline_value: number;
  threshold: number;
  severity: "WARNING" | "CRITICAL";
  contributing_invocations: string[];
  automated_response: { action: string; details: string } | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-knowledge-search
// ---------------------------------------------------------------------------

export interface KnowledgeSearchHit {
  chunk_id: string;
  corpus_id: string;
  document: string;
  score: number;
  text: string;
  metadata: Record<string, unknown> | null;
}

export interface KnowledgeSearchDataPart {
  query_id: string;
  query: string;
  total_found: number;
  results: KnowledgeSearchHit[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-knowledge-graph
// ---------------------------------------------------------------------------

export interface GraphEntity {
  entity_id: string;
  entity_type: string;
  label: string;
  description: string | null;
  corpus_id: string;
}

export interface GraphRelationship {
  source_id: string;
  target_id: string;
  relation: string;
  evidence: string | null;
}

export interface KnowledgeGraphDataPart {
  query_id: string;
  query: string;
  mode: "local" | "global";
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  community_summaries: string[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-knowledge-ontology
// ---------------------------------------------------------------------------

export interface CanonicalTermResult {
  code: string;
  scheme: string;
  label: string;
  definition: string | null;
}

export interface TermAliasResult {
  code: string;
  scheme: string;
  label: string;
}

export interface RelatedTermResult {
  relation: string;
  code: string;
  scheme: string;
  label: string;
}

export interface KnowledgeOntologyDataPart {
  query_id: string;
  input_term: string;
  canonical: CanonicalTermResult;
  aliases: TermAliasResult[];
  related: RelatedTermResult[];
  confidence: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-decision-lifecycle (DEL §4.1 — Governance Lifecycle)
// ---------------------------------------------------------------------------

/** DEL decision strata — the organizational layer at which a decision operates */
export type DecisionStratum = "strategic" | "tactical" | "operational" | "reflexive";

/** DEL decision lifecycle status */
export type DecisionLifecycleStatus =
  | "pending"
  | "active"
  | "resolved"
  | "deferred"
  | "escalated"
  | "expired";

/** DEL principal — an entity that can hold decision authority */
export interface DecisionPrincipal {
  type: "role" | "agent" | "committee" | "system" | "individual";
  identifier: string;
  display_name?: string;
}

/** DEL constraint summary (projected from GIVEN clause) */
export interface DecisionConstraintSummary {
  type: "policy" | "regulatory" | "budgetary" | "temporal" | "technical" | "ethical";
  description: string;
  enforcement: "hard" | "soft";
  passed: boolean | null;
}

/** DEL sub-decision reference (projected from DECOMPOSE clause) */
export interface DecisionSubRef {
  id: string;
  intent: string;
  status: DecisionLifecycleStatus;
}

/** DEL outcome (projected from YIELD clause) */
export interface DecisionOutcomeSummary {
  value: string;
  rationale: string;
  effects: string[];
}

/**
 * Stream-facing projection of a DEL expression lifecycle event.
 * Carries the key fields from each clause that a frontend needs
 * to render the decision tree visually.
 *
 * Maps to DEL spec §4.1 governance lifecycle:
 * Intent → Envelope → Decision → [Commitment → Receipt] → Observation
 */
export interface DecisionLifecycleDataPart {
  /** DEL expression ID (from DECIDE clause) */
  decision_id: string;
  /** Natural language statement of what is being decided */
  intent: string;
  /** Organizational layer: strategic, tactical, operational, reflexive */
  stratum: DecisionStratum;
  /** Organizational domain (e.g., clinical, finance, engineering) */
  domain: string;
  /** Decision urgency */
  urgency: "critical" | "high" | "standard" | "low" | "deferred";
  /** Current lifecycle status */
  status: DecisionLifecycleStatus;
  /** The entity authorized to resolve this decision (from WHERE clause) */
  authority: DecisionPrincipal;
  /** The entity that delegated authority, if any */
  delegated_from: DecisionPrincipal | null;
  /** Constraint evaluation summary (from GIVEN clause) */
  constraints: DecisionConstraintSummary[];
  /** Number of facts evaluated */
  facts_count: number;
  /** Whether preconditions are satisfied (from WHEN clause) */
  preconditions_met: boolean | null;
  /** Deadline if any (from WHEN clause) */
  deadline: string | null;
  /** Sub-decisions if decomposed (from DECOMPOSE clause) */
  sub_decisions: DecisionSubRef[];
  /** Outcome if resolved (from YIELD clause) */
  outcome: DecisionOutcomeSummary | null;
  /** Decision confidence score (0.0-1.0) */
  confidence: number | null;
  /** The entity that resolved the decision */
  resolved_by: DecisionPrincipal | null;
  /** Resolution timestamp */
  resolved_at: string | null;
  /** Audit level: full, summary, minimal */
  audit_level: "full" | "summary" | "minimal";
  /** Parent decision ID if this is a sub-decision */
  parent_decision_id: string | null;
  /** Work order this decision is correlated with, if any */
  work_order_id: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// data-model-resolution (AOMA P13 — Model Resolution Protocol)
// ---------------------------------------------------------------------------

/** P13 cost tier */
export type ModelCostTier = "economy" | "standard" | "premium" | "frontier";

/** P13 latency tier */
export type ModelLatencyTier = "realtime" | "standard" | "batch";

/** P13 provider binding basis */
export type BindingBasis = "POLICY_RESOLVED" | "OPERATOR_OVERRIDE" | "FALLBACK_DEFAULT";

/** P13 elimination log entry — why a provider was rejected */
export interface ModelEliminationEntry {
  provider_id: string;
  eliminated_at_phase: string;
  reason: string;
  detail: string;
}

/** P13 scoring log entry — surviving candidate's score */
export interface ModelScoringEntry {
  provider_id: string;
  score: number;
}

/** Stream-facing projection of a P13 model resolution decision */
export interface ModelResolutionDataPart {
  resolution_id: string;
  work_order_id: string;
  /** The selected provider, null if resolution failed */
  provider_id: string | null;
  /** The selected model, null if resolution failed */
  model_id: string | null;
  /** How the binding was determined */
  binding_basis: BindingBasis | null;
  /** Resolution score (0-100) */
  resolution_score: number | null;
  /** Cost tier of selected provider */
  cost_tier: ModelCostTier | null;
  /** Latency tier of selected provider */
  latency_tier: ModelLatencyTier | null;
  /** Number of providers eliminated */
  eliminated_count: number;
  /** Total providers considered */
  total_considered: number;
  /** Compliance certifications matched */
  compliance_matched: string[];
  /** Elimination log for transparency */
  elimination_log: ModelEliminationEntry[];
  /** Scoring log for surviving candidates */
  scoring_log: ModelScoringEntry[];
  /** Whether resolution succeeded */
  resolved: boolean;
  /** Failure reason if not resolved */
  failure_reason: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Discriminated union of all WGSP data parts (WGSP §5.1)
// ---------------------------------------------------------------------------

export type WeOpsDataPart =
  | { type: "data-workorder"; id: string; data: WorkOrderDataPart }
  | { type: "data-governance"; data: GovernanceDataPart; transient?: boolean }
  | { type: "data-planvalidation"; id: string; data: PlanValidationDataPart }
  | { type: "data-execution"; id: string; data: ExecutionDataPart }
  | { type: "data-escalation"; id: string; data: EscalationDataPart }
  | { type: "data-reasoning"; id: string; data: ReasoningDataPart; transient?: boolean }
  | { type: "data-drift"; data: DriftDataPart; transient: true }
  | { type: "data-knowledge-search"; id: string; data: KnowledgeSearchDataPart }
  | { type: "data-knowledge-graph"; id: string; data: KnowledgeGraphDataPart }
  | { type: "data-knowledge-ontology"; id: string; data: KnowledgeOntologyDataPart }
  | { type: "data-decision-lifecycle"; id: string; data: DecisionLifecycleDataPart }
  | { type: "data-model-resolution"; id: string; data: ModelResolutionDataPart };
