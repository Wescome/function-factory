/**
 * PLAYBOOK-KEEL-RELATION-SCOPE-001 (R1) — pure gate.ts checks: admittability
 * (isScopeAdmittable) and the three inheritance directions (applicability
 * narrows like attenuates, invalidators grow like forbids, preservationSet
 * carries like spanning). Mirrors test/disposition-inheritance.test.ts's
 * style for the same shape of check.
 */
import { describe, it, expect } from "vitest";
import {
  freezeGate, isScopeAdmittable, inheritsApplicability, inheritsInvalidators, inheritsPreservationSet,
  type GatePolicy,
} from "../src/domain/spec-loop/gate";
import type { SpecificationContent } from "../src/domain/lineage/nodes";

const base: SpecificationContent = {
  intent: "x", acceptance: [{ id: "A1", statement: "s", kind: "example" }],
  connectors: ["echo", "billing"], capabilityCeiling: "connectors-only",
  approvalGated: ["billing"], attemptBudget: 2, oracleRef: "derived-mr@v1",
  forbids: ["write-source", "exceed-budget"],
};
const spec = (o: Partial<SpecificationContent>): SpecificationContent => ({ ...base, ...o });
const policy: GatePolicy = { effectful: ["billing", "gate"] };

describe("PLAYBOOK-KEEL-RELATION-SCOPE-001 — isScopeAdmittable (OD-R1-3)", () => {
  it("Track C: an unscoped criterion (no scope fields at all) -> admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property" }] });
    expect(isScopeAdmittable(child)).toBe(true);
  });

  it("an `example` criterion declaring scope fields is exempt -- scoping is property-only", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "example", preservationSet: ["x"] }] });
    expect(isScopeAdmittable(child)).toBe(true);
  });

  it("D.4: a `property` criterion declaring preservationSet but no applicability -> NOT admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["x"] }] });
    expect(isScopeAdmittable(child)).toBe(false);
  });

  it("D.4: a `property` criterion declaring invalidators but no applicability -> NOT admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input < 0"] }] });
    expect(isScopeAdmittable(child)).toBe(false);
  });

  it("a `property` criterion declaring applicability -> admittable", () => {
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"] }] });
    expect(isScopeAdmittable(child)).toBe(true);
  });

  it("a `property` criterion declaring all three, applicability present -> admittable", () => {
    const child = spec({
      acceptance: [{
        id: "A1", statement: "s", kind: "property",
        applicability: ["input > 0"], invalidators: ["input === 43"], preservationSet: ["value"],
      }],
    });
    expect(isScopeAdmittable(child)).toBe(true);
  });
});

describe("PLAYBOOK-KEEL-RELATION-SCOPE-001 — inheritsApplicability (narrows, like attenuates)", () => {
  it("no matching parent criterion id -> exempt, vacuously true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property" }] });
    const child = spec({ acceptance: [{ id: "A2", statement: "s", kind: "property", applicability: ["input > 0"] }] });
    expect(inheritsApplicability(child, parent)).toBe(true);
  });

  it("child narrows (subset) -> true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0", "input < 100"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"] }] });
    expect(inheritsApplicability(child, parent)).toBe(true);
  });

  it("child carries the exact same set -> true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"] }] });
    expect(inheritsApplicability(child, parent)).toBe(true);
  });

  it("D.5: child WIDENS (adds a condition the parent never declared) -> false", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0", "input < 1000"] }] });
    expect(inheritsApplicability(child, parent)).toBe(false);
  });
});

describe("PLAYBOOK-KEEL-RELATION-SCOPE-001 — inheritsInvalidators (grows, like forbids)", () => {
  it("no matching parent criterion id -> exempt, vacuously true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property" }] });
    const child = spec({ acceptance: [{ id: "A2", statement: "s", kind: "property", applicability: ["input > 0"], invalidators: ["input === 43"] }] });
    expect(inheritsInvalidators(child, parent)).toBe(true);
  });

  it("child carries the same set -> true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input === 43"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input === 43"] }] });
    expect(inheritsInvalidators(child, parent)).toBe(true);
  });

  it("child GROWS (adds a new invalidator) -> true, growth is always allowed", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input === 43"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input === 43", "input === 91"] }] });
    expect(inheritsInvalidators(child, parent)).toBe(true);
  });

  it("D.5: child DROPS a parent invalidator -> false", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input === 43", "input === 91"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", invalidators: ["input === 43"] }] });
    expect(inheritsInvalidators(child, parent)).toBe(false);
  });
});

describe("PLAYBOOK-KEEL-RELATION-SCOPE-001 — inheritsPreservationSet (carried, like spanning; D.6 descriptive-only)", () => {
  it("no matching parent criterion id -> exempt, vacuously true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property" }] });
    const child = spec({ acceptance: [{ id: "A2", statement: "s", kind: "property", applicability: ["input > 0"], preservationSet: ["value"] }] });
    expect(inheritsPreservationSet(child, parent)).toBe(true);
  });

  it("child carries the same set -> true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value"] }] });
    expect(inheritsPreservationSet(child, parent)).toBe(true);
  });

  it("child carries a superset (grows) -> true", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value", "tag"] }] });
    expect(inheritsPreservationSet(child, parent)).toBe(true);
  });

  it("D.6: child DROPS a preserved variable the parent claimed -> false (never silently dropped)", () => {
    const parent = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value", "tag"] }] });
    const child = spec({ acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value"] }] });
    expect(inheritsPreservationSet(child, parent)).toBe(false);
  });
});

describe("PLAYBOOK-KEEL-RELATION-SCOPE-001 — freezeGate integration (D.4/D.5, hard-reject)", () => {
  const parent = spec({
    decomposable: true,
    acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"], invalidators: ["input === 43"], preservationSet: ["value"] }],
  });

  it("D.4: scope fields declared without applicability -> reject, not admittable", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", preservationSet: ["value"] }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("not admittable"))).toBe(true);
  });

  it("D.5: widened applicability -> reject, obligation drift", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0", "input < 1000"], invalidators: ["input === 43"], preservationSet: ["value"] }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("widens applicability"))).toBe(true);
  });

  it("D.5: dropped invalidator -> reject, obligation drift", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"], invalidators: [], preservationSet: ["value"] }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("drops an invalidator"))).toBe(true);
  });

  it("D.5: dropped preserved variable -> reject, obligation drift", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"], invalidators: ["input === 43"], preservationSet: [] }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).toBe("reject");
    expect(d.reasons.some((r) => r.includes("drops a preserved variable"))).toBe(true);
  });

  it("a correctly scoped child (narrowed applicability, grown invalidators, carried preservation) -> not rejected", () => {
    const child = spec({
      connectors: ["echo"], approvalGated: [], servesClause: "A1",
      acceptance: [{ id: "A1", statement: "s", kind: "property", applicability: ["input > 0"], invalidators: ["input === 43", "input === 91"], preservationSet: ["value"] }],
    });
    const d = freezeGate(child, parent, parent, policy);
    expect(d.tier).not.toBe("reject");
  });

  it("D.7 (Track C): an unscoped child under an unscoped parent is unaffected by any R1 check", () => {
    const plainParent = spec({ decomposable: true });
    const child = spec({ connectors: ["echo"], approvalGated: [], servesClause: "A1" });
    const d = freezeGate(child, plainParent, plainParent, policy);
    expect(d.tier).not.toBe("reject");
  });
});
