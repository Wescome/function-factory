// mappers/plan-validation.mapper.ts - Maps kernel EvaluationResult to WGSP PlanValidationDataPart

import type { EvaluationResult } from "../kernel/pdp";
import type { PlanValidationDataPart, PlanDimension } from "../stream/data-parts";

/**
 * Transforms a kernel EvaluationResult into a WGSP PlanValidationDataPart.
 * The pvr_id and plan_hash must be provided externally (not part of EvaluationResult).
 */
export function to_plan_validation_data_part(
  result: EvaluationResult,
  pvr_id: string,
  work_order_id: string,
  plan_hash: string,
  re_planning_attempt: number = 0,
): PlanValidationDataPart {
  const dimensions: PlanDimension[] = (result.field_decisions ?? []).map((fd) => ({
    dimension: fd.field as PlanDimension["dimension"],
    result: fd.decision === "PERMIT" ? ("PASS" as const) : ("FAIL" as const),
    details: fd.detail ?? fd.reason_code ?? "",
  }));

  const all_pass = dimensions.every((d) => d.result === "PASS");

  return {
    pvr_id,
    work_order_id,
    plan_hash,
    result: result.decision === "PERMIT" && all_pass ? "VALID" : "INVALID",
    dimensions,
    compliance_certificate: null,
    re_planning_attempt,
    timestamp: result.evaluated_at,
  };
}
