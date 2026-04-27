// mappers/work-order.mapper.ts - Maps kernel WorkOrder to WGSP WorkOrderDataPart

import type { WorkOrder } from "../kernel/workorder";
import type { WorkOrderDataPart } from "../stream/data-parts";

/**
 * Transforms a kernel WorkOrder into a WGSP WorkOrderDataPart for streaming.
 * Pure function with no side effects.
 */
export function to_work_order_data_part(wo: WorkOrder): WorkOrderDataPart {
  return {
    work_order_id: wo.work_order_id,
    parent_work_order_id: wo.parent_work_order_id ?? null,
    status: wo.status,
    primary_purpose: wo.primary_purpose,
    acting_role: wo.acting_role,
    stakeholders: [...wo.stakeholders],
    autonomy_tier: wo.autonomy_tier,
    risk_tier: wo.risk_tier,
    decision_rule_on_conflict: wo.decision_rule_on_conflict ?? "ESCALATE_WITH_OPTIONS_MEMO",
    compensation_sub_state: null,
    pending_approvals: (wo.required_approvals ?? []).map((a) => ({
      type: a.type,
      status: a.status,
      required_role: a.by ?? "",
      approver_ref: null,
      granted_at: a.timestamp ?? null,
    })),
    timestamp: new Date().toISOString(),
  };
}
