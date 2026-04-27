// mappers/escalation.mapper.ts - Maps kernel GovernanceEscalation to WGSP EscalationDataPart

import type { GovernanceEscalation } from "../kernel/escalation";
import type { EscalationDataPart, EscalationRung } from "../stream/data-parts";

// ---------------------------------------------------------------------------
// WGSP §3.12: Escalation rung names (human-readable labels)
// ---------------------------------------------------------------------------

const RUNG_NAMES: Record<EscalationRung, string> = {
  0: "Clarify",
  1: "Constrain",
  2: "Draft-only",
  3: "Approval",
  4: "Dual control",
  5: "Deny + log",
  6: "Break-glass",
};

// ---------------------------------------------------------------------------
// Governance level to approximate rung mapping
// ---------------------------------------------------------------------------

const LEVEL_TO_RUNG: Record<string, EscalationRung> = {
  G0: 0,
  G1: 1,
  G2: 3,
  G3: 5,
};

/**
 * Transforms a kernel GovernanceEscalation into a WGSP EscalationDataPart.
 * Maps the governance level transition to an approximate escalation rung.
 */
export function to_escalation_data_part(esc: GovernanceEscalation): EscalationDataPart {
  const rung: EscalationRung = LEVEL_TO_RUNG[esc.requested_level] ?? 3;

  return {
    escalation_id: esc.escalation_id,
    work_order_id: esc.workspace_id,
    rung,
    rung_name: RUNG_NAMES[rung],
    trigger: esc.trigger.trigger_type,
    trigger_detail: esc.trigger.trigger_details != null
      ? JSON.stringify(esc.trigger.trigger_details)
      : "",
    required_actions: [],
    resolved: esc.status === "APPLIED" || esc.status === "DENIED",
    resolved_at: esc.applied_at ?? null,
    timestamp: esc.applied_at ?? new Date().toISOString(),
  };
}
