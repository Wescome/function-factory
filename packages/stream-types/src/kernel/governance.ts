// kernel/governance.ts - Governance profile types and defaults
// Mirrors weops-enterprise/pkg/governance/governance.go

import type {
  GovernanceLevel,
  PDPMode,
  EvidenceMode,
  EscalationMode,
  IsolationLevel,
  AutonomyTier,
} from "./enums";

export interface GovernanceProfile {
  readonly governance_level: GovernanceLevel;
  readonly enforcement_config: EnforcementConfig;
  readonly escalation_overrides?: readonly EscalationOverride[];
  readonly schema_version: string;
}

export interface EnforcementConfig {
  readonly pdp_mode: PDPMode;
  readonly evidence_mode: EvidenceMode;
  readonly escalation_mode: EscalationMode;
  readonly isolation_level: IsolationLevel;
  readonly autonomy_tier_cap: AutonomyTier;
  readonly purpose_binding_required: boolean;
  readonly boundary_objects_required: boolean;
  readonly work_order_required: boolean;
}

export interface EscalationOverride {
  readonly trigger: string;
  readonly min_governance_level: GovernanceLevel;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Default profiles for G0-G3 (matches Go DefaultProfiles())
// ---------------------------------------------------------------------------
export const DEFAULT_PROFILES: Readonly<Record<GovernanceLevel, GovernanceProfile>> = {
  G0: {
    governance_level: "G0",
    enforcement_config: {
      pdp_mode: "DISABLED",
      evidence_mode: "DISABLED",
      escalation_mode: "DISABLED",
      isolation_level: "PROCESS",
      autonomy_tier_cap: "T0",
      purpose_binding_required: false,
      boundary_objects_required: false,
      work_order_required: false,
    },
    schema_version: "1.0.0",
  },
  G1: {
    governance_level: "G1",
    enforcement_config: {
      pdp_mode: "ROLE_ONLY",
      evidence_mode: "OPTIONAL",
      escalation_mode: "NOTIFY_ONLY",
      isolation_level: "CONTAINER",
      autonomy_tier_cap: "T1",
      purpose_binding_required: true,
      boundary_objects_required: false,
      work_order_required: false,
    },
    schema_version: "1.0.0",
  },
  G2: {
    governance_level: "G2",
    enforcement_config: {
      pdp_mode: "FULL_PIPELINE",
      evidence_mode: "MANDATORY",
      escalation_mode: "FULL_LADDER",
      isolation_level: "NETWORK",
      autonomy_tier_cap: "T2",
      purpose_binding_required: true,
      boundary_objects_required: true,
      work_order_required: true,
    },
    schema_version: "1.0.0",
  },
  G3: {
    governance_level: "G3",
    enforcement_config: {
      pdp_mode: "FULL_PLUS_DUAL_CONTROL",
      evidence_mode: "MANDATORY_PLUS_HASH_CHAIN",
      escalation_mode: "FULL_LADDER_PLUS_BREAK_GLASS",
      isolation_level: "CRYPTOGRAPHIC",
      autonomy_tier_cap: "T2",
      purpose_binding_required: true,
      boundary_objects_required: true,
      work_order_required: true,
    },
    schema_version: "1.0.0",
  },
};
