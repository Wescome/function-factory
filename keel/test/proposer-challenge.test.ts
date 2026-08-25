/**
 * PLAYBOOK-KEEL-LIFT-PROPOSER-001 (B.2/B.3/B.4) — challengeCandidate: the
 * core of the loop. Takes ALREADY-JUDGED cases (real probe pass/fail +
 * caller-supplied legitimacy) and narrows/registers/defeats accordingly.
 * INV-LP-CHALLENGE-CORE (no candidate surfaces until it survives) and
 * INV-LP-DEFEATER-REGISTERED (every unsettled defeater is registered, not
 * dropped) are exercised here at the pure-function level; the full loop
 * against REAL compileMetamorphic execution is test/proposer-loop.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  challengeCandidate, defaultBoundaryCases, requiresDomainOwnerConfirmation,
  type LiftCandidate, type ChallengeCase,
} from "../src/domain/index";

const baseCandidate = (o: Partial<LiftCandidate> = {}): LiftCandidate => ({
  criterionId: "A1", family: { kind: "bounded", lo: 0, hi: 100 }, openDefeaters: [], status: "candidate", ...o,
});

describe("defaultBoundaryCases — B.2's one mechanically-generatable slice", () => {
  it("returns a fixed set of generic numeric edge values, independent of domain semantics", () => {
    expect(defaultBoundaryCases()).toEqual([0, 1, -1, 100, -100]);
  });
});

describe("requiresDomainOwnerConfirmation — B.2's human half of the dependency check", () => {
  it("invariance (irrelevant-variable) claims require confirmation", () => {
    expect(requiresDomainOwnerConfirmation(baseCandidate({ family: { kind: "invariance", transform: "input" } }))).toBe(true);
  });
  it("every other family does not", () => {
    expect(requiresDomainOwnerConfirmation(baseCandidate({ family: { kind: "equality", expected: "42" } }))).toBe(false);
    expect(requiresDomainOwnerConfirmation(baseCandidate({ family: { kind: "monotonicity", order: "asc" } }))).toBe(false);
    expect(requiresDomainOwnerConfirmation(baseCandidate({ family: { kind: "idempotence" } }))).toBe(false);
    expect(requiresDomainOwnerConfirmation(baseCandidate())).toBe(false);
  });
});

describe("challengeCandidate — B.2/B.3/B.4", () => {
  it("all cases pass -> survives, candidate untouched", () => {
    const cases: ChallengeCase[] = [{ input: 42, passed: true }, { input: 91, passed: true }];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.survives).toBe(true);
    expect(r.legitimateDefeats).toEqual([]);
    expect(r.candidate.applicability).toBeUndefined();
    expect(r.candidate.invalidators).toBeUndefined();
    expect(r.candidate.openDefeaters).toEqual([]);
  });

  it("D.3/B.3: a confirmed-illegitimate failure narrows APPLICABILITY to exclude it -- survives", () => {
    const cases: ChallengeCase[] = [{ input: 500, passed: false, legitimacy: "confirmed-illegitimate" }];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.survives).toBe(true);
    expect(r.candidate.applicability).toEqual(["input !== 500"]);
    expect(r.candidate.openDefeaters).toEqual([]); // narrowed away, not registered as a lingering defeater
  });

  it("B.4: an UNSETTLED failure narrows via an INVALIDATOR and is REGISTERED -- travels, does not defeat outright", () => {
    const cases: ChallengeCase[] = [{ input: 7, passed: false, legitimacy: "unsettled" }];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.survives).toBe(true);
    expect(r.candidate.invalidators).toEqual(["input === 7"]);
    // INV-LP-DEFEATER-REGISTERED: not silently absorbed -- visible in openDefeaters
    expect(r.candidate.openDefeaters).toEqual([
      { input: 7, reason: expect.stringContaining("legitimacy not yet confirmed"), legitimacy: "unsettled" },
    ]);
  });

  it("an UNJUDGED failure (no legitimacy tag at all) is fail-closed to unsettled -- never silently narrowed as illegitimate, never silently ignored", () => {
    const cases: ChallengeCase[] = [{ input: 7, passed: false }];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.survives).toBe(true);
    expect(r.candidate.invalidators).toEqual(["input === 7"]);
    expect(r.candidate.openDefeaters).toHaveLength(1);
  });

  it("B.4: narrowing an UNSCOPED candidate's first invalidator seeds a trivial applicability (mirrors isScopeAdmittable -- invalidators without applicability isn't admittable)", () => {
    const cases: ChallengeCase[] = [{ input: 7, passed: false, legitimacy: "unsettled" }];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.candidate.applicability).toEqual(["true"]);
  });

  it("D.3/B.3/INV-LP-CHALLENGE-CORE: a CONFIRMED-LEGITIMATE failure defeats the candidate outright -- never narrowed away, never surfaced as-is", () => {
    const cases: ChallengeCase[] = [{ input: 500, passed: false, legitimacy: "confirmed-legitimate" }];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.survives).toBe(false);
    expect(r.candidate.status).toBe("rejected");
    expect(r.legitimateDefeats).toEqual(cases);
    // NOT narrowed into applicability/invalidators -- a real violation isn't hidden
    expect(r.candidate.applicability).toBeUndefined();
    expect(r.candidate.invalidators).toBeUndefined();
  });

  it("a mix of all three legitimacy classes is classified independently", () => {
    const cases: ChallengeCase[] = [
      { input: 1, passed: true },
      { input: 2, passed: false, legitimacy: "confirmed-illegitimate" },
      { input: 3, passed: false, legitimacy: "unsettled" },
      { input: 4, passed: false, legitimacy: "confirmed-legitimate" },
    ];
    const r = challengeCandidate(baseCandidate(), cases);
    expect(r.survives).toBe(false); // the confirmed-legitimate one defeats it regardless of the others
    expect(r.candidate.applicability).toContain("input !== 2");
    expect(r.candidate.invalidators).toEqual(["input === 3"]);
    expect(r.candidate.openDefeaters).toHaveLength(1);
    expect(r.legitimateDefeats).toEqual([{ input: 4, passed: false, legitimacy: "confirmed-legitimate" }]);
  });

  it("re-challenge composability: narrowing across two calls ACCUMULATES, never overwrites", () => {
    const first = challengeCandidate(baseCandidate(), [{ input: 500, passed: false, legitimacy: "confirmed-illegitimate" }]);
    expect(first.candidate.applicability).toEqual(["input !== 500"]);
    const second = challengeCandidate(first.candidate, [{ input: 600, passed: false, legitimacy: "confirmed-illegitimate" }]);
    expect(second.candidate.applicability).toEqual(["input !== 500", "input !== 600"]);
    expect(second.survives).toBe(true);
  });
});
