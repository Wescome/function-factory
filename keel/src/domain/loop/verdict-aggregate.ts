/**
 * verdict-aggregate.ts — PLAYBOOK-KEEL-VERDICT-SET-001 (B.3/B.4): the
 * per-criterion -> overall VerdictOutcome rollup, honest about abstention.
 * `not-applicable` is EXCLUDED from the tally -- a relation out of scope
 * for this case is not a verdict against it, so the run proceeds on the
 * rest. If nothing checkable remains (every criterion excluded, or itself
 * inconclusive), the verdict is `inconclusive` -- never a vacuous ACCEPT
 * (INV-L1-ABSTAIN-SURFACES, B.4).
 *
 * `not-applicable` is only reachable once a relation has an applicability
 * to consult (R1); no adapter emits it today (SuiteOracleAdapter has no
 * applicability concept at all yet). This is the reusable rollup R1 will
 * feed once it exists, proven here against synthetic per-criterion status
 * arrays -- exactly what the playbook's D.3 asks for pending a real R1
 * fixture. SuiteOracleAdapter's own aggregation already calls this (its
 * `unverifiable`/`error` statuses map to `inconclusive` first), so this
 * isn't dormant: it is the actual rollup shipping today, just never yet
 * fed a real `not-applicable`.
 */
import type { VerdictOutcome } from "../lineage/nodes";

export type CriterionVerdictStatus = "pass" | "fail" | "inconclusive" | "not-applicable";

export function aggregateVerdict(statuses: readonly CriterionVerdictStatus[]): VerdictOutcome {
  const applicable = statuses.filter((s) => s !== "not-applicable");
  // Vacuous: every criterion was excluded (or there were none at all) --
  // nothing checkable remains. Never a silent ACCEPT.
  if (applicable.length === 0) return "inconclusive";
  if (applicable.some((s) => s === "inconclusive")) return "inconclusive";
  if (applicable.some((s) => s === "fail")) return "fail";
  return "pass";
}
