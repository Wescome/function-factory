/**
 * PLAYBOOK-KEEL-FAMILY-001 (R4) — pure gate.ts checks: isFamilyAdmittable
 * (a declared family must carry what its probe needs) and
 * familyAdmissibleForDisposition (closes D1's OD-DISP-4: a disposition
 * constrains admissible families, a mismatch is a freezeGate reject).
 * Mirrors test/relation-scope-gate.test.ts's style for the same shape of
 * check (R1's isScopeAdmittable / inheritance checks).
 */
import { describe, it, expect } from "vitest";
import {
  freezeGate, isFamilyAdmittable, familyAdmissibleForDisposition,
  type GatePolicy,
} from "../src/domain/spec-loop/gate";
import type { SpecificationContent, PropertyFamily } from "../src/domain/lineage/nodes";

const base: SpecificationContent = {
  intent: "x", acceptance: [{ id: "A1", statement: "s", kind: "example" }],
  connectors: ["echo", "billing"], capabilityCeiling: "connectors-only",
  approvalGated: ["billing"], attemptBudget: 2, oracleRef: "derived-mr@v1",
  forbids: ["write-source", "exceed-budget"],
};
const spec = (o: Partial<SpecificationContent>): SpecificationContent => ({ ...base, ...o });
const policy: GatePolicy = { effectful: ["billing", "gate"] };

describe("PLAYBOOK-KEEL-FAMILY-001 — isFamilyAdmittable (OD-R4-2, executable-or-reject)", () => {
  it("no family at all -> admittable (Track C/INV-R4-ADDITIVE, untyped is unaffected)", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property" }] });
    expect(isFamilyAdmittable(child)).toBe(true);
  });

  it("equality WITHOUT expected -> not admittable (nothing to probe)", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "equality" } }] });
    expect(isFamilyAdmittable(child)).toBe(false);
  });
  it("equality WITH expected -> admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "equality", expected: "input * 2" } }] });
    expect(isFamilyAdmittable(child)).toBe(true);
  });

  it("invariance carries its required transform -> admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "invariance", transform: "input + 1" } }] });
    expect(isFamilyAdmittable(child)).toBe(true);
  });

  it("monotonicity carries its required order -> admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "monotonicity", order: "asc" } }] });
    expect(isFamilyAdmittable(child)).toBe(true);
  });

  it("idempotence needs no parameters -> always admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "idempotence" } }] });
    expect(isFamilyAdmittable(child)).toBe(true);
  });

  it("bounded WITHOUT lo/hi/baseline -> not admittable (nothing to check)", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "bounded" } }] });
    expect(isFamilyAdmittable(child)).toBe(false);
  });
  it("bounded with ANY ONE of lo/hi/baseline -> admittable", () => {
    expect(isFamilyAdmittable(spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "bounded", lo: 0 } }] }))).toBe(true);
    expect(isFamilyAdmittable(spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "bounded", hi: 100 } }] }))).toBe(true);
    expect(isFamilyAdmittable(spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "bounded", baseline: 50 } }] }))).toBe(true);
  });
});

describe("PLAYBOOK-KEEL-FAMILY-001 — familyAdmissibleForDisposition (B.4, INV-R4-DISPOSITION-CONSTRAINS)", () => {
  const withDisposition = (family: PropertyFamily | undefined, disposition: SpecificationContent["behaviorDispositions"]) =>
    spec({
      acceptance: [{ id: "A1", statement: "s", kind: "property", behaviorRef: "refund-flow", family }],
      behaviorDispositions: disposition,
    });

  it("no family at all -> unconstrained regardless of disposition (INV-R4-ADDITIVE)", () => {
    const child = withDisposition(undefined, [{ behaviorRef: "refund-flow", disposition: "preserve" }]);
    expect(familyAdmissibleForDisposition(child, base)).toBe(true);
  });

  it("a family present but no behaviorRef -> nothing to constrain against, admissible", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", family: { kind: "bounded", lo: 0 } }] });
    expect(familyAdmissibleForDisposition(child, base)).toBe(true);
  });

  it("a behaviorRef with no resolvable disposition anywhere -> admissible (nothing to constrain against yet)", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", behaviorRef: "refund-flow", family: { kind: "bounded", lo: 0 } }] });
    expect(familyAdmissibleForDisposition(child, base)).toBe(true);
  });

  it("an explicit unknown disposition -> admissible (mirrors familyMismatch's retired 'unknown never mismatches' rule)", () => {
    const child = withDisposition({ kind: "bounded", lo: 0 }, [{ behaviorRef: "refund-flow", disposition: "unknown" }]);
    expect(familyAdmissibleForDisposition(child, base)).toBe(true);
  });

  it("preserve admits equality and invariance", () => {
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "equality", expected: "42" }, [{ behaviorRef: "refund-flow", disposition: "preserve" }]), base)).toBe(true);
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "invariance", transform: "input" }, [{ behaviorRef: "refund-flow", disposition: "preserve" }]), base)).toBe(true);
  });
  it("C.3: preserve rejects bounded (the playbook's own worked example)", () => {
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "bounded", lo: 0 }, [{ behaviorRef: "refund-flow", disposition: "preserve" }]), base)).toBe(false);
  });
  it("preserve also rejects monotonicity", () => {
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "monotonicity", order: "asc" }, [{ behaviorRef: "refund-flow", disposition: "preserve" }]), base)).toBe(false);
  });

  it("improve admits bounded and monotonicity", () => {
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "bounded", lo: 0 }, [{ behaviorRef: "refund-flow", disposition: "improve" }]), base)).toBe(true);
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "monotonicity", order: "asc" }, [{ behaviorRef: "refund-flow", disposition: "improve" }]), base)).toBe(true);
  });
  it("improve rejects equality", () => {
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "equality", expected: "42" }, [{ behaviorRef: "refund-flow", disposition: "improve" }]), base)).toBe(false);
  });

  it("deprecate admits NO typed family -- 'absence' means untyped only", () => {
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "equality", expected: "42" }, [{ behaviorRef: "refund-flow", disposition: "deprecate" }]), base)).toBe(false);
    expect(familyAdmissibleForDisposition(withDisposition({ kind: "idempotence" }, [{ behaviorRef: "refund-flow", disposition: "deprecate" }]), base)).toBe(false);
  });
  it("deprecate with no family declared at all -> admissible (absence, satisfied)", () => {
    expect(familyAdmissibleForDisposition(withDisposition(undefined, [{ behaviorRef: "refund-flow", disposition: "deprecate" }]), base)).toBe(true);
  });

  it("intentionally-change admits any family", () => {
    for (const family of [
      { kind: "equality" as const, expected: "42" },
      { kind: "invariance" as const, transform: "input" },
      { kind: "monotonicity" as const, order: "asc" as const },
      { kind: "idempotence" as const },
      { kind: "bounded" as const, lo: 0 },
    ]) {
      expect(familyAdmissibleForDisposition(withDisposition(family, [{ behaviorRef: "refund-flow", disposition: "intentionally-change" }]), base)).toBe(true);
    }
  });
});

describe("PLAYBOOK-KEEL-FAMILY-001 — freezeGate integration (C.3, hard-reject)", () => {
  const parent = spec({
    decomposable: true,
    behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
    acceptance: [{ id: "A1", statement: "s", kind: "property", behaviorRef: "refund-flow" }],
  });

  it("a family declared without its required parameter -> reject, not admittable", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", behaviorRef: "refund-flow", family: { kind: "equality" } }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("not admittable"))).toBe(true);
  });

  it("C.3: a preserve behavior with a bounded relation -> reject (was a D1 warning, now enforced)", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", behaviorRef: "refund-flow", family: { kind: "bounded", lo: 0 } }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("mismatches its behavior disposition"))).toBe(true);
  });

  it("C.3: a preserve behavior with equality -> admitted, not rejected on family grounds", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", behaviorRef: "refund-flow", family: { kind: "equality", expected: "42" } }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).not.toBe("reject");
  });

  it("C.5/Track C: an untyped relation under any disposition is unaffected by any R4 check", () => {
    const child = spec({ connectors: ["echo"], approvalGated: [], servesClause: "A1" });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).not.toBe("reject");
  });
});
