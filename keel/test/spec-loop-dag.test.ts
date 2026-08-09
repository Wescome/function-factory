/**
 * PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 1): `checkDependencyGraph` is the
 * SAME whole-batch, before-any-admit shape as `checkCoverage`
 * (spec-loop-coverage.test.ts) — a declared-dependency cycle, or a
 * dependency naming a non-sibling, fail-closes the WHOLE batch rather than
 * silently holding a child forever. These tests prove the pure check, its
 * wiring into `runSpecLoop`, and `templateDerive`'s carry of a criterion's
 * `dependsOn` onto its child spec's `dependsOnClauses`.
 */
import { describe, it, expect } from "vitest";
import {
  checkDependencyGraph, runSpecLoop, templateDerive, templateDeriver,
  type Deriver, type SpecLoopCtx, type GatePolicy,
} from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";
import { InMemoryBacklog } from "../src/adapters/spec-loop/in-memory-backlog";

const chainRoot: SpecificationContent = {
  intent: "pipeline demo", capabilityCeiling: "connectors-only",
  acceptance: [
    { id: "A", statement: "A marker", kind: "example" },
    { id: "B", statement: "B marker", kind: "example", dependsOn: ["A"] },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 1, oracleRef: "echo@v1",
  forbids: [], decomposable: true,
};
const cycleRoot: SpecificationContent = {
  ...chainRoot,
  acceptance: [
    { id: "A", statement: "A marker", kind: "example", dependsOn: ["B"] },
    { id: "B", statement: "B marker", kind: "example", dependsOn: ["A"] },
  ],
};
const policy: GatePolicy = { effectful: ["billing", "gate"] };

function ctx(deriver: Deriver, admitted: SpecificationContent[]): SpecLoopCtx {
  return {
    deriver, policy, backlog: new InMemoryBacklog(), bound: { maxDepth: 3, maxFanout: 3, budget: 20 },
    leaseMs: 10000, now: () => 1000, admit: async (s) => { admitted.push(s); },
  };
}

describe("checkDependencyGraph — pure", () => {
  it("no candidate declares a dependency -> trivially ok (Track C, additive)", () => {
    const candidates = chainRoot.acceptance.map((c) => ({ ...chainRoot, acceptance: [c], servesClause: c.id, dependsOnClauses: undefined }));
    expect(checkDependencyGraph(candidates)).toEqual({ ok: true, cycleNodes: [], danglingEdges: [] });
  });

  it("a well-formed chain (B depends on A, both present) -> ok", () => {
    const candidates: SpecificationContent[] = [
      { ...chainRoot, acceptance: [chainRoot.acceptance[0]!], servesClause: "A" },
      { ...chainRoot, acceptance: [chainRoot.acceptance[1]!], servesClause: "B", dependsOnClauses: ["A"] },
    ];
    const report = checkDependencyGraph(candidates);
    expect(report.ok).toBe(true);
    expect(report.cycleNodes).toEqual([]);
    expect(report.danglingEdges).toEqual([]);
  });

  it("a direct cycle (A<->B) -> both named in cycleNodes, not ok", () => {
    const candidates: SpecificationContent[] = [
      { ...cycleRoot, acceptance: [cycleRoot.acceptance[0]!], servesClause: "A", dependsOnClauses: ["B"] },
      { ...cycleRoot, acceptance: [cycleRoot.acceptance[1]!], servesClause: "B", dependsOnClauses: ["A"] },
    ];
    const report = checkDependencyGraph(candidates);
    expect(report.ok).toBe(false);
    expect(report.cycleNodes).toEqual(["A", "B"]);
    expect(report.danglingEdges).toEqual([]);
  });

  it("a dependency naming a non-sibling -> danglingEdges names it, not a cycle", () => {
    const candidates: SpecificationContent[] = [
      { ...chainRoot, acceptance: [chainRoot.acceptance[1]!], servesClause: "B", dependsOnClauses: ["ghost"] },
    ];
    const report = checkDependencyGraph(candidates);
    expect(report.ok).toBe(false);
    expect(report.cycleNodes).toEqual([]);
    expect(report.danglingEdges).toEqual([{ downstream: "B", upstream: "ghost" }]);
  });

  it("a three-node cycle (A -> B -> C -> A) -> all three named", () => {
    const candidates: SpecificationContent[] = [
      { ...chainRoot, acceptance: [], servesClause: "A", dependsOnClauses: ["C"] },
      { ...chainRoot, acceptance: [], servesClause: "B", dependsOnClauses: ["A"] },
      { ...chainRoot, acceptance: [], servesClause: "C", dependsOnClauses: ["B"] },
    ];
    const report = checkDependencyGraph(candidates);
    expect(report.ok).toBe(false);
    expect(report.cycleNodes).toEqual(["A", "B", "C"]);
  });
});

describe("templateDerive — dependsOn carry (C2, INV-HANDOFF-DECLARED)", () => {
  it("a clause's dependsOn is carried onto its child as dependsOnClauses", () => {
    const children = templateDerive(chainRoot, chainRoot);
    const a = children.find((c) => c.servesClause === "A")!;
    const b = children.find((c) => c.servesClause === "B")!;
    expect(a.dependsOnClauses).toBeUndefined();
    expect(b.dependsOnClauses).toEqual(["A"]);
  });

  it("a clause with no dependsOn produces a child with dependsOnClauses undefined (Track C, additive)", () => {
    const noDeps: SpecificationContent = { ...chainRoot, acceptance: chainRoot.acceptance.map((c) => ({ ...c, dependsOn: undefined })) };
    const children = templateDerive(noDeps, noDeps);
    expect(children.every((c) => c.dependsOnClauses === undefined)).toBe(true);
  });
});

describe("runSpecLoop — dependency-graph gate (C2, INV-HANDOFF-CYCLE)", () => {
  it("an honest chain (B depends on A) admits both, no dependencyCycle", async () => {
    const admitted: SpecificationContent[] = [];
    const sum = await runSpecLoop(chainRoot, ctx(templateDeriver, admitted));
    expect(sum.admitted).toBe(2);
    expect(sum.escalated).toBe(false);
    expect(sum.dependencyCycle).toBeUndefined();
  });

  it("a declared cycle escalates the WHOLE batch — fail-closed, nothing admitted (INV-HANDOFF-CYCLE, C2a: no SCC-collapse)", async () => {
    const admitted: SpecificationContent[] = [];
    const sum = await runSpecLoop(cycleRoot, ctx(templateDeriver, admitted));
    expect(sum.admitted).toBe(0);
    expect(sum.escalated).toBe(true);
    expect(sum.dependencyCycle).toEqual(["A", "B"]);
    expect(admitted).toHaveLength(0);
  });

  it("a dependency naming a non-sibling (malformed deriver) also escalates the whole batch, distinct from a genuine cycle", async () => {
    const admitted: SpecificationContent[] = [];
    const dangling: Deriver = {
      derive: (p) => p.acceptance.map((c) => ({ ...p, acceptance: [c], servesClause: c.id, dependsOnClauses: c.id === "B" ? ["ghost"] : undefined })),
    };
    const sum = await runSpecLoop(chainRoot, ctx(dangling, admitted));
    expect(sum.admitted).toBe(0);
    expect(sum.escalated).toBe(true);
    expect(sum.dependencyCycle).toEqual(["B"]);
  });
});
