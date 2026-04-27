// validators/ids.ts - ID validation against all known patterns
// Returns string[] of error messages (empty = valid). Matches Go validation patterns.

import {
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
} from "../kernel/ids";

// ---------------------------------------------------------------------------
// Pattern registry keyed by type name
// ---------------------------------------------------------------------------

const PATTERN_REGISTRY: Readonly<Record<string, RegExp>> = {
  work_order: WORK_ORDER_ID_PATTERN,
  policy_decision: POLICY_DECISION_ID_PATTERN,
  invocation: INVOCATION_ID_PATTERN,
  evidence: EVIDENCE_ID_PATTERN,
  workspace: WORKSPACE_ID_PATTERN,
  template: TEMPLATE_ID_PATTERN,
  assembly: ASSEMBLY_ID_PATTERN,
  escalation: ESCALATION_ID_PATTERN,
  event: EVENT_ID_PATTERN,
  bridge_request: BRIDGE_REQUEST_ID_PATTERN,
  message: MESSAGE_ID_PATTERN,
  boundary_object: BOUNDARY_OBJECT_ID_PATTERN,
  envelope: ENVELOPE_ID_PATTERN,
  session: SESSION_ID_PATTERN,
};

// ---------------------------------------------------------------------------
// Prefix-to-type mapping for detection
// ---------------------------------------------------------------------------

const PREFIX_MAP: Readonly<Record<string, string>> = {
  wo_: "work_order",
  pd_: "policy_decision",
  inv_: "invocation",
  ev_: "evidence",
  ws_: "workspace",
  tpl_: "template",
  asm_: "assembly",
  esc_: "escalation",
  evt_: "event",
  brq_: "bridge_request",
  msg_: "message",
  bo_: "boundary_object",
  env_: "envelope",
  ses_: "session",
};

/**
 * Validates an ID string against a specific known type.
 * Returns an empty array if valid, or an array of error messages.
 */
export function validate_id(id: string, type: string): string[] {
  const errors: string[] = [];

  if (id.length === 0) {
    errors.push(`${type} id must not be empty`);
    return errors;
  }

  const pattern = PATTERN_REGISTRY[type];
  if (pattern == null) {
    errors.push(`unknown id type: ${type}`);
    return errors;
  }

  if (!pattern.test(id)) {
    errors.push(`${type} id "${id}" does not match pattern ${pattern.source}`);
  }

  return errors;
}

/**
 * Detects the ID type from its prefix.
 * Returns the type string or null if no known prefix matches.
 */
export function detect_id_type(id: string): string | null {
  for (const [prefix, type] of Object.entries(PREFIX_MAP)) {
    if (id.startsWith(prefix)) {
      return type;
    }
  }
  return null;
}
