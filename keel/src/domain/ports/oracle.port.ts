/**
 * oracle.port.ts — OraclePort (driven).
 * VERIFY. The independent Verifier. D2: shares no context with the generating
 * model; confirmed inline-viable on real workerd (S5 green, ~30ms), so a
 * synchronous-style Promise<Verdict> is the frozen shape — no async/queued
 * indirection required for v1.
 */
import type { ExecutionTraceContent, VerdictContent, AcceptanceCriterion } from "../lineage/nodes";

export interface OracleSpec {
  readonly oracleRef: string;
  readonly acceptance: readonly AcceptanceCriterion[];
  /** For metamorphic criteria: the action's code body, so the oracle can
   *  re-probe it over hidden inputs. Additive; verify()'s signature unchanged. */
  readonly action?: { readonly code: string };
  /** PLAYBOOK-KEEL-SPANNING-CHECKABILITY: ids of THIS spec's carried clauses
   *  that are spanning (mirrors `SpecificationContent.spanning`) — CORRECTED
   *  from an assumption in the brief that this already flowed to the oracle;
   *  verified at 4216eab that it did not (`verifyDecide`, run.ts, never
   *  passed it). Additive, like `action?`; lets the adapter distinguish an
   *  uncheckable SPANNING obligation from an ordinary missing-assertion gap
   *  — a set-membership fact the oracle needs but cannot derive from
   *  `acceptance`/`oracleRef` alone. */
  readonly spanning?: readonly string[];
}

export interface OraclePort {
  /** Judge a trace against the spec's acceptance oracle. Independent of the
   *  model that produced the trace (ARCH-KEEL-000 §7). */
  verify(trace: ExecutionTraceContent, spec: OracleSpec): Promise<VerdictContent>;
}
