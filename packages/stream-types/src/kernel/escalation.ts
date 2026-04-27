// kernel/escalation.ts - Governance escalation types
// Mirrors weops-enterprise/pkg/governance/escalation.go

import type {
  GovernanceLevel,
  EscalationTriggerType,
  EscalationStatus,
} from "./enums";

export interface GovernanceEscalation {
  readonly escalation_id: string;
  readonly workspace_id: string;
  readonly current_level: GovernanceLevel;
  readonly requested_level: GovernanceLevel;
  readonly trigger: EscalationTrigger;
  readonly status: EscalationStatus;
  readonly applied_at?: string;
  readonly schema_version: string;
}

export interface EscalationTrigger {
  readonly trigger_type: EscalationTriggerType;
  readonly trigger_details?: Record<string, unknown>;
  readonly policy_decision_id?: string;
}
