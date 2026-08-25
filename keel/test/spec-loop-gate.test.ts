/** Phase 6a freeze gate — the safety core, over real Specification content. */
import { describe, it, expect } from "vitest";
import { freezeGate, attenuates, inheritsProhibitions, inheritsSpanning, type GatePolicy } from "../src/domain/spec-loop/gate";
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

describe("PLAYBOOK-KEEL-SPANNING — inheritsSpanning (INV-DECOMP-3, the positive dual)", () => {
  const spanningParent: SpecificationContent = spec({
    acceptance: [
      { id: "A1", statement: "s1", kind: "example" },
      { id: "A2", statement: "s2", kind: "example" },
      { id: "A4", statement: "every presented amount is in whole minor units", kind: "property" },
    ],
    spanning: ["A4"],
    decomposable: true,
  });

  it("no spanning declared on the parent -> vacuously satisfied regardless of the child's acceptance", () => {
    const plainParent = spec({}); // base has no `spanning` field at all
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "example" }] });
    expect(inheritsSpanning(child, plainParent)).toBe(true);
  });

  it("the drop, caught: a child that carries its served clause but omits the spanning clause -> false", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s1", kind: "example" }], // A4 dropped
    });
    expect(inheritsSpanning(child, spanningParent)).toBe(false);
  });

  it("a child that carries both its served clause and the spanning clause -> true", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [
        { id: "A1", statement: "s1", kind: "example" },
        { id: "A4", statement: "every presented amount is in whole minor units", kind: "property" },
      ],
    });
    expect(inheritsSpanning(child, spanningParent)).toBe(true);
  });

  it("freezeGate: dropping a spanning clause -> REJECT, reason names obligation drift — before this playbook the identical child (attenuating, prohibition-inheriting, mapped) auto-admitted, since nothing checked spanning at all", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s1", kind: "example" }], // A4 dropped — a model-style deriver's mistake
    });
    // Confirm every OTHER hard check independently passes — the only thing
    // that fails here is spanning, isolating exactly what this playbook adds.
    expect(attenuates(child, spanningParent)).toBe(true);
    expect(inheritsProhibitions(child, root)).toBe(true);
    const decision = freezeGate(child, spanningParent, root, policy);
    expect(decision.tier).toBe("reject");
    expect(decision.reasons).toContain("drops a spanning requirement (obligation drift)");
  });

  it("freezeGate: carrying the spanning clause -> passes the spanning check (falls through to auto-admit)", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [
        { id: "A1", statement: "s1", kind: "example" },
        { id: "A4", statement: "every presented amount is in whole minor units", kind: "property" },
      ],
    });
    const decision = freezeGate(child, spanningParent, root, policy);
    expect(decision.tier).toBe("auto-admit");
    expect(decision.reasons).not.toContain("drops a spanning requirement (obligation drift)");
  });

  it("presence, not satisfaction: the gate only checks the clause is PRESENT — it has no oracle, so it cannot and does not judge whether the child's eventual result would satisfy it", () => {
    // A child carrying A4 passes the gate regardless of what A4's statement
    // even says — freezeGate never evaluates a trace or a result, only ids.
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [
        { id: "A1", statement: "s1", kind: "example" },
        { id: "A4", statement: "a spanning clause whose statement is irrelevant to presence", kind: "property" },
      ],
    });
    expect(inheritsSpanning(child, spanningParent)).toBe(true);
    expect(freezeGate(child, spanningParent, root, policy).tier).toBe("auto-admit");
  });
});
