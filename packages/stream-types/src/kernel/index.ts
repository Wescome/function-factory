// kernel/index.ts - Barrel re-export of all kernel modules

// Enums (types and runtime value arrays)
export type {
  Channel,
  DeviceClass,
  Role,
  ResponseStatus,
  IntentType,
  GovernanceLevel,
  AutonomyTier,
  RiskTier,
  Classification,
  PDPDecision,
  WorkOrderStatus,
  ApprovalStatus,
  ConflictRule,
  PDPMode,
  EvidenceMode,
  EscalationMode,
  IsolationLevel,
  ObligationType,
  Severity,
  Environment,
  EscalationTriggerType,
  EscalationStatus,
  InvocationStatus,
  MessageType,
  DomainContextID,
  BoundaryObjectType,
  NarrativeRole,
  RedactionType,
  DeliveryChannel,
  KeyFactType,
  DeltaSentiment,
  VisualizationType,
} from "./enums";

export {
  CHANNEL_VALUES,
  DEVICE_CLASS_VALUES,
  ROLE_VALUES,
  RESPONSE_STATUS_VALUES,
  INTENT_TYPE_VALUES,
  GOVERNANCE_LEVEL_VALUES,
  AUTONOMY_TIER_VALUES,
  RISK_TIER_VALUES,
  CLASSIFICATION_VALUES,
  PDP_DECISION_VALUES,
  WORK_ORDER_STATUS_VALUES,
  APPROVAL_STATUS_VALUES,
  CONFLICT_RULE_VALUES,
  PDP_MODE_VALUES,
  EVIDENCE_MODE_VALUES,
  ESCALATION_MODE_VALUES,
  ISOLATION_LEVEL_VALUES,
  OBLIGATION_TYPE_VALUES,
  SEVERITY_VALUES,
  ENVIRONMENT_VALUES,
  ESCALATION_TRIGGER_TYPE_VALUES,
  ESCALATION_STATUS_VALUES,
  INVOCATION_STATUS_VALUES,
  MESSAGE_TYPE_VALUES,
  DOMAIN_CONTEXT_ID_VALUES,
  BOUNDARY_OBJECT_TYPE_VALUES,
  NARRATIVE_ROLE_VALUES,
  REDACTION_TYPE_VALUES,
  DELIVERY_CHANNEL_VALUES,
  KEY_FACT_TYPE_VALUES,
  DELTA_SENTIMENT_VALUES,
  VISUALIZATION_TYPE_VALUES,
} from "./enums";

// IDs (branded types, patterns, generators, validators)
export type {
  WorkOrderID,
  PolicyDecisionID,
  InvocationID,
  EvidenceID,
  WorkspaceID,
  TemplateID,
  AssemblyID,
  EscalationID,
  EventID,
  BridgeRequestID,
  MessageID,
  BoundaryObjectID,
  EnvelopeID,
  SessionID,
} from "./ids";

export {
  WORK_ORDER_ID_PATTERN,
  POLICY_DECISION_ID_PATTERN,
  INVOCATION_ID_PATTERN,
  EVIDENCE_ID_PATTERN,
  WORKSPACE_ID_PATTERN,
  TEMPLATE_ID_PATTERN,
  ASSEMBLY_ID_PATTERN,
  ESCALATION_ID_PATTERN,
  EVENT_ID_PATTERN,
  BRIDGE_REQUEST_ID_PATTERN,
  MESSAGE_ID_PATTERN,
  BOUNDARY_OBJECT_ID_PATTERN,
  ENVELOPE_ID_PATTERN,
  SESSION_ID_PATTERN,
  new_work_order_id,
  new_policy_decision_id,
  new_invocation_id,
  new_evidence_id,
  new_workspace_id,
  new_template_id,
  new_assembly_id,
  new_escalation_id,
  new_event_id,
  new_bridge_request_id,
  new_message_id,
  new_boundary_object_id,
  new_envelope_id,
  new_session_id,
  is_valid_work_order_id,
  is_valid_policy_decision_id,
  is_valid_invocation_id,
  is_valid_evidence_id,
  is_valid_workspace_id,
  is_valid_template_id,
  is_valid_assembly_id,
  is_valid_escalation_id,
  is_valid_event_id,
  is_valid_bridge_request_id,
  is_valid_message_id,
  is_valid_boundary_object_id,
  is_valid_envelope_id,
  is_valid_session_id,
  is_valid_any_id,
} from "./ids";

// Taxonomy
export type { Purpose } from "./taxonomy";
export {
  TAXONOMY,
  validate_purpose,
  list_domains,
  list_actions,
  get_description,
} from "./taxonomy";

// Provenance
export type { Provenance } from "./provenance";

// Envelope
export type {
  Envelope,
  ChannelSource,
  SessionContext,
  Intent,
  ConstraintContext,
  EnvelopeResponse,
  GovernanceApplied,
  EnvelopeError,
} from "./envelope";

// Policy
export type {
  DecisionRequest,
  Subject,
  SubjectClaims,
  Action,
  Resource,
  RequestContext,
  DecisionResponse,
  Obligation,
} from "./policy";

// Work Order
export type {
  WorkOrder,
  Scope,
  Approval,
  TimelineEntry,
} from "./workorder";
export { ALLOWED_TRANSITIONS } from "./workorder";

// Governance
export type {
  GovernanceProfile,
  EnforcementConfig,
  EscalationOverride,
} from "./governance";
export { DEFAULT_PROFILES } from "./governance";

// Escalation
export type {
  GovernanceEscalation,
  EscalationTrigger,
} from "./escalation";

// Evidence
export type {
  EvidenceBundle,
  ObligationSatisfied,
} from "./evidence";

// Invocation
export type {
  InvocationRequest,
  InvocationResult,
  InvocationError,
} from "./invocation";
export { TOOL_NAME_PATTERN } from "./invocation";

// PDP
export type {
  EvaluationRequest,
  EvaluationResult,
  FieldDecision,
  WorkOrderContext,
} from "./pdp";

// Messages
export type { Message } from "./messages";

// Domain Events
export type { DomainEvent } from "./domainevent";
export { EVENT_TYPE_PATTERN, VALID_CONTEXT_IDS } from "./domainevent";

// Boundary Objects
export type {
  BoundaryObjectBase,
  CaseSummary,
  StatusInfo,
  Commitment,
  OpenQuestion,
  DecisionMemo,
  Option,
  Tradeoffs,
  BoundaryApproval,
  PolicyBundle,
  MachineRulesRef,
  ObligationTemplate,
  Runbook,
  RunbookStep,
  RollbackConfig,
  MonitorSignal,
  BoundaryObject,
  // CB-05
  KeyFact,
  FieldRef,
  SummaryMetadata,
  StepVisualization,
  StepInteraction,
  AuditLock,
  RenderingTarget,
  RedactionRecord,
  NarrativeStep,
  NarrativeRecord,
  NarrativeDelivery,
} from "./boundary";

export {
  isNarrativeRecord,
  isNarrativeDelivery,
} from "./boundary";

// Common Ground Assembly
export type {
  CGGovernanceTier,
  WorkspaceStatus,
  TeamRole,
  BOStatus,
  CGClassification,
  MemoryLane,
  EscalationRung,
  ConflictStatus,
  CGPurpose,
  TeamEnrollment,
  CGWorkspace,
  ConflictConstraint,
  ConflictRecord,
  ModuleManifest,
} from "./commonground";

export {
  CG_ASSEMBLY_ID,
  CG_ASSEMBLY_VERSION,
  CG_KERNEL_MIN_VERSION,
  CG_GOVERNANCE_TIER_VALUES,
  WORKSPACE_STATUS_VALUES,
  WORKSPACE_TRANSITIONS,
  validate_workspace_transition,
  TEAM_ROLE_VALUES,
  BO_STATUS_VALUES,
  CG_CLASSIFICATION_VALUES,
  MEMORY_LANE_VALUES,
  ESCALATION_RUNG_VALUES,
  RISK_TO_RUNG_MAPPING,
  assign_escalation_rung,
  CONFLICT_STATUS_VALUES,
  CG_PURPOSE_VALUES,
  CG_TAXONOMY,
  validate_cg_purpose,
  list_cg_trunks,
  list_cg_branches,
  list_cg_leaves,
  get_cg_description,
  CG_ASSEMBLY_MANIFEST,
} from "./commonground";
