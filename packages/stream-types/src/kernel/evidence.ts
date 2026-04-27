// kernel/evidence.ts - Evidence bundle types
// Mirrors weops-enterprise/pkg/evidence/evidence.go

import type { DecisionResponse } from "./policy";
import type { Provenance } from "./provenance";

export interface EvidenceBundle {
  readonly evidence_id: string;
  readonly workspace_id: string;
  readonly work_order_id: string;
  readonly invocation_id: string;
  readonly policy_decision_id: string;
  readonly timestamp: string;
  readonly input_ref?: string;
  readonly input_hash?: string;
  readonly output_ref?: string;
  readonly output_hash?: string;
  readonly policy_decision_snapshot?: DecisionResponse;
  readonly obligations_satisfied?: readonly ObligationSatisfied[];
  readonly duration_ms?: number;
  readonly provenance?: Provenance;
}

export interface ObligationSatisfied {
  readonly obligation_type: string;
  readonly satisfied_by: string;
  readonly satisfied_at?: string;
}
