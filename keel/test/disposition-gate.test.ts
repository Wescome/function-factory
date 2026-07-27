/**
 * PLAYBOOK-KEEL-DISPOSITION-001 — GroundingGateAdapter's disposition overlay,
 * end to end at the adapter level (mirrors how the grounding-gate playbook
 * itself tested SandboxOracleAdapter/GroundingGateAdapter directly).
 */
import { describe, it, expect, vi } from "vitest";
import { GroundingGateAdapter } from "../src/adapters/grounding/grounding-gate.adapter";
import { InMemorySuiteRegistry } from "../src/adapters/oracle/suite";
import type { JudgeGraderPort, BehaviorLedgerPort, SpecificationContent } from "../src/domain/index";

const baseSpec = (o: Partial<SpecificationContent>): SpecificationContent => ({
  intent: "n/a", connectors: [], capabilityCeiling: "connectors-only", approvalGated: [], attemptBudget: 1,
  oracleRef: "echo@v1", // has a real assertion for A1 (grounds it -- see suite.ts)
  acceptance: [{ id: "A1", statement: "value is 42", kind: "example" }],
  ...o,
});

const abstainingJudge: JudgeGraderPort = { grade: vi.fn(async () => ({ label: "abstain" as const, evidenceType: "model-inferred" as const })) };

describe("PLAYBOOK-KEEL-DISPOSITION-001 (D.2) — unknown blocks, zero grounding-pass", () => {
  it("a behaviorRef with no local entry and no ledger -> unknown -> escalate, judge never even called", async () => {
    const judge: JudgeGraderPort = { grade: vi.fn(async () => ({ label: "surface-grounded" as const, evidenceType: "model-inferred" as const })) };
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), judge);
    const spec = baseSpec({ acceptance: [{ id: "A1", statement: "value is 42", kind: "example", behaviorRef: "refund-flow" }] });

    const v = await gate.grade(spec);
    expect(v.outcome).toBe("escalate");
    expect(v.results.A1).toBe("fail");
    // A1 is oracle-grounded (echo@v1 has a real assertion) -- without the
    // disposition overlay this would ground on the FIRST call, never even
    // reaching the judge. Confirming it's still zero calls either way.
    expect(judge.grade).not.toHaveBeenCalled();
  });

  it("even oracle-CONTRADICTED (a genuinely bad test) still routes through unknown as escalate, not fail -- unknown outranks everything", async () => {
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge);
    const spec = baseSpec({ acceptance: [{ id: "A1", statement: "value is 42", kind: "example", behaviorRef: "refund-flow" }] });
    const priorFail = {
      outcome: "fail" as const, results: { A1: "fail" as const }, evidence: {}, oracleRef: "echo@v1", attempt: 1, ms: 0,
    };
    const v = await gate.grade(spec, priorFail);
    expect(v.outcome).toBe("escalate"); // NOT "fail" -- unknown, not merely contradicted
  });
});

describe("PLAYBOOK-KEEL-DISPOSITION-001 (D.3) — authority routes through the existing chain", () => {
  it("intentionally-change with a MATCHING root authority -> grounding proceeds normally (grounded)", async () => {
    const ledger: BehaviorLedgerPort = {
      resolve: async () => ({ behaviorRef: "refund-flow", behaviorDisposition: "intentionally-change", authority: "root-1", rationale: "r", assignedBy: "owner" }),
    };
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge, undefined, ledger);
    const spec = baseSpec({
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example", behaviorRef: "refund-flow" }],
      derivedFrom: { parent: "p1", root: "root-1" }, // matches the ledger's recorded authority
    });
    const v = await gate.grade(spec);
    expect(v.outcome).toBe("pass"); // grounded, and authority matches -> proceeds
  });

  it("intentionally-change with a MISMATCHED root authority -> escalate even though the oracle grounds it (grounding alone isn't sufficient)", async () => {
    const ledger: BehaviorLedgerPort = {
      resolve: async () => ({ behaviorRef: "refund-flow", behaviorDisposition: "intentionally-change", authority: "root-1", rationale: "r", assignedBy: "owner" }),
    };
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge, undefined, ledger);
    const spec = baseSpec({
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example", behaviorRef: "refund-flow" }],
      derivedFrom: { parent: "p1", root: "root-2" }, // does NOT match "root-1"
    });
    const v = await gate.grade(spec);
    expect(v.outcome).toBe("escalate");
  });

  it("preserve/improve/deprecate decide at the current authority when grounded -- no root-matching required", async () => {
    const ledger: BehaviorLedgerPort = {
      resolve: async () => ({ behaviorRef: "refund-flow", behaviorDisposition: "preserve", authority: "irrelevant-here", rationale: "r", assignedBy: "owner" }),
    };
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge, undefined, ledger);
    const spec = baseSpec({
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example", behaviorRef: "refund-flow" }],
      derivedFrom: { parent: "p1", root: "some-other-root" }, // deliberately doesn't match "irrelevant-here"
    });
    const v = await gate.grade(spec);
    expect(v.outcome).toBe("pass"); // preserve doesn't need authority routing at all
  });
});

describe("PLAYBOOK-KEEL-DISPOSITION-001 (D.5) — family mismatch surfaces, never blocks", () => {
  it("preserve (implies equality) on a property-kind criterion (implies bound) -> a warning in evidence, outcome still follows the base grading", async () => {
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge);
    const spec = baseSpec({
      acceptance: [{ id: "A1", statement: "value is 42", kind: "property", behaviorRef: "refund-flow" }],
      behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
    });
    const v = await gate.grade(spec);
    expect(v.outcome).toBe("pass"); // NOT blocked by the mismatch
    const dispositions = (v.evidence as { dispositions: Record<string, { familyWarning: boolean }> }).dispositions;
    expect(dispositions.A1?.familyWarning).toBe(true);
  });

  it("a MATCHING family (preserve on an example criterion) -> no warning", async () => {
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge);
    const spec = baseSpec({
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example", behaviorRef: "refund-flow" }],
      behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
    });
    const v = await gate.grade(spec);
    const dispositions = (v.evidence as { dispositions: Record<string, { familyWarning: boolean }> }).dispositions;
    expect(dispositions.A1?.familyWarning).toBe(false);
  });
});

describe("PLAYBOOK-KEEL-DISPOSITION-001 (Track C) — a criterion with no behaviorRef is untouched", () => {
  it("byte-for-byte: no behaviorRef -> no disposition entry in evidence, grading proceeds exactly as the grounding gate alone would", async () => {
    const gate = new GroundingGateAdapter(new InMemorySuiteRegistry(), abstainingJudge);
    const spec = baseSpec({}); // A1 has no behaviorRef
    const v = await gate.grade(spec);
    expect(v.outcome).toBe("pass");
    const dispositions = (v.evidence as { dispositions: Record<string, unknown> }).dispositions;
    expect(dispositions).toEqual({});
  });
});
