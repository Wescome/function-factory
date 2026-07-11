/**
 * model.port.ts — ModelPort (driven).
 * GENERATE: a model writes a code action against the spec's permitted
 * connectors. The provider/routing is an adapter detail (AI Gateway); the
 * domain sees only this shape.
 */
import type { SpecificationContent, VerdictContent } from "../lineage/nodes";

export interface GeneratedAction {
  readonly code: string;
  readonly connectors: readonly string[];
}

export interface ModelPort {
  /**
   * Produce a code action for `spec`. On an amend, `evidence` carries the
   * failing verdict so the SAME generation path re-runs with more evidence —
   * there is no separate "fix" path and no model selection inside the loop
   * (ARCH-KEEL-000 §5, invariant b).
   */
  generate(spec: SpecificationContent, evidence?: VerdictContent): Promise<GeneratedAction>;
}
