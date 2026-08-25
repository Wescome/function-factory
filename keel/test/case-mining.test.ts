/**
 * PLAYBOOK-KEEL-COUNTEREXAMPLE-GEN-001 — parseComparisonBoundary (the
 * six-form best-effort parser) and mineScopeDerivedCases (B.1: mine every
 * OTHER relation's R1 scope for boundary literals + neighbors). Pure,
 * substrate-free; challengeCandidate itself is untouched (Track C).
 */
import { describe, it, expect } from "vitest";
import { parseComparisonBoundary, mineScopeDerivedCases } from "../src/domain/index";
import type { AcceptanceCriterion } from "../src/domain/index";

describe("parseComparisonBoundary — the six simple comparison forms, either operand order", () => {
  it("input <op> literal, all six operators", () => {
    expect(parseComparisonBoundary("input !== 43")).toBe(43);
    expect(parseComparisonBoundary("input === 100")).toBe(100);
    expect(parseComparisonBoundary("input < 0")).toBe(0);
    expect(parseComparisonBoundary("input <= 0")).toBe(0);
    expect(parseComparisonBoundary("input > 1000")).toBe(1000);
    expect(parseComparisonBoundary("input >= 1000")).toBe(1000);
  });

  it("literal <op> input, either operand order", () => {
    expect(parseComparisonBoundary("43 !== input")).toBe(43);
    expect(parseComparisonBoundary("0 < input")).toBe(0);
    expect(parseComparisonBoundary("1000 >= input")).toBe(1000);
  });

  it("negative and decimal literals", () => {
    expect(parseComparisonBoundary("input !== -5")).toBe(-5);
    expect(parseComparisonBoundary("input > 1.5")).toBe(1.5);
  });

  it("tolerates absent/extra whitespace", () => {
    expect(parseComparisonBoundary("input!==43")).toBe(43);
    expect(parseComparisonBoundary("input   !==   43")).toBe(43);
  });

  it("D.5: an unparseable condition is skipped cleanly -- undefined, never a throw", () => {
    expect(parseComparisonBoundary("input > 0 && input < 100")).toBeUndefined(); // compound
    expect(parseComparisonBoundary("output.value === input")).toBeUndefined(); // references output, not a bare literal
    expect(parseComparisonBoundary("input === someVar")).toBeUndefined(); // non-numeric literal
    expect(parseComparisonBoundary("")).toBeUndefined();
  });
});

describe("mineScopeDerivedCases — B.1, structural, best-effort, no model risk", () => {
  const criterion = (o: Partial<AcceptanceCriterion>): AcceptanceCriterion => ({ id: "X", statement: "s", kind: "property", ...o });

  it("D.2: mines a boundary + its neighbors from ANOTHER relation's applicability", () => {
    const all = [criterion({ id: "A1", kind: "example" }), criterion({ id: "A2", applicability: ["input !== 43"] })];
    expect([...mineScopeDerivedCases("A1", all)].sort((a, b) => a - b)).toEqual([42, 43, 44]);
  });

  it("also mines invalidators, not just applicability", () => {
    const all = [criterion({ id: "A1", kind: "example" }), criterion({ id: "A2", invalidators: ["input === 100"] })];
    expect([...mineScopeDerivedCases("A1", all)].sort((a, b) => a - b)).toEqual([99, 100, 101]);
  });

  it("the criterion being lifted contributes nothing to its OWN mining, even if it already carries scope", () => {
    const all = [criterion({ id: "A1", kind: "example", applicability: ["input !== 999"] })];
    expect(mineScopeDerivedCases("A1", all)).toEqual([]);
  });

  it("no other relations at all -> empty (Track C: falls back to base + model tiers only)", () => {
    const all = [criterion({ id: "A1", kind: "example" })];
    expect(mineScopeDerivedCases("A1", all)).toEqual([]);
  });

  it("combines and dedups across multiple other relations", () => {
    const all = [
      criterion({ id: "A1", kind: "example" }),
      criterion({ id: "A2", applicability: ["input !== 43"] }),
      criterion({ id: "A3", invalidators: ["input === 44"] }), // overlaps A2's neighbor (44)
    ];
    expect([...mineScopeDerivedCases("A1", all)].sort((a, b) => a - b)).toEqual([42, 43, 44, 45]);
  });

  it("D.5: an unparseable condition among otherwise-valid ones is skipped, the rest still mined", () => {
    const all = [
      criterion({ id: "A1", kind: "example" }),
      criterion({ id: "A2", applicability: ["input > 0 && input < 100", "input !== 43"] }),
    ];
    expect([...mineScopeDerivedCases("A1", all)].sort((a, b) => a - b)).toEqual([42, 43, 44]);
  });
});
