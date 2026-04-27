// coordination/router.ts - We-Gradient Router types (WP-1.07)

import type { GovernanceLevel } from "../kernel/enums";
import type { GovernanceProfile } from "../kernel/governance";
import type { Obligation } from "../kernel/policy";

// ---------------------------------------------------------------------------
// Impact Rule
// ---------------------------------------------------------------------------
export interface ImpactRule {
  readonly action_pattern: string;
  readonly min_governance: GovernanceLevel;
  readonly reason: string;
}

// Default impact classification rules from SDD spec
export const DEFAULT_IMPACT_RULES: readonly ImpactRule[] = [
  { action_pattern: "external_api_call", min_governance: "G1", reason: "External side effects require at least identity + purpose" },
  { action_pattern: "phi_access", min_governance: "G2", reason: "Regulatory requirement" },
  { action_pattern: "cross_workspace_reference", min_governance: "G2", reason: "Isolation boundary crossing" },
  { action_pattern: "external_disclosure", min_governance: "G3", reason: "Maximum evidence and approval" },
  { action_pattern: "financial_transaction_high", min_governance: "G2", reason: "Impact threshold" },
  { action_pattern: "policy_bundle_modification", min_governance: "G3", reason: "Meta-governance requires institutional controls" },
];

// ---------------------------------------------------------------------------
// Route Decision
// ---------------------------------------------------------------------------
export type RouteDecision = "PERMIT" | "DENY" | "ESCALATE_AND_EVALUATE";
export const ROUTE_DECISION_VALUES = ["PERMIT", "DENY", "ESCALATE_AND_EVALUATE"] as const;

export interface RouteResult {
  readonly decision: RouteDecision;
  readonly effective_governance_level: GovernanceLevel;
  readonly base_governance_level: GovernanceLevel;
  readonly escalated: boolean;
  readonly profile: GovernanceProfile;
  readonly obligations: readonly Obligation[];
  readonly impact_rule_matched?: ImpactRule;
}

// ---------------------------------------------------------------------------
// Governance level comparison utilities
// ---------------------------------------------------------------------------
const GOVERNANCE_ORDER: Record<GovernanceLevel, number> = { G0: 0, G1: 1, G2: 2, G3: 3 };

export function max_governance_level(a: GovernanceLevel, b: GovernanceLevel): GovernanceLevel {
  return GOVERNANCE_ORDER[a] >= GOVERNANCE_ORDER[b] ? a : b;
}

export function governance_level_gte(a: GovernanceLevel, b: GovernanceLevel): boolean {
  return GOVERNANCE_ORDER[a] >= GOVERNANCE_ORDER[b];
}

export function governance_level_gt(a: GovernanceLevel, b: GovernanceLevel): boolean {
  return GOVERNANCE_ORDER[a] > GOVERNANCE_ORDER[b];
}
