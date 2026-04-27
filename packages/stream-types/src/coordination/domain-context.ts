// coordination/domain-context.ts - Domain context manifest schema types (WP-0.15)

import type { GovernanceLevel, DomainContextID } from "../kernel/enums";

// ---------------------------------------------------------------------------
// Compensation Type
// ---------------------------------------------------------------------------
export type CompensationType = "REVERSE" | "REFUND" | "RETRACT" | "INVALIDATE" | "MANUAL" | "NOTIFY_ONLY";
export const COMPENSATION_TYPE_VALUES = ["REVERSE", "REFUND", "RETRACT", "INVALIDATE", "MANUAL", "NOTIFY_ONLY"] as const;

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------
export interface CompensationDeclaration {
  readonly compensation_tool: string;
  readonly compensation_type: CompensationType;
  readonly param_map?: Record<string, unknown>;
}

export interface Capability {
  readonly capability_id: string;
  readonly tool_schema_ref: string;
  readonly purpose_binding?: readonly string[];
  readonly min_governance_level?: GovernanceLevel;
  readonly compensation_declaration?: CompensationDeclaration;
}

export interface EventDeclaration {
  readonly event_type: string;
  readonly schema_ref: string;
}

export interface EventSubscription {
  readonly event_type: string;
  readonly handler: string;
}

export interface ResourceRequirements {
  readonly memory_mb?: number;
  readonly cold_start_budget_ms?: number;
}

// ---------------------------------------------------------------------------
// Domain Context Manifest (WP-0.15)
// ---------------------------------------------------------------------------
export interface DomainContextManifest {
  readonly context_id: DomainContextID;
  readonly context_name: string;
  readonly capabilities: readonly Capability[];
  readonly events_published: readonly EventDeclaration[];
  readonly events_consumed: readonly EventSubscription[];
  readonly resource_requirements?: ResourceRequirements;
  readonly version: string;
  readonly schema_version: "1.0.0";
}
