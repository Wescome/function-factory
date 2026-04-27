// kernel/pdp.ts - Policy Decision Point types
// Mirrors weops-enterprise/pkg/pdp/pdp.go

import type { DecisionRequest, DecisionResponse } from "./policy";
import type { PDPDecision, AutonomyTier, RiskTier, ConflictRule } from "./enums";
import type { Purpose } from "./taxonomy";

export interface EvaluationRequest extends DecisionRequest {
  readonly work_order?: WorkOrderContext;
}

export interface EvaluationResult extends DecisionResponse {
  readonly field_decisions?: readonly FieldDecision[];
  readonly matched_rules?: readonly string[];
}

export interface FieldDecision {
  readonly field: string;
  readonly decision: PDPDecision;
  readonly reason_code?: string;
  readonly detail?: string;
}

export interface WorkOrderContext {
  readonly autonomy_tier: AutonomyTier;
  readonly risk_tier: RiskTier;
  readonly primary_purpose: Purpose;
  readonly stakeholder_constraints?: readonly string[];
  readonly decision_rule_on_conflict?: ConflictRule;
  readonly break_glass?: boolean;
  readonly incident_state?: boolean;
  readonly requested_fields?: readonly string[];
}
