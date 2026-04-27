// mappers/governance.mapper.ts - Maps kernel governance types to WGSP GovernanceDataPart

import type { GovernanceApplied } from "../kernel/envelope";
import type { DecisionResponse, Obligation } from "../kernel/policy";
import type { GovernanceDataPart, PolicyReason, PolicyObligation } from "../stream/data-parts";

/**
 * Transforms kernel GovernanceApplied + DecisionResponse into a WGSP GovernanceDataPart.
 * The governance_applied provides the decision summary; the full response provides details.
 */
export function to_governance_data_part(
  applied: GovernanceApplied,
  response: DecisionResponse,
  work_order_id: string,
  invocation_id?: string,
  tool_id?: string,
): GovernanceDataPart {
  const reasons: PolicyReason[] = response.reasons.map((r) => ({
    code: r,
    severity: "INFO" as const,
    summary: r,
    detail: r,
    next_steps: null,
  }));

  const obligations: PolicyObligation[] = (response.obligations ?? []).map(
    (o: Obligation) => ({
      type: o.type,
      value: o.value != null ? ({ detail: o.value } as Record<string, unknown>) : {},
      satisfied: false,
    }),
  );

  return {
    policy_decision_id: response.policy_decision_id,
    decision: applied.decision,
    reasons,
    obligations,
    escalation_rung: (response.escalation_rung as GovernanceDataPart["escalation_rung"]) ?? null,
    escalation_trigger: null,
    work_order_id,
    invocation_id: invocation_id ?? null,
    tool_id: tool_id ?? null,
    timestamp: response.evaluated_at,
  };
}
