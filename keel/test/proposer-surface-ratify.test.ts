/**
 * PLAYBOOK-KEEL-LIFT-PROPOSER-001 (B.5/B.6) — surfaceCandidate (never
 * certify) and ratifyAndWrite (the ONLY step that touches a spec, and only
 * through freezeGate — D.4/D.7/INV-LP-SURFACE-NOT-CERTIFY).
 */
import { describe, it, expect } from "vitest";
import {
  surfaceCandidate, ratifyAndWrite,
  type LiftCandidate, type SpecificationContent, type GatePolicy,
} from "../src/domain/index";

const candidate = (o: Partial<LiftCandidate> = {}): LiftCandidate => ({
  criterionId: "A1", family: { kind: "bounded", lo: 0, hi: 100 }, openDefeaters: [], status: "candidate", ...o,
});

describe("surfaceCandidate — B.5, never certify", () => {
  it("a surviving candidate -> ready, status becomes surfaced", () => {
    const r = surfaceCandidate(candidate(), false);
    expect(r.ready).toBe(true);
    if (r.ready) expect(r.surfaced.candidate.status).toBe("surfaced");
  });

  it("B.3: a rejected candidate never surfaces as-is", () => {
    const r = surfaceCandidate(candidate({ status: "rejected" }), false);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toMatch(/never surfaced as-is/);
  });

  it("B.2: an invariance claim without domain-owner confirmation is blocked, regardless of surviving challenge", () => {
    const r = surfaceCandidate(candidate({ family: { kind: "invariance", transform: "input + 1" } }), false);
    expect(r.ready).toBe(false);
    if (!r.ready) expect(r.reason).toMatch(/domain-owner confirmation/);
  });

  it("an invariance claim WITH confirmation -> ready", () => {
    const r = surfaceCandidate(candidate({ family: { kind: "invariance", transform: "input + 1" } }), true);
    expect(r.ready).toBe(true);
  });
});

describe("ratifyAndWrite — B.6, D.4/D.7/INV-LP-SURFACE-NOT-CERTIFY", () => {
  const parent: SpecificationContent = {
    intent: "x", connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [], attemptBudget: 2,
    oracleRef: "derived-mr@v1", decomposable: true,
    behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
    acceptance: [{ id: "A1", statement: "value is preserved", kind: "example", behaviorRef: "refund-flow" }],
  };
  const policy: GatePolicy = { effectful: [] };

  it("D.4: not ratified -> nothing written, the parent is untouched", () => {
    const r = ratifyAndWrite(candidate(), { ratified: false, reason: "human declined" }, parent, parent, policy);
    expect(r.written).toBe(false);
    if (!r.written) expect(r.reason).toBe("human declined");
    expect(parent.acceptance[0]?.kind).toBe("example"); // untouched
  });

  it("an unknown criterion id -> nothing written", () => {
    const r = ratifyAndWrite(candidate({ criterionId: "NOPE" }), { ratified: true }, parent, parent, policy);
    expect(r.written).toBe(false);
  });

  it("D.7: ratified but freezeGate-rejects (disposition drifted since propose time, e.g.) -> STILL nothing written -- not exempt", () => {
    // bounded is NOT admissible for "preserve" (only equality/invariance) --
    // this candidate was never actually run through proposeCandidate (which
    // would have caught it at propose time); ratifyAndWrite re-validates
    // independently and rejects it anyway, proving the write path is not
    // exempt from the structural gate.
    const r = ratifyAndWrite(candidate({ family: { kind: "bounded", lo: 0, hi: 100 } }), { ratified: true }, parent, parent, policy);
    expect(r.written).toBe(false);
    if (!r.written) expect(r.reason).toMatch(/freezeGate rejected/);
    expect(parent.acceptance[0]?.kind).toBe("example"); // still untouched
  });

  it("D.2/D.7: a ratified, disposition-admissible, well-scoped candidate IS written, through freezeGate, admissible not exempt", () => {
    const c = candidate({
      family: { kind: "equality", expected: "input * 2" }, // admissible for "preserve"
      applicability: ["input > 0"],
    });
    const r = ratifyAndWrite(c, { ratified: true }, parent, parent, policy);
    expect(r.written).toBe(true);
    if (r.written) {
      expect(r.gate.tier).not.toBe("reject");
      const lifted = r.spec.acceptance.find((a) => a.id === "A1")!;
      expect(lifted.kind).toBe("property");
      expect(lifted.family).toEqual({ kind: "equality", expected: "input * 2" });
      expect(lifted.applicability).toEqual(["input > 0"]);
      // everything else on the spec is unchanged
      expect(r.spec.connectors).toEqual(parent.connectors);
      expect(r.spec.oracleRef).toBe(parent.oracleRef);
    }
    // the original parent object was never mutated
    expect(parent.acceptance[0]?.kind).toBe("example");
  });
});
