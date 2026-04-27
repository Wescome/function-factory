// kernel/workorder.ts - Work Order types and state machine
// Mirrors weops-enterprise/pkg/workorder/workorder.go

import type {
  WorkOrderStatus,
  ApprovalStatus,
  ConflictRule,
  AutonomyTier,
  RiskTier,
  Role,
} from "./enums";
import type { Provenance } from "./provenance";
import type { Purpose } from "./taxonomy";

export interface WorkOrder {
  readonly work_order_id: string;
  readonly workspace_id: string;
  readonly schema_version: string;
  readonly version: string;
  readonly parent_work_order_id?: string;
  readonly primary_purpose: Purpose;
  readonly acting_role: string;
  readonly stakeholders: readonly string[];
  readonly stakeholder_constraints?: readonly string[];
  readonly decision_rule_on_conflict?: ConflictRule;
  readonly autonomy_tier: AutonomyTier;
  readonly risk_tier: RiskTier;
  readonly scope?: Scope;
  readonly status: WorkOrderStatus;
  readonly required_approvals?: readonly Approval[];
  readonly evidence_refs?: readonly string[];
  readonly timeline?: readonly TimelineEntry[];
  readonly provenance?: Provenance;
}

export interface Scope {
  readonly allowed_patient_contexts?: readonly string[];
  readonly allowed_outputs?: readonly string[];
  readonly expires_at?: string;
}

export interface Approval {
  readonly type: string;
  readonly status: ApprovalStatus;
  readonly by?: string;
  readonly timestamp?: string;
}

export interface TimelineEntry {
  readonly timestamp: string;
  readonly event: string;
  readonly actor?: string;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// State machine: allowed transitions map
// ---------------------------------------------------------------------------
export const ALLOWED_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVAL_PENDING", "DRAFT"],
  APPROVAL_PENDING: ["APPROVED", "IN_REVIEW"],
  APPROVED: ["RUNNING"],
  RUNNING: ["COMPLETED", "FAILED"],
  FAILED: ["COMPENSATING", "FAILED_FINAL"],
  COMPENSATING: ["FAILED_FINAL", "COMPLETED"],
  COMPLETED: [],
  FAILED_FINAL: [],
};
