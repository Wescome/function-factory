/**
 * Phase 6a meta-loop — drives derivation from a human-authored root under the
 * hard bound. Pure (callbacks for admit/backlog); substrate-free (D6). Mirrors the
 * execution loop one level up: DERIVE → gate → {ADMIT | DEFER | REJECT}.
 *
 * Termination is GUARANTEED regardless of the (untrusted) deriver: depth caps
 * recursion, fan-out caps width, budget caps total — the bound dominates (spiked).
 * The root is the authority + prohibition anchor (INV-SPEC-HUMAN-ROOT): every
 * candidate is gated against it, so a human-authored root bounds the whole tree.
 */
import type { SpecificationContent } from "../lineage/nodes";
import type { Deriver } from "./derive";
import { freezeGate, type GatePolicy } from "./gate";
import type { BacklogStore } from "./backlog";
import { checkCoverage } from "./coverage";

export interface SpecLoopBound {
  readonly maxDepth: number;
  readonly maxFanout: number;
  readonly budget: number;
}
export interface SpecLoopCtx {
  readonly deriver: Deriver;
  readonly policy: GatePolicy;
  readonly backlog: BacklogStore;
  readonly bound: SpecLoopBound;
  /** Admit a derived spec into the execution loop. */
  readonly admit: (spec: SpecificationContent, parent: SpecificationContent) => Promise<void>;
  readonly leaseMs: number;
  readonly now: () => number;
}
export interface SpecLoopSummary {
  derived: number;
  admitted: number;
  deferred: number;
  rejected: number;
  escalated: boolean; // budget exhausted, or a coverage gap -> fail-closed to a human
  /** PLAYBOOK-KEEL-COVERAGE: parent acceptance-clause ids that no candidate
   *  in some derive() batch ever claimed. Additive/optional, same shape as
   *  `forbids?`/`servesClause?`/`skills?` elsewhere in the domain. Present
   *  (non-empty) iff at least one parent's expansion was stopped for
   *  under-coverage; accumulated across every such parent in this run. */
  coverageGap?: readonly string[];
}

export async function runSpecLoop(root: SpecificationContent, ctx: SpecLoopCtx): Promise<SpecLoopSummary> {
  const sum: SpecLoopSummary = { derived: 0, admitted: 0, deferred: 0, rejected: 0, escalated: false };
  const coverageGap = new Set<string>();
  const queue: { spec: SpecificationContent; depth: number }[] = [{ spec: root, depth: 0 }];
  while (queue.length) {
    const { spec: parent, depth } = queue.shift()!;
    if (depth >= ctx.bound.maxDepth) continue;                         // depth bound
    const candidates = ctx.deriver.derive(parent, root).slice(0, ctx.bound.maxFanout); // fan-out bound

    // PLAYBOOK-KEEL-COVERAGE: a set check against the WHOLE candidate batch,
    // before any per-candidate gate sees it. Checked on the SLICED list —
    // what will actually be admitted — so a fan-out cap that truncates
    // coverage escalates instead of silently under-covering. Fail-closed and
    // all-or-nothing: admit NONE of this parent's candidates rather than the
    // covered subset (a partial admit is exactly the silent gap this exists
    // to prevent). Stops only THIS parent's expansion — other already-queued
    // parents still get their turn — but `escalated` is still set so the
    // caller can't mistake a partial run for a clean one.
    const coverage = checkCoverage(candidates, parent);
    if (coverage.undischarged.length) {
      for (const id of coverage.undischarged) coverageGap.add(id);
      sum.escalated = true;
      continue;
    }

    for (const cand of candidates) {
      if (sum.derived >= ctx.bound.budget) { sum.escalated = true; break; } // budget bound (fail-closed)
      sum.derived++;
      const { tier } = freezeGate(cand, parent, root, ctx.policy);
      if (tier === "reject") { sum.rejected++; continue; }
      if (tier === "human-preapproval") {
        await ctx.backlog.enqueue(cand, tier, ctx.now() + ctx.leaseMs);
        sum.deferred++;
        continue;
      }
      await ctx.admit(cand, parent);                                    // auto-admit -> execution loop
      sum.admitted++;
      queue.push({ spec: cand, depth: depth + 1 });                    // admitted specs may derive further (bounded)
    }
    if (sum.escalated) break;
  }
  if (coverageGap.size) sum.coverageGap = [...coverageGap].sort();
  return sum;
}
