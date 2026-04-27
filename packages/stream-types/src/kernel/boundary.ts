// kernel/boundary.ts - Boundary object types (CB-01 through CB-04)
// Mirrors weops-enterprise/pkg/boundary/boundary.go

import type {
  BoundaryObjectType,
  Classification,
  ApprovalStatus,
  NarrativeRole,
  RedactionType,
  DeliveryChannel,
  KeyFactType,
  DeltaSentiment,
  VisualizationType,
} from "./enums";
import type { Provenance } from "./provenance";

// ---------------------------------------------------------------------------
// Shared base for all boundary objects
// ---------------------------------------------------------------------------
export interface BoundaryObjectBase {
  readonly type: BoundaryObjectType;
  readonly id: string;
  readonly workspace_id: string;
  readonly schema_version: string;
  readonly version: string;
  readonly classification: Classification;
  readonly owners: readonly string[];
  readonly evidence_refs?: readonly string[];
  readonly provenance?: Provenance;
}

// ---------------------------------------------------------------------------
// CB-01: Case Summary
// ---------------------------------------------------------------------------
export interface CaseSummary extends BoundaryObjectBase {
  readonly type: "CB-01";
  readonly work_order_id: string;
  readonly primary_purpose: string;
  readonly status: StatusInfo;
  readonly commitments?: readonly Commitment[];
  readonly open_questions?: readonly OpenQuestion[];
}

export interface StatusInfo {
  readonly current: string;
  readonly summary: string;
}

export interface Commitment {
  readonly description: string;
  readonly due_by?: string;
  readonly status?: string;
}

export interface OpenQuestion {
  readonly question: string;
  readonly raised_by?: string;
  readonly priority?: string;
}

// ---------------------------------------------------------------------------
// CB-02: Decision Memo
// ---------------------------------------------------------------------------
export interface DecisionMemo extends BoundaryObjectBase {
  readonly type: "CB-02";
  readonly work_order_id: string;
  readonly options: readonly Option[];
  readonly selected_option_id?: string;
  readonly rationale?: string;
  readonly approvals?: readonly BoundaryApproval[];
}

export interface Option {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tradeoffs?: Tradeoffs;
}

export interface Tradeoffs {
  readonly pros?: readonly string[];
  readonly cons?: readonly string[];
}

export interface BoundaryApproval {
  readonly by: string;
  readonly status: string;
  readonly timestamp?: string;
  readonly comment?: string;
}

// ---------------------------------------------------------------------------
// CB-03: Policy Bundle
// ---------------------------------------------------------------------------
export interface PolicyBundle extends BoundaryObjectBase {
  readonly type: "CB-03";
  readonly domain: string;
  readonly rules: readonly string[];
  readonly machine_rules_refs?: MachineRulesRef;
  readonly obligation_templates?: readonly ObligationTemplate[];
}

export interface MachineRulesRef {
  readonly format: string;
  readonly ref: string;
}

export interface ObligationTemplate {
  readonly type: string;
  readonly description?: string;
  readonly severity?: string;
}

// ---------------------------------------------------------------------------
// CB-04: Runbook
// ---------------------------------------------------------------------------
export interface Runbook extends BoundaryObjectBase {
  readonly type: "CB-04";
  readonly applies_to_purpose: string;
  readonly risk_tier: string;
  readonly preconditions?: readonly string[];
  readonly permitted_tools?: readonly string[];
  readonly steps: readonly RunbookStep[];
  readonly rollback?: RollbackConfig;
  readonly required_approvals?: readonly string[];
  readonly monitoring_signals?: readonly MonitorSignal[];
}

export interface RunbookStep {
  readonly order: number;
  readonly action: string;
  readonly tool?: string;
  readonly description?: string;
  readonly condition?: string;
}

export interface RollbackConfig {
  readonly strategy: string;
  readonly steps?: readonly string[];
}

export interface MonitorSignal {
  readonly name: string;
  readonly threshold?: string;
  readonly action?: string;
}

// ---------------------------------------------------------------------------
// CB-05: Narrative Record & Delivery (boundary.go)
// ---------------------------------------------------------------------------

/** A key fact within a narrative step.
 *  baseline_value, delta, and delta_sentiment are optional — when present,
 *  the UI renders a comparative indicator (e.g. "23% → 8% (-15%)").
 *  delta_sentiment is set by the domain assembly (generator), NOT interpreted
 *  by the kernel or frontend. */
export interface KeyFact {
  readonly label: string;
  readonly value: string;
  readonly fact_type: KeyFactType;
  readonly baseline_value?: string;
  readonly delta?: string;
  readonly delta_sentiment?: DeltaSentiment;
}

/** Reference to a source field in the originating boundary object */
export interface FieldRef {
  readonly source_schema: string;
  readonly field_path: string;
  readonly display_label: string;
}

/** Metadata about summary generation quality */
export interface SummaryMetadata {
  readonly generation_attempts: number;
  readonly summary_truncated: boolean;
  readonly original_length: number;
  readonly truncation_point: number | null;
}

/** Optional rendering hint for a narrative step.
 *  Type and config are set by the domain assembly (generator) — the kernel
 *  stores them opaque, the frontend renders based on type.
 *  Supported types: sparkline, bar, gauge, progress, icon_set. */
export interface StepVisualization {
  readonly type: VisualizationType;
  readonly label?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Interaction hints for the UI */
export interface StepInteraction {
  readonly expandable: boolean;
  readonly drill_down_refs: readonly string[];
}

/** Immutable audit lock on a narrative record */
export interface AuditLock {
  readonly locked: boolean;
  readonly locked_at: string | null;
  readonly source_hash: string;
  readonly ledger_entry_id: string | null;
  readonly prose_nondeterminism_acknowledged: boolean;
}

/** Target format for rendering */
export interface RenderingTarget {
  readonly format: DeliveryChannel;
  readonly config: Readonly<Record<string, unknown>>;
}

/** Record of a redacted field within a delivery */
export interface RedactionRecord {
  readonly step_index: number;
  readonly field_path: string;
  readonly policy_reason: string;
  readonly redaction_type: RedactionType;
}

/** A single step in the narrative (one of 4: CONTEXT, SIGNAL, OPTIONS, RESOLUTION) */
export interface NarrativeStep {
  readonly step_index: number;
  readonly label: string;
  readonly narrative_role: NarrativeRole;
  readonly field_refs: readonly FieldRef[];
  readonly generated_summary: string;
  readonly key_facts: readonly KeyFact[];
  readonly evidence_refs: readonly string[];
  readonly visualizations?: readonly StepVisualization[];
  readonly interaction: StepInteraction;
  readonly summary_metadata: SummaryMetadata;
}

/** CB-05-R: The raw rendered narrative — pre-redaction, pre-delivery targeting */
export interface NarrativeRecord extends BoundaryObjectBase {
  readonly type: "CB-05-R";
  readonly source_work_order_id: string;
  readonly source_boundary_objects?: readonly string[];
  readonly source_policy_decisions?: readonly string[];
  readonly steps: readonly NarrativeStep[];
  readonly audit_lock: AuditLock;
  readonly rendering_target: RenderingTarget;
  readonly generated_by: string;
  readonly audience_role?: string;
}

/** CB-05-D: Audience-targeted delivery of a narrative, with redactions applied */
export interface NarrativeDelivery extends BoundaryObjectBase {
  readonly type: "CB-05-D";
  readonly source_record_id: string;
  readonly audience_role: string;
  readonly policy_decision_id: string;
  readonly steps: readonly NarrativeStep[];
  readonly redacted_fields: readonly RedactionRecord[];
  readonly delivered_at: string;
  readonly delivery_channel: string;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/** Type guard: is this a NarrativeRecord (CB-05-R)? */
export function isNarrativeRecord(bo: BoundaryObject): bo is NarrativeRecord {
  return bo.type === "CB-05-R";
}

/** Type guard: is this a NarrativeDelivery (CB-05-D)? */
export function isNarrativeDelivery(bo: BoundaryObject): bo is NarrativeDelivery {
  return bo.type === "CB-05-D";
}

// ---------------------------------------------------------------------------
// Union of all boundary object types
// ---------------------------------------------------------------------------
export type BoundaryObject = CaseSummary | DecisionMemo | PolicyBundle | Runbook | NarrativeRecord | NarrativeDelivery;
