// validators/envelope.ts - Envelope and EnvelopeResponse validation
// Returns string[] of error messages (empty = valid).

import type { Envelope, EnvelopeResponse } from "../kernel/envelope";
import {
  CHANNEL_VALUES,
  DEVICE_CLASS_VALUES,
  ROLE_VALUES,
  INTENT_TYPE_VALUES,
  GOVERNANCE_LEVEL_VALUES,
  AUTONOMY_TIER_VALUES,
  RISK_TIER_VALUES,
  CLASSIFICATION_VALUES,
  RESPONSE_STATUS_VALUES,
  PDP_DECISION_VALUES,
} from "../kernel/enums";

/**
 * Validates a request Envelope. Checks all required fields and enum values.
 */
export function validate_envelope(e: Envelope): string[] {
  const errors: string[] = [];

  if (!e.envelope_id) errors.push("envelope_id is required");
  if (!e.correlation_id) errors.push("correlation_id is required");
  if (!e.timestamp) errors.push("timestamp is required");

  // Source validation
  if (!e.source) {
    errors.push("source is required");
  } else {
    if (!CHANNEL_VALUES.includes(e.source.channel as typeof CHANNEL_VALUES[number])) {
      errors.push(`source.channel "${e.source.channel}" is not a valid Channel`);
    }
    if (!DEVICE_CLASS_VALUES.includes(e.source.device_class as typeof DEVICE_CLASS_VALUES[number])) {
      errors.push(`source.device_class "${e.source.device_class}" is not a valid DeviceClass`);
    }
  }

  // Session validation
  if (!e.session) {
    errors.push("session is required");
  } else {
    if (!e.session.session_id) errors.push("session.session_id is required");
    if (!e.session.identity_id) errors.push("session.identity_id is required");
    if (!e.session.workspace_id) errors.push("session.workspace_id is required");
    if (!ROLE_VALUES.includes(e.session.active_role as typeof ROLE_VALUES[number])) {
      errors.push(`session.active_role "${e.session.active_role}" is not a valid Role`);
    }
  }

  // Intent validation
  if (!e.intent) {
    errors.push("intent is required");
  } else {
    if (!INTENT_TYPE_VALUES.includes(e.intent.intent_type as typeof INTENT_TYPE_VALUES[number])) {
      errors.push(`intent.intent_type "${e.intent.intent_type}" is not a valid IntentType`);
    }
  }

  // Constraint context validation
  if (!e.constraint_ctx) {
    errors.push("constraint_ctx is required");
  } else {
    if (!GOVERNANCE_LEVEL_VALUES.includes(e.constraint_ctx.governance_level as typeof GOVERNANCE_LEVEL_VALUES[number])) {
      errors.push(`constraint_ctx.governance_level "${e.constraint_ctx.governance_level}" is not valid`);
    }
    if (!AUTONOMY_TIER_VALUES.includes(e.constraint_ctx.autonomy_tier as typeof AUTONOMY_TIER_VALUES[number])) {
      errors.push(`constraint_ctx.autonomy_tier "${e.constraint_ctx.autonomy_tier}" is not valid`);
    }
    if (!RISK_TIER_VALUES.includes(e.constraint_ctx.risk_tier as typeof RISK_TIER_VALUES[number])) {
      errors.push(`constraint_ctx.risk_tier "${e.constraint_ctx.risk_tier}" is not valid`);
    }
    if (!e.constraint_ctx.purpose) {
      errors.push("constraint_ctx.purpose is required");
    }
    if (!CLASSIFICATION_VALUES.includes(e.constraint_ctx.classification as typeof CLASSIFICATION_VALUES[number])) {
      errors.push(`constraint_ctx.classification "${e.constraint_ctx.classification}" is not valid`);
    }
  }

  return errors;
}

/**
 * Validates an EnvelopeResponse. Checks status, governance_applied if present.
 */
export function validate_envelope_response(r: EnvelopeResponse): string[] {
  const errors: string[] = [];

  if (!r.envelope_id) errors.push("envelope_id is required");
  if (!r.correlation_id) errors.push("correlation_id is required");
  if (!r.timestamp) errors.push("timestamp is required");

  if (!RESPONSE_STATUS_VALUES.includes(r.status as typeof RESPONSE_STATUS_VALUES[number])) {
    errors.push(`status "${r.status}" is not a valid ResponseStatus`);
  }

  if (r.governance_applied != null) {
    const ga = r.governance_applied;
    if (!GOVERNANCE_LEVEL_VALUES.includes(ga.effective_level as typeof GOVERNANCE_LEVEL_VALUES[number])) {
      errors.push(`governance_applied.effective_level "${ga.effective_level}" is not valid`);
    }
    if (!PDP_DECISION_VALUES.includes(ga.decision as typeof PDP_DECISION_VALUES[number])) {
      errors.push(`governance_applied.decision "${ga.decision}" is not a valid PDPDecision`);
    }
  }

  return errors;
}
