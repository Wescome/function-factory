/**
 * Phase 6a [4]+[5]: the meta-loop. Routing by tier + TERMINATION under an
 * adversarial deriver (the instance validation of the proven bound).
 */
import { describe, it, expect } from "vitest";
import { runSpecLoop, templateDeriver, type Deriver, type SpecLoopCtx, type GatePolicy } from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";
import { InMemoryBacklog } from "../src/adapters/spec-loop/in-memory-backlog";

const root: SpecificationContent = {
  intent: "reconcile ledgers", capabilityCeiling: "connectors-only",
  acceptance: [
    { id: "A1", statement: "totals match", kind: "example" },
    { id: "A2", statement: "discrepancies flagged", kind: "property" },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
  forbids: ["write-source"], decomposable: true,
};
const policy: GatePolicy = { effectful: ["billing", "gate"] };

function ctx(deriver: Deriver, admitted: SpecificationContent[], bound = { maxDepth: 3, maxFanout: 3, budget: 20 }): SpecLoopCtx {
  return { deriver, policy, backlog: new InMemoryBacklog(), bound, leaseMs: 10000, now: () => 1000,
           admit: async (s) => { admitted.push(s); } };
}

describe("6a [4] meta-loop routing", () => {
  it("template derivation from a multi-criterion root -> admits the safe sub-specs", async () => {
    const admitted: SpecificationContent[] = [];
    const sum = await runSpecLoop(root, ctx(templateDeriver, admitted));
    expect(sum.admitted).toBeGreaterThan(0);
    expect(sum.rejected).toBe(0);
    expect(admitted.every((s) => s.forbids?.includes("write-source"))).toBe(true); // prohibitions inherited
  });

  it("adversarial deriver (amplifying specs) -> ALL rejected, none admitted", async () => {
    const admitted: SpecificationContent[] = [];
    // PLAYBOOK-KEEL-COVERAGE: one candidate PER clause (servesClause: c.id) so
    // the coverage check passes (fully covered) and it's the PER-CANDIDATE
    // amplification check — the thing this test is actually about — that
    // fires, not an incidental coverage gap from only ever proposing one child.
    const amp: Deriver = { derive: (p) => p.acceptance.map((c) => ({ ...p, acceptance: [c], connectors: [...p.connectors, "net"], servesClause: c.id })) };
    const sum = await runSpecLoop(root, ctx(amp, admitted));
    expect(sum.admitted).toBe(0);
    expect(sum.rejected).toBeGreaterThan(0);
  });

  it("effectful candidate (autonomous effectful reach) -> DEFERRED to human, not admitted", async () => {
    const admitted: SpecificationContent[] = [];
    const effRoot = { ...root, connectors: ["echo", "billing"], approvalGated: [] };
    // Same fix: one candidate per real clause, so coverage passes and the
    // effectful-reach check is what's actually under test.
    const eff: Deriver = { derive: (p) => p.acceptance.map((c) => ({ ...p, acceptance: [c], connectors: ["billing"], approvalGated: [], servesClause: c.id })) };
    const sum = await runSpecLoop(effRoot, ctx(eff, admitted));
    expect(sum.deferred).toBeGreaterThan(0);
    expect(sum.admitted).toBe(0);
  });
});

describe("6a [5] termination (bound dominates an adversarial deriver)", () => {
  it("a deriver that always returns many valid children HALTS, within budget, escalates", async () => {
    const admitted: SpecificationContent[] = [];
    // always returns 5 valid attenuating sub-specs -> would explode without the bound.
    // PLAYBOOK-KEEL-COVERAGE: servesClause cycles through the PARENT's real
    // clause ids (not a fabricated "c${i}") so every batch is fully covered —
    // this test is about the BUDGET bound, and must not accidentally trip the
    // coverage gate instead (which would halt on the first batch via a
    // coverage escalation and never actually exercise budget exhaustion).
    const flood: Deriver = { derive: (p) => Array.from({ length: 5 }, (_, i) => ({
      ...p, acceptance: [p.acceptance[0]!], servesClause: p.acceptance[i % p.acceptance.length]!.id,
    })) };
    const sum = await runSpecLoop(root, ctx(flood, admitted, { maxDepth: 5, maxFanout: 3, budget: 12 }));
    expect(sum.derived).toBeLessThanOrEqual(12); // budget held
    expect(sum.escalated).toBe(true);            // fail-closed on exhaustion
    expect(sum.coverageGap).toBeUndefined();      // escalated for BUDGET, not a coverage gap
    // (the test returning at all IS the termination proof — no hang)
  });
});
