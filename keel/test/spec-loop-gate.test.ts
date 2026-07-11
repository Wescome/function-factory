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
    const child = spec({ connectors: ["echo"], approvalGated: [], servesClause: "reconcile" });
    expect(freezeGate(child, parent, root, policy).tier).toBe("auto-admit");
  });
  it("adds a connector (amplifies) -> REJECT", () => {
    const child = spec({ connectors: ["echo", "billing", "net"], servesClause: "x" });
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
  it("un-gates a parent-gated connector -> REJECT (attenuation)", () => {
    const child = spec({ connectors: ["echo", "billing"], approvalGated: [], servesClause: "x" });
    expect(attenuates(child, parent)).toBe(false);
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
  it("drops a root prohibition -> REJECT (intent drift)", () => {
    const child = spec({ connectors: ["echo"], approvalGated: [], forbids: ["exceed-budget"], servesClause: "x" });
    expect(inheritsProhibitions(child, root)).toBe(false);
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
  it("attenuating but NO goal mapping -> HUMAN-PREAPPROVAL", () => {
    const child = spec({ connectors: ["echo"], approvalGated: [] }); // no servesClause
    expect(freezeGate(child, parent, root, policy).tier).toBe("human-preapproval");
  });
  it("attenuating + mapped but AUTONOMOUS EFFECTFUL reach -> HUMAN-PREAPPROVAL", () => {
    // parent that had billing ungated, so child attenuates yet is effectful
    const effParent = spec({ approvalGated: [] });
    const child = spec({ connectors: ["billing"], approvalGated: [], servesClause: "x" });
    expect(attenuates(child, effParent)).toBe(true);
    expect(freezeGate(child, effParent, root, policy).tier).toBe("human-preapproval");
  });
  it("malformed (no acceptance) -> REJECT", () => {
    const child = spec({ acceptance: [], connectors: ["echo"], approvalGated: [], servesClause: "x" });
    expect(freezeGate(child, parent, root, policy).tier).toBe("reject");
  });
});
