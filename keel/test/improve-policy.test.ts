/** OD-IMP-1/3/4: idempotent mining, append-only regression suite, precedence. */
import { describe, it, expect } from "vitest";
import { pendingCandidates, curateRegressionSuite, procedureStillAddsValue, type AnchorTrace } from "../src/domain/index";
import type { ProcedureCandidate } from "../src/domain/index";

const C = (key: string): ProcedureCandidate => ({ key, code: "X", support: 2, avgAttempts: 1 });
const A = (key: string, oracleRef: string, runRef: string): AnchorTrace => ({ key, oracleRef, runRef });

describe("OD-IMP-1 idempotent mining trigger", () => {
  it("gates only candidates not already disposed (no re-thrash)", () => {
    const r = pendingCandidates([C("fx-correct"), C("geo"), C("ledger")], new Set(["fx-correct", "ledger"]));
    expect(r.map((c) => c.key)).toEqual(["geo"]);
  });
});

describe("OD-IMP-3 append-only regression suite (anti-drift)", () => {
  it("adds one anchor per new (key, oracleRef); dedups; never drops existing", () => {
    const existing = [A("fx", "fx@v1", "r1")];
    const out = curateRegressionSuite(existing, [
      A("fx", "fx@v1", "r9"),      // same pattern -> not re-added
      A("geo", "geo@v1", "r2"),    // new -> added
      A("geo", "geo@v1", "r3"),    // same pattern again -> deduped
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.runRef).toBe("r1");                 // existing preserved (not overwritten)
    expect(out.map((a) => `${a.key}/${a.oracleRef}`)).toEqual(["fx/fx@v1", "geo/geo@v1"]);
  });
  it("coverage only grows — an empty candidate set removes nothing", () => {
    const existing = [A("fx", "fx@v1", "r1"), A("geo", "geo@v1", "r2")];
    expect(curateRegressionSuite(existing, [])).toHaveLength(2);
  });
});

describe("OD-IMP-4 procedure vs harness-fix precedence", () => {
  it("procedure redundant when the harness fix already made it one-shot", () => {
    expect(procedureStillAddsValue({ attemptsUnderFixedHarness: 1, attemptsUnderProcedure: 1, criticalDeterminism: false })).toBe(false);
  });
  it("procedure adds value when it strictly reduces attempts", () => {
    expect(procedureStillAddsValue({ attemptsUnderFixedHarness: 3, attemptsUnderProcedure: 1, criticalDeterminism: false })).toBe(true);
  });
  it("procedure always adds value when determinism is critical (e.g. effectful path)", () => {
    expect(procedureStillAddsValue({ attemptsUnderFixedHarness: 1, attemptsUnderProcedure: 1, criticalDeterminism: true })).toBe(true);
  });
});
