// coordination/bridge.ts - Cross-workspace bridge request types (WP-1.09)

import type { BoundaryObjectType } from "../kernel/enums";
import type { BridgeRequestID, WorkspaceID } from "../kernel/ids";

// ---------------------------------------------------------------------------
// Bridge Request Status
// ---------------------------------------------------------------------------
export type BridgeRequestStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
export const BRIDGE_REQUEST_STATUS_VALUES = ["PENDING", "APPROVED", "DENIED", "EXPIRED"] as const;

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------
export interface RequesterClaims {
  readonly actor: string;
  readonly role: string;
  readonly session: string;
}

// ---------------------------------------------------------------------------
// Bridge Request (WP-1.09)
// ---------------------------------------------------------------------------
export interface BridgeRequest {
  readonly bridge_request_id: BridgeRequestID;
  readonly source_workspace_id: WorkspaceID;
  readonly target_workspace_id: WorkspaceID;
  readonly requested_object_type: BoundaryObjectType;
  readonly requested_object_id: string;
  readonly purpose: string;
  readonly requester_claims: RequesterClaims;
  readonly field_filter: readonly string[];
  readonly status: BridgeRequestStatus;
  readonly ttl_seconds?: number;
  readonly created_at: string;
  readonly expires_at?: string;
  readonly schema_version: "1.0.0";
}
