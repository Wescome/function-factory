/**
 * PLAYBOOK-KEEL-VERDICT-SET-001 (L1, D.3/D.4) — aggregateVerdict, the honest
 * per-criterion -> overall rollup. not-applicable is R1-gated (no adapter
 * emits it today, SuiteOracleAdapter has no applicability concept yet) --
 * proven here against synthetic status arrays, exactly as the playbook
 * anticipates ("mark it pending R1 if R1 is not yet in").
 */
import { describe, it, expect } from "vitest";
import { aggregateVerdict } from "../src/domain/index";

describe("aggregateVerdict — the honest rollup", () => {
  it("all pass -> pass", () => {
    expect(aggregateVerdict(["pass", "pass"])).toBe("pass");
  });

  it("any fail (nothing inconclusive) -> fail", () => {
    expect(aggregateVerdict(["pass", "fail"])).toBe("fail");
  });

  it("D.2: any inconclusive -> inconclusive, never a false fail, never a silent pass", () => {
    expect(aggregateVerdict(["pass", "inconclusive"])).toBe("inconclusive");
    expect(aggregateVerdict(["fail", "inconclusive"])).toBe("inconclusive");
  });

  it("D.3 (R1-gated): not-applicable is EXCLUDED from the tally -- the run proceeds on the rest", () => {
    expect(aggregateVerdict(["pass", "not-applicable"])).toBe("pass");
    expect(aggregateVerdict(["fail", "not-applicable"])).toBe("fail");
  });

  it("D.4: every criterion not-applicable (or none at all) -> vacuous -> inconclusive, NEVER a silent ACCEPT", () => {
    expect(aggregateVerdict(["not-applicable", "not-applicable"])).toBe("inconclusive");
    expect(aggregateVerdict([])).toBe("inconclusive");
  });

  it("a mix: not-applicable excluded, remaining criteria still checked normally", () => {
    expect(aggregateVerdict(["not-applicable", "pass", "pass"])).toBe("pass");
    expect(aggregateVerdict(["not-applicable", "pass", "inconclusive"])).toBe("inconclusive");
    expect(aggregateVerdict(["not-applicable", "pass", "fail"])).toBe("fail");
  });
});
