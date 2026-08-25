/**
 * grounding-gate.port.ts — GroundingGatePort (driven), PLAYBOOK-KEEL-
 * GROUNDING-001 (B1). Seated before `generate()` (run.ts): grades
 * `spec.acceptance` against recorded fact BEFORE any code exists for this
 * attempt, and emits a verdict the same way `OraclePort.verify()` does —
 * same `VerdictContent` shape, so the loop's existing decide()/repo-append
 * machinery needs no new type to route on.
 */
import type { SpecificationContent, VerdictContent } from "../lineage/nodes";

export interface GroundingGatePort {
  /** `evidence`: the PRIOR attempt's own oracle verdict, if any (mirrors
   *  `ModelPort.generate`'s `evidence` param) — the oracle grader's
   *  "contradicted" label reads `evidence.results[criterionId]`, a real,
   *  already-recorded fact from a real prior execution, never a guess. */
  grade(spec: SpecificationContent, evidence?: VerdictContent): Promise<VerdictContent>;
}
