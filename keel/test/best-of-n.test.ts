/** D-C: the best-of-N selection primitive (pure). Oracle-as-selector. */
import { describe, it, expect } from "vitest";
import { selectBest } from "../src/domain/loop/run";
import type { VerdictContent } from "../src/domain/lineage/nodes";
const v = (outcome: VerdictContent["outcome"], results: Record<string, "pass" | "fail">): VerdictContent =>
  ({ outcome, results, evidence: null, oracleRef: "x", attempt: 0, ms: 0 });

describe("D-C selectBest", () => {
  it("returns the FIRST passing candidate", () => {
    expect(selectBest([v("fail", { A: "pass", B: "fail" }), v("pass", { A: "pass", B: "pass" }), v("pass", { A: "pass", B: "pass" })])).toBe(1);
  });
  it("with none passing, returns the highest-scoring", () => {
    expect(selectBest([v("fail", { A: "fail", B: "fail" }), v("fail", { A: "pass", B: "pass" }), v("fail", { A: "pass", B: "fail" })])).toBe(1);
  });
  it("N=1 is inert (returns the sole candidate)", () => {
    expect(selectBest([v("fail", { A: "fail" })])).toBe(0);
  });
});
