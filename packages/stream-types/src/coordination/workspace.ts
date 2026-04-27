// coordination/workspace.ts - Workspace schema types (WP-0.11)
// The stateful isolation boundary for governed execution

import type { GovernanceLevel, IsolationLevel, Role, DomainContextID } from "../kernel/enums";
import type { WorkspaceID } from "../kernel/ids";

// ---------------------------------------------------------------------------
// Owner Type
// ---------------------------------------------------------------------------
export type OwnerType = "USER" | "TEAM" | "ORGANIZATION";
export const OWNER_TYPE_VALUES = ["USER", "TEAM", "ORGANIZATION"] as const;

// ---------------------------------------------------------------------------
// Workspace Status
// ---------------------------------------------------------------------------
export type CoordWorkspaceStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export const COORD_WORKSPACE_STATUS_VALUES = ["PROVISIONING", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const;

// Allowed transitions — forward-only (SUSPENDED can reactivate)
export const COORD_WORKSPACE_TRANSITIONS: ReadonlyMap<CoordWorkspaceStatus, readonly CoordWorkspaceStatus[]> = new Map([
  ["PROVISIONING", ["ACTIVE"]],
  ["ACTIVE", ["SUSPENDED", "ARCHIVED"]],
  ["SUSPENDED", ["ACTIVE", "ARCHIVED"]],
  ["ARCHIVED", []],
]);

export function validate_coord_workspace_transition(from: CoordWorkspaceStatus, to: CoordWorkspaceStatus): boolean {
  const allowed = COORD_WORKSPACE_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Governance level ordering — governance can only increase, never decrease
// ---------------------------------------------------------------------------
const GOVERNANCE_ORDER: Record<GovernanceLevel, number> = { G0: 0, G1: 1, G2: 2, G3: 3 };

export function validate_governance_upgrade(current: GovernanceLevel, requested: GovernanceLevel): boolean {
  return GOVERNANCE_ORDER[requested] >= GOVERNANCE_ORDER[current];
}

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------
export interface WorkspaceOwner {
  readonly owner_type: OwnerType;
  readonly owner_id: string;
}

export interface WorkspaceMember {
  readonly member_id: string;
  readonly role: Role;
}

export interface ResourceLimits {
  readonly storage_bytes?: number;
  readonly compute_budget_cents?: number;
  readonly api_rate_per_minute?: number;
}

// ---------------------------------------------------------------------------
// Workspace (WP-0.11)
// ---------------------------------------------------------------------------
export interface Workspace {
  readonly workspace_id: WorkspaceID;
  readonly owner: WorkspaceOwner;
  readonly governance_level: GovernanceLevel;
  readonly isolation_level: IsolationLevel;
  readonly status: CoordWorkspaceStatus;
  readonly product_assembly?: string;
  readonly domain_contexts: readonly DomainContextID[];
  readonly purpose_scope: readonly string[];
  readonly policy_bundles: readonly string[];
  readonly resource_limits?: ResourceLimits;
  readonly members: readonly WorkspaceMember[];
  readonly created_at: string;
  readonly updated_at?: string;
  readonly schema_version: "1.0.0";
}
