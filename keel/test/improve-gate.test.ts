/** Improvement-loop validation gate: verified + monotone + oracle-fixed, and the
 *  statistical (Wilson CI-separation) gate matching the spike. */
import { describe, it, expect } from "vitest";
import { evaluateImprovement, evaluateHarnessFix, wilsonInterval, ciSeparated } from "../src/domain/index";

const P = (b: boolean, a: boolean) => ({ beforeAccepted: b, afterAccepted: a });

describe("deterministic gate (crystallized procedures / harness fixes)", () => {
  it("promotes when a target flips to a NEW verified ACCEPT with no regressions", () => {
    const d = evaluateImprovement({ id: "i1", surfaces: ["procedure"],
      targets: [P(false, true)], regression: [P(true, true), P(true, true)] });
    expect(d.promote).toBe(true);
  });
  it("INV-IMPROVE-ORACLE-FIXED: rejects anything touching the oracle/suite", () => {
    const d = evaluateImprovement({ id: "i2", surfaces: ["connector-doc", "oracle"],
      targets: [P(false, true)], regression: [] });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("oracle is fixed");
  });
  it("INV-IMPROVE-VERIFIED: rejects when there is no NEW ACCEPT (self-score is not evidence)", () => {
    const d = evaluateImprovement({ id: "i3", surfaces: ["amend-prompt"],
      targets: [P(false, false)], regression: [] });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("no target produced a NEW verified ACCEPT");
  });
  it("INV-IMPROVE-MONOTONE: rejects if any regression trace loses its ACCEPT", () => {
    const d = evaluateImprovement({ id: "i4", surfaces: ["deriver"],
      targets: [P(false, true)], regression: [P(true, false)] });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("regression");
  });
  it("rejects if a target LOSES its ACCEPT (improvement broke a passing case)", () => {
    const d = evaluateImprovement({ id: "i5", surfaces: ["procedure"],
      targets: [P(false, true), P(true, false)], regression: [] });
    expect(d.promote).toBe(false);
  });
});

describe("statistical gate = Wilson CI separation (the spike's rule)", () => {
  it("reproduces the spike: 0/20 vs 20/20 separates -> promote", () => {
    const [, baseHi] = wilsonInterval(0, 20);
    const [imprLo] = wilsonInterval(20, 20);
    expect(baseHi).toBeLessThan(0.17);   // [0, ~0.161]
    expect(imprLo).toBeGreaterThan(0.83); // [~0.839, 1]
    expect(ciSeparated(0, 20, 20)).toBe(true);
    expect(evaluateHarnessFix({ surfaces: ["connector-doc"], n: 20, baseAccepts: 0, imprAccepts: 20, regression: [] }).promote).toBe(true);
  });
  it("a marginal partial effect does NOT separate at N=20 -> reject (run more N)", () => {
    // 8/20 vs 14/20: CIs overlap -> not promotable yet
    expect(ciSeparated(8, 14, 20)).toBe(false);
    const d = evaluateHarnessFix({ surfaces: ["amend-prompt"], n: 20, baseAccepts: 8, imprAccepts: 14, regression: [] });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("do not separate");
  });
  it("below the N floor -> reject regardless", () => {
    expect(evaluateHarnessFix({ surfaces: ["connector-doc"], n: 5, baseAccepts: 0, imprAccepts: 5, regression: [] }).promote).toBe(false);
  });
  it("statistical gate also rejects oracle-touching + regressions", () => {
    expect(evaluateHarnessFix({ surfaces: ["oracle"], n: 20, baseAccepts: 0, imprAccepts: 20, regression: [] }).promote).toBe(false);
    expect(evaluateHarnessFix({ surfaces: ["connector-doc"], n: 20, baseAccepts: 0, imprAccepts: 20, regression: [P(true, false)] }).promote).toBe(false);
  });
});
