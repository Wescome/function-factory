/**
 * PLAYBOOK-KEEL-DISPOSITION-001 (A.2/B.5, D.4) — inheritsDisposition, the
 * exact carried-scope pattern as inheritsSpanning (test/spec-loop-gate.test.ts).
 */
import { describe, it, expect } from "vitest";
import { freezeGate, inheritsDisposition, type GatePolicy } from "../src/domain/spec-loop/gate";
import type { SpecificationContent } from "../src/domain/lineage/nodes";

const base: SpecificationContent = {
  intent: "x", acceptance: [{ id: "A1", statement: "s", kind: "example" }],
  connectors: ["echo", "billing"], capabilityCeiling: "connectors-only",
  approvalGated: ["billing"], attemptBudget: 2, oracleRef: "tier@v1",
  forbids: ["write-source", "exceed-budget"],
};
const spec = (o: Partial<SpecificationContent>): SpecificationContent => ({ ...base, ...o });
const policy: GatePolicy = { effectful: ["billing", "gate"] };

describe("PLAYBOOK-KEEL-DISPOSITION-001 — inheritsDisposition (INV-DISP-CARRIED)", () => {
  it("no behaviorRef referenced at all -> vacuously satisfied (Track C: untouched specs never engage this)", () => {
    const parent = spec({});
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "example" }] });
    expect(inheritsDisposition(child, parent)).toBe(true);
  });

  it("D.4: a child referencing a behaviorRef neither it nor the parent carries -> false (never re-guessed, never silently dropped)", () => {
    const parent = spec({});
    const child = spec({
      acceptance: [{ id: "A1", statement: "s", kind: "example", behaviorRef: "refund-flow" }],
    });
    expect(inheritsDisposition(child, parent)).toBe(false);
  });

  it("D.4: the parent carries the entry, the child doesn't -- inherited, never re-guessed", () => {
    const parent = spec({
      behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
    });
    const child = spec({
      acceptance: [{ id: "A1", statement: "s", kind: "example", behaviorRef: "refund-flow" }],
      // child carries NO behaviorDispositions of its own
    });
    expect(inheritsDisposition(child, parent)).toBe(true);
  });

  it("the child carries its own entry -- also fine, doesn't need the parent's", () => {
    const parent = spec({});
    const child = spec({
      acceptance: [{ id: "A1", statement: "s", kind: "example", behaviorRef: "refund-flow" }],
      behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "improve" }],
    });
    expect(inheritsDisposition(child, parent)).toBe(true);
  });

  it("freezeGate: dropping a behavior disposition -> REJECT, obligation drift", () => {
    const parent = spec({
      behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
      decomposable: true,
    });
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "example", behaviorRef: "some-other-behavior" }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("behavior disposition"))).toBe(true);
  });
});
