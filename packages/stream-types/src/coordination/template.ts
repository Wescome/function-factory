// coordination/template.ts - Workspace template schema types (WP-0.12)

import type { GovernanceLevel, DomainContextID } from "../kernel/enums";
import type { TemplateID } from "../kernel/ids";

// ---------------------------------------------------------------------------
// Infrastructure Profile
// ---------------------------------------------------------------------------
export type InfrastructureProfile = "LOCAL_SQLITE" | "MANAGED_PG" | "ISOLATED_VPC" | "FEDRAMP_HSM";
export const INFRASTRUCTURE_PROFILE_VALUES = ["LOCAL_SQLITE", "MANAGED_PG", "ISOLATED_VPC", "FEDRAMP_HSM"] as const;

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------
export interface GovernanceLevelRange {
  readonly min: GovernanceLevel;
  readonly max: GovernanceLevel;
}

export interface ResourceDefaults {
  readonly storage_bytes?: number;
  readonly compute_budget_cents?: number;
  readonly api_rate_per_minute?: number;
}

// ---------------------------------------------------------------------------
// Workspace Template (WP-0.12)
// ---------------------------------------------------------------------------
export interface WorkspaceTemplate {
  readonly template_id: TemplateID;
  readonly template_name: string;
  readonly product_assembly?: string;
  readonly governance_level: GovernanceLevel;
  readonly governance_level_range?: GovernanceLevelRange;
  readonly domain_contexts: readonly DomainContextID[];
  readonly purpose_scope: readonly string[];
  readonly default_policy_bundles: readonly string[];
  readonly resource_defaults?: ResourceDefaults;
  readonly infrastructure_profile: InfrastructureProfile;
  readonly ui_skin?: string;
  readonly version: string;
  readonly schema_version: "1.0.0";
}
