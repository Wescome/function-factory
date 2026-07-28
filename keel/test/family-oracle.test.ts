/**
 * PLAYBOOK-KEEL-FAMILY-001 (R4) — compileMetamorphic's family-tagged evaluate
 * step: each of the five shipped families (equality, invariance,
 * monotonicity, idempotence, bounded) probes correctly -- a satisfying
 * implementation passes, a violating one fails (C.2). Direct eval of the
 * generated code, mirroring test/relation-scope-oracle.test.ts's
 * `new Function(code)` style.
 */
import { describe, it, expect } from "vitest";
import { compileMetamorphic, type OracleAssertion } from "../src/adapters/oracle/suite";
import type { AcceptanceCriterion } from "../src/domain/index";

// eslint-disable-next-line no-new-func
const run = (code: string) => new Function(code)() as { results: Record<string, string[]>; observed: Record<string, unknown> };

const assertion = (id: string, probes: readonly number[]): OracleAssertion => ({
  criterionId: id, kind: "property", metamorphic: { probes },
});

describe("compileMetamorphic — family probes (R4, C.2)", () => {
  it("equality: f(x) == expected -- a satisfying implementation passes every probe", () => {
    const criterion: AcceptanceCriterion = { id: "A1", statement: "s", kind: "property", family: { kind: "equality", expected: "input * 2" } };
    const code = "return value * 2;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A1", [1, 2, 3]) }]));
    expect(results.A1).toEqual(["pass", "pass", "pass"]);
  });
  it("equality: a violating implementation fails", () => {
    const criterion: AcceptanceCriterion = { id: "A1", statement: "s", kind: "property", family: { kind: "equality", expected: "input * 2" } };
    const code = "return value * 3;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A1", [1, 2, 3]) }]));
    expect(results.A1).toEqual(["fail", "fail", "fail"]);
  });

  it("invariance: f(x) == f(transform(x)) -- a constant function is invariant under any transform", () => {
    const criterion: AcceptanceCriterion = { id: "A2", statement: "s", kind: "property", family: { kind: "invariance", transform: "input + 1000" } };
    const code = "return 7;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A2", [1, 2, 3]) }]));
    expect(results.A2).toEqual(["pass", "pass", "pass"]);
  });
  it("invariance: the identity function is NOT invariant under a nonzero shift -- fails", () => {
    const criterion: AcceptanceCriterion = { id: "A2", statement: "s", kind: "property", family: { kind: "invariance", transform: "input + 1000" } };
    const code = "return value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A2", [1, 2, 3]) }]));
    expect(results.A2).toEqual(["fail", "fail", "fail"]);
  });

  it("monotonicity (asc): a non-decreasing function passes -- first probe vacuously passes", () => {
    const criterion: AcceptanceCriterion = { id: "A3", statement: "s", kind: "property", family: { kind: "monotonicity", order: "asc" } };
    const code = "return value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A3", [1, 5, 10]) }]));
    expect(results.A3).toEqual(["pass", "pass", "pass"]);
  });
  it("monotonicity (asc): a decreasing function fails from the second probe on", () => {
    const criterion: AcceptanceCriterion = { id: "A3", statement: "s", kind: "property", family: { kind: "monotonicity", order: "asc" } };
    const code = "return -value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A3", [1, 5, 10]) }]));
    expect(results.A3).toEqual(["pass", "fail", "fail"]);
  });
  it("monotonicity (desc): the same decreasing function now passes", () => {
    const criterion: AcceptanceCriterion = { id: "A3", statement: "s", kind: "property", family: { kind: "monotonicity", order: "desc" } };
    const code = "return -value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A3", [1, 5, 10]) }]));
    expect(results.A3).toEqual(["pass", "pass", "pass"]);
  });
  it("monotonicity: probe ORDER doesn't matter -- sorted-by-input first, so a decreasing function still fails under asc regardless of how probes were given", () => {
    const criterion: AcceptanceCriterion = { id: "A3", statement: "s", kind: "property", family: { kind: "monotonicity", order: "asc" } };
    const code = "return -value;"; // decreasing
    // probes given in DESCENDING order -- an adjacent-in-GIVEN-order walk
    // would see every antecedent (prev.input <= p.input) as false and
    // vacuously pass every probe (the bug this fixes). Sorting first
    // catches the real violation regardless of arrival order.
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A3", [10, 5, 1]) }]));
    expect(results.A3).toEqual(["fail", "fail", "pass"]); // rank0 (input=1) is vacuous; rank1,2 both violate
  });
  it("monotonicity: a violation hidden between NON-adjacent-in-given-order probes is still caught (adjacent-on-sorted == all-pairs)", () => {
    const criterion: AcceptanceCriterion = { id: "A3", statement: "s", kind: "property", family: { kind: "monotonicity", order: "asc" } };
    // f(1)=1, f(2)=2, f(3)=1 -- violates asc between input 2 and 3. Probed
    // as [3, 1, 2]: an adjacent-in-GIVEN-order walk never directly compares
    // 2 and 3 (the violating pair) -- this was the exact false-pass this
    // fix closes.
    const code = "return value === 3 ? 1 : value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A3", [3, 1, 2]) }]));
    expect(results.A3).toEqual(["fail", "pass", "pass"]); // original index0 (value=3) is the one that fails, ranked last
  });

  it("idempotence: f(f(x)) == f(x) -- a clamp is idempotent", () => {
    const criterion: AcceptanceCriterion = { id: "A4", statement: "s", kind: "property", family: { kind: "idempotence" } };
    const code = "return value > 10 ? 10 : value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A4", [5, 20, 50]) }]));
    expect(results.A4).toEqual(["pass", "pass", "pass"]);
  });
  it("idempotence: incrementing is NOT idempotent -- fails", () => {
    const criterion: AcceptanceCriterion = { id: "A4", statement: "s", kind: "property", family: { kind: "idempotence" } };
    const code = "return value + 1;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A4", [5, 20, 50]) }]));
    expect(results.A4).toEqual(["fail", "fail", "fail"]);
  });

  it("bounded: lo <= f(x) <= hi -- a clamped implementation stays in range", () => {
    const criterion: AcceptanceCriterion = { id: "A5", statement: "s", kind: "property", family: { kind: "bounded", lo: 0, hi: 100 } };
    const code = "return Math.min(100, Math.max(0, value));";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A5", [-50, 50, 500]) }]));
    expect(results.A5).toEqual(["pass", "pass", "pass"]);
  });
  it("bounded: an unclamped implementation violates the range on out-of-range probes", () => {
    const criterion: AcceptanceCriterion = { id: "A5", statement: "s", kind: "property", family: { kind: "bounded", lo: 0, hi: 100 } };
    const code = "return value;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A5", [-50, 50, 500]) }]));
    expect(results.A5).toEqual(["fail", "pass", "fail"]);
  });
  it("bounded: baseline means no worse than -- output >= baseline", () => {
    const criterion: AcceptanceCriterion = { id: "A5", statement: "s", kind: "property", family: { kind: "bounded", baseline: 50 } };
    const passing = run(compileMetamorphic("return 60;", [{ criterion, assertion: assertion("A5", [1]) }]));
    const failing = run(compileMetamorphic("return 10;", [{ criterion, assertion: assertion("A5", [1]) }]));
    expect(passing.results.A5).toEqual(["pass"]);
    expect(failing.results.A5).toEqual(["fail"]);
  });

  it("C.4: a family-tagged criterion still respects R1's order -- applicability abstains outside its domain, family evaluates inside it", () => {
    const criterion: AcceptanceCriterion = {
      id: "A6", statement: "s", kind: "property",
      applicability: ["input > 0"],
      family: { kind: "equality", expected: "input * 2" },
    };
    const code = "return value * 2;";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: assertion("A6", [-5, 5, 10]) }]));
    expect(results.A6).toEqual(["not-applicable", "pass", "pass"]);
  });

  it("C.5/Track C: an untyped (no family) criterion with a family REMOVED still uses the opaque relation, byte-for-byte", () => {
    const criterion: AcceptanceCriterion = { id: "A7", statement: "s", kind: "example" };
    const a: OracleAssertion = { criterionId: "A7", kind: "example", metamorphic: { probes: [42, 43], relation: "output.check === input * 2" } };
    const code = "return { value, check: value * 2 };";
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion: a }]));
    expect(results.A7).toEqual(["pass", "pass"]);
  });
});
