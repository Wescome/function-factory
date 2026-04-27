// kernel/ids.ts - ID types, patterns, generation, and validation
// Mirrors weops-enterprise/pkg/ids/ids.go

// ---------------------------------------------------------------------------
// Branded type helper
// ---------------------------------------------------------------------------
type Brand<T, B extends string> = T & { readonly __brand: B };

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------
export type WorkOrderID = Brand<string, "WorkOrderID">;
export type PolicyDecisionID = Brand<string, "PolicyDecisionID">;
export type InvocationID = Brand<string, "InvocationID">;
export type EvidenceID = Brand<string, "EvidenceID">;
export type WorkspaceID = Brand<string, "WorkspaceID">;
export type TemplateID = Brand<string, "TemplateID">;
export type AssemblyID = Brand<string, "AssemblyID">;
export type EscalationID = Brand<string, "EscalationID">;
export type EventID = Brand<string, "EventID">;
export type BridgeRequestID = Brand<string, "BridgeRequestID">;
export type MessageID = Brand<string, "MessageID">;
export type BoundaryObjectID = Brand<string, "BoundaryObjectID">;
export type EnvelopeID = Brand<string, "EnvelopeID">;
export type SessionID = Brand<string, "SessionID">;

// ---------------------------------------------------------------------------
// Pattern constants (match Go regex patterns exactly)
// ---------------------------------------------------------------------------
export const WORK_ORDER_ID_PATTERN = /^wo_[a-z0-9]{16}$/;
export const POLICY_DECISION_ID_PATTERN = /^pd_[a-z0-9]{16}$/;
export const INVOCATION_ID_PATTERN = /^inv_[a-z0-9]{16}$/;
export const EVIDENCE_ID_PATTERN = /^ev_[a-z0-9]{16}$/;
export const WORKSPACE_ID_PATTERN = /^ws_[a-z0-9_]+$/;
export const TEMPLATE_ID_PATTERN = /^tpl_[a-z0-9]{16}$/;
export const ASSEMBLY_ID_PATTERN = /^asm_[a-z0-9]{16}$/;
export const ESCALATION_ID_PATTERN = /^esc_[a-z0-9]{16}$/;
export const EVENT_ID_PATTERN = /^evt_[a-z0-9]{16}$/;
export const BRIDGE_REQUEST_ID_PATTERN = /^brq_[a-z0-9]{16}$/;
export const MESSAGE_ID_PATTERN = /^msg_[a-z0-9]{16}$/;
export const BOUNDARY_OBJECT_ID_PATTERN = /^bo_[a-z0-9]{16}$/;
export const ENVELOPE_ID_PATTERN = /^env_[a-z0-9]{16}$/;
export const SESSION_ID_PATTERN = /^ses_[a-z0-9]{16}$/;

// ---------------------------------------------------------------------------
// Character set and suffix generation (matches Go charset exactly)
// ---------------------------------------------------------------------------
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 16;

function random_suffix(): string {
  const buf = new Uint8Array(SUFFIX_LENGTH);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += CHARSET[buf[i]! % CHARSET.length]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation functions
// ---------------------------------------------------------------------------
export function new_work_order_id(): WorkOrderID {
  return ("wo_" + random_suffix()) as WorkOrderID;
}

export function new_policy_decision_id(): PolicyDecisionID {
  return ("pd_" + random_suffix()) as PolicyDecisionID;
}

export function new_invocation_id(): InvocationID {
  return ("inv_" + random_suffix()) as InvocationID;
}

export function new_evidence_id(): EvidenceID {
  return ("ev_" + random_suffix()) as EvidenceID;
}

export function new_workspace_id(): WorkspaceID {
  return ("ws_" + random_suffix()) as WorkspaceID;
}

export function new_template_id(): TemplateID {
  return ("tpl_" + random_suffix()) as TemplateID;
}

export function new_assembly_id(): AssemblyID {
  return ("asm_" + random_suffix()) as AssemblyID;
}

export function new_escalation_id(): EscalationID {
  return ("esc_" + random_suffix()) as EscalationID;
}

export function new_event_id(): EventID {
  return ("evt_" + random_suffix()) as EventID;
}

export function new_bridge_request_id(): BridgeRequestID {
  return ("brq_" + random_suffix()) as BridgeRequestID;
}

export function new_message_id(): MessageID {
  return ("msg_" + random_suffix()) as MessageID;
}

export function new_boundary_object_id(): BoundaryObjectID {
  return ("bo_" + random_suffix()) as BoundaryObjectID;
}

export function new_envelope_id(): EnvelopeID {
  return ("env_" + random_suffix()) as EnvelopeID;
}

export function new_session_id(): SessionID {
  return ("ses_" + random_suffix()) as SessionID;
}

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------
export function is_valid_work_order_id(id: string): id is WorkOrderID {
  return WORK_ORDER_ID_PATTERN.test(id);
}

export function is_valid_policy_decision_id(id: string): id is PolicyDecisionID {
  return POLICY_DECISION_ID_PATTERN.test(id);
}

export function is_valid_invocation_id(id: string): id is InvocationID {
  return INVOCATION_ID_PATTERN.test(id);
}

export function is_valid_evidence_id(id: string): id is EvidenceID {
  return EVIDENCE_ID_PATTERN.test(id);
}

export function is_valid_workspace_id(id: string): id is WorkspaceID {
  return WORKSPACE_ID_PATTERN.test(id);
}

export function is_valid_template_id(id: string): id is TemplateID {
  return TEMPLATE_ID_PATTERN.test(id);
}

export function is_valid_assembly_id(id: string): id is AssemblyID {
  return ASSEMBLY_ID_PATTERN.test(id);
}

export function is_valid_escalation_id(id: string): id is EscalationID {
  return ESCALATION_ID_PATTERN.test(id);
}

export function is_valid_event_id(id: string): id is EventID {
  return EVENT_ID_PATTERN.test(id);
}

export function is_valid_bridge_request_id(id: string): id is BridgeRequestID {
  return BRIDGE_REQUEST_ID_PATTERN.test(id);
}

export function is_valid_message_id(id: string): id is MessageID {
  return MESSAGE_ID_PATTERN.test(id);
}

export function is_valid_boundary_object_id(id: string): id is BoundaryObjectID {
  return BOUNDARY_OBJECT_ID_PATTERN.test(id);
}

export function is_valid_envelope_id(id: string): id is EnvelopeID {
  return ENVELOPE_ID_PATTERN.test(id);
}

export function is_valid_session_id(id: string): id is SessionID {
  return SESSION_ID_PATTERN.test(id);
}

export function is_valid_any_id(id: string): boolean {
  return (
    is_valid_work_order_id(id) ||
    is_valid_policy_decision_id(id) ||
    is_valid_invocation_id(id) ||
    is_valid_evidence_id(id) ||
    is_valid_workspace_id(id) ||
    is_valid_template_id(id) ||
    is_valid_assembly_id(id) ||
    is_valid_escalation_id(id) ||
    is_valid_event_id(id) ||
    is_valid_bridge_request_id(id) ||
    is_valid_message_id(id) ||
    is_valid_boundary_object_id(id) ||
    is_valid_envelope_id(id) ||
    is_valid_session_id(id)
  );
}
