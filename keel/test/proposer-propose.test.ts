/**
 * PLAYBOOK-KEEL-LIFT-PROPOSER-001 (B.1) — proposeCandidate: the candidate
 * artifact never touches a spec, and only a typed, disposition-admissible
 * family (INV-LP-PROPOSE-TYPED / INV-LP-DISPOSITION-BOUNDED) is admitted
 * into the loop at all, reusing R4's own gate.ts checks so the proposer and
 * freezeGate can never disagree.
 */
import { describe, it, expect } from "vitest";
import { proposeCandidate } from "../src/domain/index";

describe("proposeCandidate — B.1, INV-LP-PROPOSE-TYPED / INV-LP-DISPOSITION-BOUNDED", () => {
  it("a valid, disposition-admissible family -> admitted, a fresh candidate artifact", () => {
    const r = proposeCandidate("A1", { kind: "bounded", lo: 0, hi: 100 }, "improve");
    expect(r.admitted).toBe(true);
    if (r.admitted) {
      expect(r.candidate).toEqual({
        criterionId: "A1",
        family: { kind: "bounded", lo: 0, hi: 100 },
        applicability: undefined,
        invalidators: undefined,
        preservationSet: undefined,
        openDefeaters: [],
        status: "candidate",
      });
    }
  });

  it("INV-LP-PROPOSE-TYPED: a family lacking its required parameter -> rejected outright, never a candidate", () => {
    const r = proposeCandidate("A1", { kind: "equality" }, "preserve");
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toMatch(/not executable/);
  });

  it("INV-LP-DISPOSITION-BOUNDED: a family the disposition doesn't admit -> rejected (reuses R4's familyAdmitsDisposition)", () => {
    const r = proposeCandidate("A1", { kind: "equality", expected: "input * 2" }, "improve");
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toMatch(/not admissible for disposition/);
  });

  it("a disposition-admissible family is accepted even under 'unknown' (nothing to constrain against yet)", () => {
    const r = proposeCandidate("A1", { kind: "bounded", lo: 0 }, "unknown");
    expect(r.admitted).toBe(true);
  });

  it("intentionally-change admits any typed family", () => {
    const r = proposeCandidate("A1", { kind: "idempotence" }, "intentionally-change");
    expect(r.admitted).toBe(true);
  });

  it("deprecate admits no typed family at all", () => {
    const r = proposeCandidate("A1", { kind: "equality", expected: "42" }, "deprecate");
    expect(r.admitted).toBe(false);
  });

  it("initial scope carries onto the candidate (A.2: a candidate may start scoped, not just gain scope through narrowing)", () => {
    const r = proposeCandidate("A1", { kind: "invariance", transform: "input + 1" }, "preserve", { applicability: ["input > 0"] });
    expect(r.admitted).toBe(true);
    if (r.admitted) expect(r.candidate.applicability).toEqual(["input > 0"]);
  });

  it("initial scope declaring invalidators without applicability -> rejected (mirrors isScopeAdmittable)", () => {
    const r = proposeCandidate("A1", { kind: "bounded", lo: 0 }, "improve", { invalidators: ["input === 0"] });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toMatch(/not admittable/);
  });
});
