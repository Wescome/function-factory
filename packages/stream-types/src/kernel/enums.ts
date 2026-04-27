// kernel/enums.ts - All enumeration types mirroring Go constants
// Generated from WeOps Enterprise Go source files

// ---------------------------------------------------------------------------
// Channel (envelope.go)
// ---------------------------------------------------------------------------
export type Channel = "web" | "cli" | "telegram" | "api";
export const CHANNEL_VALUES = ["web", "cli", "telegram", "api"] as const;

// ---------------------------------------------------------------------------
// DeviceClass (envelope.go)
// ---------------------------------------------------------------------------
export type DeviceClass = "desktop" | "mobile" | "terminal" | "bot";
export const DEVICE_CLASS_VALUES = ["desktop", "mobile", "terminal", "bot"] as const;

// ---------------------------------------------------------------------------
// Role (envelope.go)
// ---------------------------------------------------------------------------
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | "AGENT";
export const ROLE_VALUES = ["OWNER", "ADMIN", "MEMBER", "VIEWER", "AGENT"] as const;

// ---------------------------------------------------------------------------
// ResponseStatus (envelope.go)
// ---------------------------------------------------------------------------
export type ResponseStatus = "ok" | "error" | "pending";
export const RESPONSE_STATUS_VALUES = ["ok", "error", "pending"] as const;

// ---------------------------------------------------------------------------
// IntentType (envelope.go) - 17 canonical intents
// ---------------------------------------------------------------------------
export type IntentType =
  | "workspace.switch"
  | "workspace.list"
  | "workorder.create"
  | "workorder.transition"
  | "workorder.approve"
  | "tool.invoke"
  | "boundary.create"
  | "boundary.read"
  | "boundary.publish"
  | "bridge.request_access"
  | "bridge.evaluate"
  | "bridge.get_reference"
  | "governance.get_profile"
  | "governance.escalate"
  | "evidence.query"
  | "message.send"
  | "message.stream"
  | "narrative.render"
  | "narrative.deliver"
  | "narrative.get";

export const INTENT_TYPE_VALUES = [
  "workspace.switch",
  "workspace.list",
  "workorder.create",
  "workorder.transition",
  "workorder.approve",
  "tool.invoke",
  "boundary.create",
  "boundary.read",
  "boundary.publish",
  "bridge.request_access",
  "bridge.evaluate",
  "bridge.get_reference",
  "governance.get_profile",
  "governance.escalate",
  "evidence.query",
  "message.send",
  "message.stream",
  "narrative.render",
  "narrative.deliver",
  "narrative.get",
] as const;

// ---------------------------------------------------------------------------
// GovernanceLevel (envelope.go)
// ---------------------------------------------------------------------------
export type GovernanceLevel = "G0" | "G1" | "G2" | "G3";
export const GOVERNANCE_LEVEL_VALUES = ["G0", "G1", "G2", "G3"] as const;

// ---------------------------------------------------------------------------
// AutonomyTier (envelope.go)
// ---------------------------------------------------------------------------
export type AutonomyTier = "T0" | "T1" | "T2";
export const AUTONOMY_TIER_VALUES = ["T0", "T1", "T2"] as const;

// ---------------------------------------------------------------------------
// RiskTier (envelope.go)
// ---------------------------------------------------------------------------
export type RiskTier = "R0" | "R1" | "R2" | "R3";
export const RISK_TIER_VALUES = ["R0", "R1", "R2", "R3"] as const;

// ---------------------------------------------------------------------------
// Classification (envelope.go)
// ---------------------------------------------------------------------------
export type Classification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED_PHI";
export const CLASSIFICATION_VALUES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED_PHI"] as const;

// ---------------------------------------------------------------------------
// PDPDecision (envelope.go)
// ---------------------------------------------------------------------------
export type PDPDecision = "PERMIT" | "DENY";
export const PDP_DECISION_VALUES = ["PERMIT", "DENY"] as const;

// ---------------------------------------------------------------------------
// WorkOrderStatus (workorder.go)
// ---------------------------------------------------------------------------
export type WorkOrderStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING"
  | "FAILED_FINAL";

export const WORK_ORDER_STATUS_VALUES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVAL_PENDING",
  "APPROVED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "COMPENSATING",
  "FAILED_FINAL",
] as const;

// ---------------------------------------------------------------------------
// ApprovalStatus (workorder.go)
// ---------------------------------------------------------------------------
export type ApprovalStatus = "PENDING" | "GRANTED" | "DENIED";
export const APPROVAL_STATUS_VALUES = ["PENDING", "GRANTED", "DENIED"] as const;

// ---------------------------------------------------------------------------
// ConflictRule (workorder.go)
// ---------------------------------------------------------------------------
export type ConflictRule =
  | "ESCALATE_WITH_OPTIONS_MEMO"
  | "MOST_RESTRICTIVE_WINS"
  | "PRIMARY_PURPOSE_OWNER_DECIDES"
  | "DUAL_CONTROL_REQUIRED";

export const CONFLICT_RULE_VALUES = [
  "ESCALATE_WITH_OPTIONS_MEMO",
  "MOST_RESTRICTIVE_WINS",
  "PRIMARY_PURPOSE_OWNER_DECIDES",
  "DUAL_CONTROL_REQUIRED",
] as const;

// ---------------------------------------------------------------------------
// PDPMode (governance.go)
// ---------------------------------------------------------------------------
export type PDPMode = "DISABLED" | "ROLE_ONLY" | "FULL_PIPELINE" | "FULL_PLUS_DUAL_CONTROL";
export const PDP_MODE_VALUES = ["DISABLED", "ROLE_ONLY", "FULL_PIPELINE", "FULL_PLUS_DUAL_CONTROL"] as const;

// ---------------------------------------------------------------------------
// EvidenceMode (governance.go)
// ---------------------------------------------------------------------------
export type EvidenceMode = "DISABLED" | "OPTIONAL" | "MANDATORY" | "MANDATORY_PLUS_HASH_CHAIN";
export const EVIDENCE_MODE_VALUES = ["DISABLED", "OPTIONAL", "MANDATORY", "MANDATORY_PLUS_HASH_CHAIN"] as const;

// ---------------------------------------------------------------------------
// EscalationMode (governance.go)
// ---------------------------------------------------------------------------
export type EscalationMode = "DISABLED" | "NOTIFY_ONLY" | "FULL_LADDER" | "FULL_LADDER_PLUS_BREAK_GLASS";
export const ESCALATION_MODE_VALUES = ["DISABLED", "NOTIFY_ONLY", "FULL_LADDER", "FULL_LADDER_PLUS_BREAK_GLASS"] as const;

// ---------------------------------------------------------------------------
// IsolationLevel (governance.go)
// ---------------------------------------------------------------------------
export type IsolationLevel = "PROCESS" | "CONTAINER" | "NETWORK" | "CRYPTOGRAPHIC";
export const ISOLATION_LEVEL_VALUES = ["PROCESS", "CONTAINER", "NETWORK", "CRYPTOGRAPHIC"] as const;

// ---------------------------------------------------------------------------
// ObligationType (policy.go)
// ---------------------------------------------------------------------------
export type ObligationType =
  | "REQUIRE_APPROVAL"
  | "REQUIRE_DUAL_APPROVAL"
  | "REQUIRE_EVIDENCE_BUNDLE"
  | "LOG_LEVEL"
  | "REQUIRE_CLARIFICATION"
  | "NARROW_SCOPE"
  | "SET_AUTONOMY"
  | "OUTPUT_REFERENCES_ONLY"
  | "SCOPE_ENFORCEMENT"
  | "BREAK_GLASS_REVIEW";

export const OBLIGATION_TYPE_VALUES = [
  "REQUIRE_APPROVAL",
  "REQUIRE_DUAL_APPROVAL",
  "REQUIRE_EVIDENCE_BUNDLE",
  "LOG_LEVEL",
  "REQUIRE_CLARIFICATION",
  "NARROW_SCOPE",
  "SET_AUTONOMY",
  "OUTPUT_REFERENCES_ONLY",
  "SCOPE_ENFORCEMENT",
  "BREAK_GLASS_REVIEW",
] as const;

// ---------------------------------------------------------------------------
// Severity (policy.go)
// ---------------------------------------------------------------------------
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export const SEVERITY_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

// ---------------------------------------------------------------------------
// Environment (policy.go)
// ---------------------------------------------------------------------------
export type Environment = "prod" | "sandbox" | "test";
export const ENVIRONMENT_VALUES = ["prod", "sandbox", "test"] as const;

// ---------------------------------------------------------------------------
// EscalationTriggerType (escalation.go)
// ---------------------------------------------------------------------------
export type EscalationTriggerType =
  | "IMPACT_RULE_EXCEEDED"
  | "CROSS_WORKSPACE_ACCESS"
  | "EXTERNAL_DISCLOSURE"
  | "PHI_DETECTED"
  | "MANUAL_UPGRADE"
  | "POLICY_COLLISION";

export const ESCALATION_TRIGGER_TYPE_VALUES = [
  "IMPACT_RULE_EXCEEDED",
  "CROSS_WORKSPACE_ACCESS",
  "EXTERNAL_DISCLOSURE",
  "PHI_DETECTED",
  "MANUAL_UPGRADE",
  "POLICY_COLLISION",
] as const;

// ---------------------------------------------------------------------------
// EscalationStatus (escalation.go)
// ---------------------------------------------------------------------------
export type EscalationStatus = "PENDING" | "APPROVED" | "APPLIED" | "DENIED";
export const ESCALATION_STATUS_VALUES = ["PENDING", "APPROVED", "APPLIED", "DENIED"] as const;

// ---------------------------------------------------------------------------
// InvocationStatus (invocation.go)
// ---------------------------------------------------------------------------
export type InvocationStatus = "SUCCEEDED" | "FAILED" | "RETRYING";
export const INVOCATION_STATUS_VALUES = ["SUCCEEDED", "FAILED", "RETRYING"] as const;

// ---------------------------------------------------------------------------
// MessageType (messages.go) - 9 canonical types
// ---------------------------------------------------------------------------
export type MessageType =
  | "WorkOrderCreated"
  | "PolicyDecisionRequested"
  | "PolicyDecisionReturned"
  | "ApprovalRequested"
  | "ApprovalGranted"
  | "ToolInvocationRequested"
  | "ToolInvocationCompleted"
  | "BoundaryObjectPublished"
  | "EvidenceBundleCommitted";

export const MESSAGE_TYPE_VALUES = [
  "WorkOrderCreated",
  "PolicyDecisionRequested",
  "PolicyDecisionReturned",
  "ApprovalRequested",
  "ApprovalGranted",
  "ToolInvocationRequested",
  "ToolInvocationCompleted",
  "BoundaryObjectPublished",
  "EvidenceBundleCommitted",
] as const;

// ---------------------------------------------------------------------------
// DomainContextID (domainevent.go)
// ---------------------------------------------------------------------------
export type DomainContextID = "IC" | "OR" | "ME" | "RE" | "DA" | "DI" | "SM" | "CC" | "RA";
export const DOMAIN_CONTEXT_ID_VALUES = ["IC", "OR", "ME", "RE", "DA", "DI", "SM", "CC", "RA"] as const;

// ---------------------------------------------------------------------------
// BoundaryObjectType (boundary.go)
// ---------------------------------------------------------------------------
export type BoundaryObjectType = "CB-01" | "CB-02" | "CB-03" | "CB-04" | "CB-05-R" | "CB-05-D";
export const BOUNDARY_OBJECT_TYPE_VALUES = ["CB-01", "CB-02", "CB-03", "CB-04", "CB-05-R", "CB-05-D"] as const;

// ---------------------------------------------------------------------------
// Narrative Domain Enums (boundary.go — CB-05)
// ---------------------------------------------------------------------------

/** The 4 narrative roles map to the 4 steps of the stepper */
export type NarrativeRole = "CONTEXT" | "SIGNAL" | "OPTIONS" | "RESOLUTION";
export const NARRATIVE_ROLE_VALUES = ["CONTEXT", "SIGNAL", "OPTIONS", "RESOLUTION"] as const;

/** How a field was redacted for the target audience */
export type RedactionType = "OMITTED" | "MASKED" | "SUMMARY_ONLY";
export const REDACTION_TYPE_VALUES = ["OMITTED", "MASKED", "SUMMARY_ONLY"] as const;

/** Output channel for a narrative delivery */
export type DeliveryChannel = "INTERACTIVE_STEPPER" | "PDF_EXPORT" | "WGSP_STREAM" | "STATIC_HTML";
export const DELIVERY_CHANNEL_VALUES = ["INTERACTIVE_STEPPER", "PDF_EXPORT", "WGSP_STREAM", "STATIC_HTML"] as const;

/** Classification of key facts within a narrative step */
export type KeyFactType = "metric" | "constraint" | "actor" | "outcome" | "timestamp";
export const KEY_FACT_TYPE_VALUES = ["metric", "constraint", "actor", "outcome", "timestamp"] as const;

/** Sentiment of a delta value — set by the domain assembly, NOT the kernel or frontend.
 *  "positive" = improvement, "negative" = worsening, "neutral" = unchanged. */
export type DeltaSentiment = "positive" | "negative" | "neutral";
export const DELTA_SENTIMENT_VALUES = ["positive", "negative", "neutral"] as const;

// ---------------------------------------------------------------------------
// VisualizationType (boundary.go — Visualization.Type)
// ---------------------------------------------------------------------------

/** Type of visualization to render in a narrative step.
 *  Set by the domain assembly (generator), stored opaque by kernel,
 *  rendered by frontend based on type. */
export type VisualizationType = "sparkline" | "bar" | "gauge" | "progress" | "icon_set";
export const VISUALIZATION_TYPE_VALUES = ["sparkline", "bar", "gauge", "progress", "icon_set"] as const;
