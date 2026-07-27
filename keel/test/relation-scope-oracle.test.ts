/**
 * PLAYBOOK-KEEL-RELATION-SCOPE-001 (R1) — compileMetamorphic's per-probe
 * scoping: applicability false -> not-applicable (excluded from the tally),
 * an invalidator firing -> inconclusive (surfaced), and the D.7 guarantee
 * that an UNSCOPED criterion still compiles to the identical pass/fail
 * array it always did. Direct eval of the generated code, mirroring
 * test/seam.test.ts's `new Function(code)` style for compileSeam.
 */
import { describe, it, expect } from "vitest";
import { compileMetamorphic, type OracleAssertion } from "../src/adapters/oracle/suite";
import type { AcceptanceCriterion } from "../src/domain/index";

// eslint-disable-next-line no-new-func
const run = (code: string) => new Function(code)() as { results: Record<string, string[]>; observed: Record<string, unknown> };

const doubleActionCode = "return { value, check: value * 2 };";
const doubleRelation = "output.check === input * 2";

describe("compileMetamorphic — per-probe scoping (R1)", () => {
  it("D.2: applicability false on a probe -> that probe is not-applicable, excluded from the tally", () => {
    const criterion: AcceptanceCriterion = { id: "A1", statement: "s", kind: "property", applicability: ["input > 0"] };
    const assertion: OracleAssertion = { criterionId: "A1", kind: "property", metamorphic: { probes: [42, -5, 91], relation: doubleRelation } };
    const { results } = run(compileMetamorphic(doubleActionCode, [{ criterion, assertion }]));
    expect(results.A1).toEqual(["pass", "not-applicable", "pass"]);
  });

  it("D.3: an invalidator firing on a probe -> that probe is inconclusive, surfaced (not silently dropped, not a false fail)", () => {
    const criterion: AcceptanceCriterion = { id: "A2", statement: "s", kind: "property", invalidators: ["input === 43"] };
    const assertion: OracleAssertion = { criterionId: "A2", kind: "property", metamorphic: { probes: [42, 43, 91], relation: doubleRelation } };
    const { results } = run(compileMetamorphic(doubleActionCode, [{ criterion, assertion }]));
    expect(results.A2).toEqual(["pass", "inconclusive", "pass"]);
  });

  it("applicability is checked before invalidators -- a probe outside applicability is not-applicable even if it would also invalidate", () => {
    const criterion: AcceptanceCriterion = { id: "A3", statement: "s", kind: "property", applicability: ["input > 0"], invalidators: ["input === -5"] };
    const assertion: OracleAssertion = { criterionId: "A3", kind: "property", metamorphic: { probes: [42, -5, 91], relation: doubleRelation } };
    const { results } = run(compileMetamorphic(doubleActionCode, [{ criterion, assertion }]));
    expect(results.A3).toEqual(["pass", "not-applicable", "pass"]);
  });

  it("multiple applicability expressions are AND'd -- all must hold for the probe to apply", () => {
    const criterion: AcceptanceCriterion = { id: "A4", statement: "s", kind: "property", applicability: ["input > 0", "input < 100"] };
    const assertion: OracleAssertion = { criterionId: "A4", kind: "property", metamorphic: { probes: [42, 200, 91], relation: doubleRelation } };
    const { results } = run(compileMetamorphic(doubleActionCode, [{ criterion, assertion }]));
    expect(results.A4).toEqual(["pass", "not-applicable", "pass"]);
  });

  it("multiple invalidator expressions are OR'd -- any firing invalidates the probe", () => {
    const criterion: AcceptanceCriterion = { id: "A5", statement: "s", kind: "property", invalidators: ["input === 43", "input === 91"] };
    const assertion: OracleAssertion = { criterionId: "A5", kind: "property", metamorphic: { probes: [42, 43, 91], relation: doubleRelation } };
    const { results } = run(compileMetamorphic(doubleActionCode, [{ criterion, assertion }]));
    expect(results.A5).toEqual(["pass", "inconclusive", "inconclusive"]);
  });

  it("D.6: preservationSet is descriptive only -- declaring it changes nothing about the per-probe outcome", () => {
    const withoutPreservation: AcceptanceCriterion = { id: "A6", statement: "s", kind: "property" };
    const withPreservation: AcceptanceCriterion = { id: "A6", statement: "s", kind: "property", preservationSet: ["value"] };
    const assertion: OracleAssertion = { criterionId: "A6", kind: "property", metamorphic: { probes: [42, 43, 91], relation: doubleRelation } };
    const a = run(compileMetamorphic(doubleActionCode, [{ criterion: withoutPreservation, assertion }]));
    const b = run(compileMetamorphic(doubleActionCode, [{ criterion: withPreservation, assertion }]));
    expect(b.results.A6).toEqual(a.results.A6);
  });

  it("D.7 (Track C): an unscoped criterion compiles to the identical plain pass/fail array as before this playbook", () => {
    const criterion: AcceptanceCriterion = { id: "A7", statement: "s", kind: "example" };
    const assertion: OracleAssertion = { criterionId: "A7", kind: "example", metamorphic: { probes: [42, 43, 91], relation: doubleRelation } };
    const { results } = run(compileMetamorphic(doubleActionCode, [{ criterion, assertion }]));
    expect(results.A7).toEqual(["pass", "pass", "pass"]);
  });

  it("D.7: an extensional hardcode still fails the metamorphic probes it doesn't cover, scoped or not", () => {
    const criterion: AcceptanceCriterion = { id: "A8", statement: "s", kind: "example" };
    const assertion: OracleAssertion = { criterionId: "A8", kind: "example", metamorphic: { probes: [42, 43, 91], relation: doubleRelation } };
    const cheatCode = "return { value: 42, check: 84 };";
    const { results } = run(compileMetamorphic(cheatCode, [{ criterion, assertion }]));
    expect(results.A8).toEqual(["pass", "fail", "fail"]);
  });

  it("a probe that throws still fails outright, ahead of any scope check", () => {
    const criterion: AcceptanceCriterion = { id: "A9", statement: "s", kind: "property", applicability: ["input > 0"] };
    const assertion: OracleAssertion = { criterionId: "A9", kind: "property", metamorphic: { probes: [42], relation: "output.nope.nope" } };
    const throwingCode = "throw new Error('boom');";
    const { results } = run(compileMetamorphic(throwingCode, [{ criterion, assertion }]));
    expect(results.A9).toEqual(["fail"]);
  });
});
