/**
 * PLAYBOOK-KEEL-COVERAGE: the gate checks one candidate at a time; nothing
 * checked the candidate SET against the parent's acceptance. A deriver that
 * drops a clause passes every per-child check, admits the rest, and reports
 * success — the omitted clause is nobody's. These tests prove the coverage
 * check closes that hole, and that it does so fail-closed (all-or-nothing,
 * never a partial admit) without breaking an honest split.
 */
import { describe, it, expect } from "vitest";
import { clauseIds, checkCoverage, runSpecLoop, templateDeriver, type Deriver, type SpecLoopCtx, type GatePolicy } from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";
import { InMemoryBacklog } from "../src/adapters/spec-loop/in-memory-backlog";

const threeClause: SpecificationContent = {
  intent: "currency snapshot vs USD", capabilityCeiling: "connectors-only",
  acceptance: [
    { id: "A1", statement: "usd_eur is the current USD->EUR rate", kind: "example" },
    { id: "A2", statement: "usd_gbp is the current USD->GBP rate", kind: "example" },
    { id: "A3", statement: "usd_jpy is the current USD->JPY rate", kind: "example" },
  ],
  connectors: ["fx"], approvalGated: [], attemptBudget: 3, oracleRef: "fxrate@v1",
  forbids: [], decomposable: true,
};
const fourClause: SpecificationContent = {
  ...threeClause,
  acceptance: [...threeClause.acceptance, { id: "A4", statement: "usd_chf is the current USD->CHF rate", kind: "example" }],
};
const policy: GatePolicy = { effectful: ["billing", "gate"] };

function ctx(deriver: Deriver, admitted: SpecificationContent[], bound = { maxDepth: 3, maxFanout: 3, budget: 20 }): SpecLoopCtx {
  return { deriver, policy, backlog: new InMemoryBacklog(), bound, leaseMs: 10000, now: () => 1000,
           admit: async (s) => { admitted.push(s); } };
}

describe("clauseIds / checkCoverage — pure", () => {
  it("clauseIds is the set of acceptance criterion ids", () => {
    expect(clauseIds(threeClause)).toEqual(new Set(["A1", "A2", "A3"]));
  });

  it("empty candidates is NOT a gap — decline-to-decompose is legal", () => {
    expect(checkCoverage([], threeClause)).toEqual({ undischarged: [], unanchored: [] });
  });

  it("full coverage (one candidate per clause) -> no gap", () => {
    const candidates = threeClause.acceptance.map((c) => ({ ...threeClause, acceptance: [c], servesClause: c.id }));
    expect(checkCoverage(candidates, threeClause)).toEqual({ undischarged: [], unanchored: [] });
  });

  it("a dropped clause -> undischarged names it", () => {
    const candidates = threeClause.acceptance.slice(0, 2).map((c) => ({ ...threeClause, acceptance: [c], servesClause: c.id }));
    expect(checkCoverage(candidates, threeClause)).toEqual({ undischarged: ["A3"], unanchored: [] });
  });

  it("an absent servesClause is unanchored and does not discharge anything", () => {
    const candidates: SpecificationContent[] = [{ ...threeClause, acceptance: [threeClause.acceptance[0]!] }]; // no servesClause
    const report = checkCoverage(candidates, threeClause);
    expect(report.unanchored).toEqual([""]);
    expect(report.undischarged).toEqual(["A1", "A2", "A3"]);
  });

  it("a servesClause that names no real clause is unanchored and does not discharge anything", () => {
    const candidates: SpecificationContent[] = [{ ...threeClause, acceptance: [threeClause.acceptance[0]!], servesClause: "x" }];
    const report = checkCoverage(candidates, threeClause);
    expect(report.unanchored).toEqual(["x"]);
    expect(report.undischarged).toEqual(["A1", "A2", "A3"]);
  });
});

describe("runSpecLoop — the behavioral proof (milestone 2)", () => {
  it("non-breaking: an honest 3-clause split admits all 3, no coverage gap", async () => {
    const admitted: SpecificationContent[] = [];
    const sum = await runSpecLoop(threeClause, ctx(templateDeriver, admitted));
    expect(sum.admitted).toBe(3);
    expect(sum.escalated).toBe(false);
    expect(sum.coverageGap).toBeUndefined();
  });

  it("a dropping deriver (children for A1, A2 only) -> coverageGap:[A3], escalated, admitted:0 — CONTRAST: before this playbook the same deriver admitted 2 runs and reported success with A3 silently unmet", async () => {
    const admitted: SpecificationContent[] = [];
    const dropping: Deriver = { derive: (p) => p.acceptance.slice(0, 2).map((c) => ({ ...p, acceptance: [c], servesClause: c.id })) };
    const sum = await runSpecLoop(threeClause, ctx(dropping, admitted));
    expect(sum.admitted).toBe(0); // fail-closed: not even the 2 honestly-covered ones
    expect(sum.escalated).toBe(true);
    expect(sum.coverageGap).toEqual(["A3"]);
    expect(admitted).toHaveLength(0);
  });
});

describe("runSpecLoop — fan-out truncation (milestone 4)", () => {
  it("a 4-clause parent against the real maxFanout:3 bound: coverageGap names the sliced-away 4th clause, nothing admitted", async () => {
    const admitted: SpecificationContent[] = [];
    // The REAL bound this project deploys (orchestrator.ts's SPEC_LOOP_BOUND).
    const sum = await runSpecLoop(fourClause, ctx(templateDeriver, admitted, { maxDepth: 3, maxFanout: 3, budget: 20 }));
    expect(sum.coverageGap).toEqual(["A4"]);
    expect(sum.escalated).toBe(true);
    expect(sum.admitted).toBe(0); // fail-closed — NOT "3 admitted, 1 silently lost" (the pre-change behavior)
  });
});

describe("runSpecLoop — decline-to-decompose is not a gap (milestone 5)", () => {
  it("a non-decomposable parent -> candidates:[] -> no coverage error, no escalation", async () => {
    const admitted: SpecificationContent[] = [];
    const nonDecomposable = { ...threeClause, decomposable: false };
    const sum = await runSpecLoop(nonDecomposable, ctx(templateDeriver, admitted));
    expect(sum.admitted).toBe(0);
    expect(sum.escalated).toBe(false);
    expect(sum.coverageGap).toBeUndefined();
  });

  it("a single-clause parent -> candidates:[] -> no coverage error, no escalation", async () => {
    const admitted: SpecificationContent[] = [];
    const singleClause = { ...threeClause, acceptance: [threeClause.acceptance[0]!] };
    const sum = await runSpecLoop(singleClause, ctx(templateDeriver, admitted));
    expect(sum.admitted).toBe(0);
    expect(sum.escalated).toBe(false);
    expect(sum.coverageGap).toBeUndefined();
  });
});
