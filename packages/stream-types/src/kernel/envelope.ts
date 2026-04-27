// kernel/envelope.ts - Universal request/response envelope
// Mirrors weops-enterprise/pkg/envelope/envelope.go

import type {
  Channel,
  DeviceClass,
  Role,
  IntentType,
  GovernanceLevel,
  AutonomyTier,
  RiskTier,
  Classification,
  ResponseStatus,
  PDPDecision,
} from "./enums";
import type { Obligation } from "./policy";

// ---------------------------------------------------------------------------
// Request envelope types
// ---------------------------------------------------------------------------

export interface Envelope {
  readonly envelope_id: string;
  readonly correlation_id: string;
  readonly timestamp: string;
  readonly source: ChannelSource;
  readonly session: SessionContext;
  readonly intent: Intent;
  readonly constraint_ctx: ConstraintContext;
}

export interface ChannelSource {
  readonly channel: Channel;
  readonly channel_version?: string;
  readonly device_class: DeviceClass;
  readonly capabilities?: readonly string[];
}

export interface SessionContext {
  readonly session_id: string;
  readonly identity_id: string;
  readonly workspace_id: string;
  readonly active_role: Role;
  readonly product_assembly?: string;
}

export interface Intent {
  readonly intent_type: IntentType;
  readonly payload: Record<string, unknown>;
}

export interface ConstraintContext {
  readonly governance_level: GovernanceLevel;
  readonly autonomy_tier: AutonomyTier;
  readonly risk_tier: RiskTier;
  readonly purpose: string;
  readonly classification: Classification;
}

// ---------------------------------------------------------------------------
// Response envelope types
// ---------------------------------------------------------------------------

export interface EnvelopeResponse {
  readonly envelope_id: string;
  readonly correlation_id: string;
  readonly timestamp: string;
  readonly status: ResponseStatus;
  readonly governance_applied?: GovernanceApplied;
  readonly result?: Record<string, unknown>;
  readonly evidence_refs?: readonly string[];
  readonly obligations?: readonly Obligation[];
  readonly errors?: readonly EnvelopeError[];
}

export interface GovernanceApplied {
  readonly effective_level: GovernanceLevel;
  readonly pdp_evaluated: boolean;
  readonly decision: PDPDecision;
  readonly policy_decision_id?: string;
  readonly escalation_id?: string;
}

export interface EnvelopeError {
  readonly code: string;
  readonly message: string;
}
