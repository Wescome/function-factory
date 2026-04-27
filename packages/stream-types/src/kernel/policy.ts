// kernel/policy.ts - ABAC policy decision types
// Mirrors weops-enterprise/pkg/policy/policy.go

import type {
  PDPDecision,
  Classification,
  Environment,
  ObligationType,
  Severity,
} from "./enums";

export interface DecisionRequest {
  readonly subject: Subject;
  readonly action: Action;
  readonly resource: Resource;
  readonly context: RequestContext;
}

export interface Subject {
  readonly id: string;
  readonly claims: SubjectClaims;
}

export interface SubjectClaims {
  readonly role: string;
  readonly department?: string;
  readonly clearance?: string;
  readonly training_status?: string;
}

export interface Action {
  readonly type: string;
  readonly tool?: string;
}

export interface Resource {
  readonly classification?: Classification;
  readonly system?: string;
  readonly record_type?: string;
}

export interface RequestContext {
  readonly purpose: string;
  readonly environment?: Environment;
  readonly work_order_id: string;
  readonly workspace_id?: string;
  readonly incident_state: boolean;
}

export interface DecisionResponse {
  readonly policy_decision_id: string;
  readonly decision: PDPDecision;
  readonly reasons: readonly string[];
  readonly obligations?: readonly Obligation[];
  readonly escalation_rung?: number;
  readonly evaluated_at: string;
  readonly policy_version?: string;
}

export interface Obligation {
  readonly type: ObligationType;
  readonly value?: unknown;
  readonly severity?: Severity;
}
