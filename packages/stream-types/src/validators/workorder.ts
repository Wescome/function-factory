// validators/workorder.ts - WorkOrder validation and state transition checks
// Returns string[] of error messages (empty = valid).

import type { WorkOrder } from "../kernel/workorder";
import type { WorkOrderStatus } from "../kernel/enums";
import {
  WORK_ORDER_STATUS_VALUES,
  AUTONOMY_TIER_VALUES,
  RISK_TIER_VALUES,
} from "../kernel/enums";
import { ALLOWED_TRANSITIONS } from "../kernel/workorder";
import { validate_purpose } from "../kernel/taxonomy";

/**
 * Validates a WorkOrder. Checks required fields and valid enum values.
 */
export function validate_work_order(wo: WorkOrder): string[] {
  const errors: string[] = [];

  if (!wo.work_order_id) errors.push("work_order_id is required");
  if (!wo.workspace_id) errors.push("workspace_id is required");

  if (!WORK_ORDER_STATUS_VALUES.includes(wo.status as typeof WORK_ORDER_STATUS_VALUES[number])) {
    errors.push(`status "${wo.status}" is not a valid WorkOrderStatus`);
  }

  if (!AUTONOMY_TIER_VALUES.includes(wo.autonomy_tier as typeof AUTONOMY_TIER_VALUES[number])) {
    errors.push(`autonomy_tier "${wo.autonomy_tier}" is not a valid AutonomyTier`);
  }

  if (!RISK_TIER_VALUES.includes(wo.risk_tier as typeof RISK_TIER_VALUES[number])) {
    errors.push(`risk_tier "${wo.risk_tier}" is not a valid RiskTier`);
  }

  if (!wo.primary_purpose) {
    errors.push("primary_purpose is required");
  } else if (!validate_purpose(wo.primary_purpose)) {
    errors.push(`primary_purpose "${wo.primary_purpose}" is not a valid purpose`);
  }

  if (!wo.acting_role) errors.push("acting_role is required");

  return errors;
}

/**
 * Validates a state transition against the WorkOrder state machine.
 * Returns null if the transition is valid, or an error message string.
 */
export function validate_transition(from: WorkOrderStatus, to: WorkOrderStatus): string | null {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed == null) {
    return `unknown source status: ${from}`;
  }
  if (!allowed.includes(to)) {
    return `transition from ${from} to ${to} is not allowed (valid: ${allowed.join(", ") || "none"})`;
  }
  return null;
}
