/** Phase 6a freeze gate — the safety core, over real Specification content. */
import { describe, it, expect } from "vitest";
import { freezeGate, attenuates, inheritsProhibitions, type GatePolicy } from "../src/domain/spec-loop/gate";
import type { SpecificationContent } from "../src/domain/lineage/nodes";

const base: SpecificationContent = {
  intent: "x", acceptance: [{ id: "A1", statement: "s", kind: "example" }],
  connectors: ["echo", "billing"], capabilityCeiling: "connectors-only",
  approvalGated: ["billing"], attemptBudget: 2, oracleRef: "tier@v1",
  forbids: ["write-source", "exceed-budget"],
};
const spec = (o: Partial<SpecificationContent>): SpecificationContent => ({ ...base, ...o });
const policy: GatePolicy = { effectful: ["billing", "gate"] };
const root = base;           // human-authored root
const parent = base;         // attenuation anchor

describe("6a freeze gate", () => {
  it("attenuating + reversible + mapped + inherits -> AUTO-ADMIT", () => {
    // servesClause must resolve to a REAL parent clause (PLAYBOOK-KEEL-COVERAGE
    // anchor) — parent's only clause is "A1".
    const child = spec({ connectors: ["echo"], approvalGated: [], servesClause: "A1" });
    expect(freezeGate(child, parent, root, policy).tier).toBe("auto-admit");
  });
  it("adds a connector (amplifies) -> REJECT", () => {
    const child = spec({ connectors: ["echo", "billing", "net"], servesClause: "A1" });
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
  it("un-gates a parent-gated connector -> REJECT (attenuation)", () => {
    const child = spec({ connectors: ["echo", "billing"], approvalGated: [], servesClause: "A1" });
    expect(attenuates(child, parent)).toBe(false);
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
  it("drops a root prohibition -> REJECT (intent drift)", () => {
    const child = spec({ connectors: ["echo"], approvalGated: [], forbids: ["exceed-budget"], servesClause: "A1" });
    expect(inheritsProhibitions(child, root)).toBe(false);
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
  it("attenuating but NO goal mapping -> HUMAN-PREAPPROVAL", () => {
    const child = spec({ connectors: ["echo"], approvalGated: [] }); // no servesClause
    expect(freezeGate(child, parent, root, policy).tier).toBe("human-preapproval");
  });
  it("servesClause present but does not resolve to a parent clause -> REJECT (PLAYBOOK-KEEL-COVERAGE anchor)", () => {
    // this is the test that used to read `servesClause: "x"` and pass under the
    // OLD presence-only hasGoalMapping — that was the defect the anchor closes.
    const child = spec({ connectors: ["echo"], approvalGated: [], servesClause: "x" });
    const decision = freezeGate(child, parent, root, policy);
    expect(decision.tier).toBe("reject");
    expect(decision.reasons).toContain("servesClause does not resolve to a parent acceptance clause");
  });
  it("attenuating + mapped but AUTONOMOUS EFFECTFUL reach -> HUMAN-PREAPPROVAL", () => {
    // parent that had billing ungated, so child attenuates yet is effectful
    const effParent = spec({ approvalGated: [] });
    const child = spec({ connectors: ["billing"], approvalGated: [], servesClause: "A1" });
    expect(attenuates(child, effParent)).toBe(true);
    expect(freezeGate(child, effParent, root, policy).tier).toBe("human-preapproval");
  });
  it("malformed (no acceptance) -> REJECT", () => {
    const child = spec({ acceptance: [], connectors: ["echo"], approvalGated: [], servesClause: "A1" });
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
});
