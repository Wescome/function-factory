/** Improvement loop: mine recurring ACCEPTed procedures -> crystallize -> gate on
 *  verified re-ACCEPT (the deterministic subset). */
import { describe, it, expect } from "vitest";
import { mineProcedures, runProcedurePass, type TraceSummary, type ProcedureCandidate } from "../src/domain/index";

const T = (key: string, code: string, accepted: boolean, attempts: number): TraceSummary => ({ key, code, accepted, attempts });

describe("mineProcedures", () => {
  it("mines a procedure ACCEPTed >= minRepeats with no failures", () => {
    const c = mineProcedures([
      T("fx-snapshot", "CODE_A", true, 2), T("fx-snapshot", "CODE_A", true, 2),
      T("other", "CODE_B", true, 1),
    ], 2);
    expect(c).toHaveLength(1);
    expect(c[0]!.key).toBe("fx-snapshot");
    expect(c[0]!.support).toBe(2);
  });
  it("does NOT mine a code that ever failed (only clean, consistent successes)", () => {
    expect(mineProcedures([T("k", "C", true, 1), T("k", "C", false, 3)], 2)).toHaveLength(0);
  });
  it("does NOT mine below minRepeats", () => {
    expect(mineProcedures([T("k", "C", true, 1)], 2)).toHaveLength(0);
  });
});

describe("runProcedurePass — gate on verified replay", () => {
  const traces = [T("fx-snapshot", "CODE_A", true, 2), T("fx-snapshot", "CODE_A", true, 2)];
  it("promotes a procedure that re-ACCEPTs with fewer attempts, no regression", async () => {
    const replay = async (_c: ProcedureCandidate) => ({ afterAccepted: true, attemptsAfter: 1, regression: [] });
    const [r] = await runProcedurePass(traces, replay);
    expect(r!.decision.promote).toBe(true);
    expect(r!.decision.reason).toContain("attempts 2->1");
  });
  it("REJECTS a procedure that fails to verify on replay (no self-score promotion)", async () => {
    const replay = async () => ({ afterAccepted: false, attemptsAfter: 1, regression: [] });
    const [r] = await runProcedurePass(traces, replay);
    expect(r!.decision.promote).toBe(false);
    expect(r!.decision.reason).toContain("did not verify-ACCEPT");
  });
  it("REJECTS if replay regresses a held-out ACCEPTed trace", async () => {
    const replay = async () => ({ afterAccepted: true, attemptsAfter: 1, regression: [{ beforeAccepted: true, afterAccepted: false }] });
    const [r] = await runProcedurePass(traces, replay);
    expect(r!.decision.promote).toBe(false);
  });
  it("INV-IMPROVE-EFFECT-HUMAN: an effectful procedure routes to HUMAN, not auto-promote/fail", async () => {
    // real case: ledger-create replay stalls at PAUSE (approval-gated put); mark effectful
    const replay = async () => ({ afterAccepted: false, attemptsAfter: 1, regression: [], effectful: true });
    const [r] = await runProcedurePass(traces, replay);
    expect(r!.decision.promote).toBe(false);
    expect(r!.decision.disposition).toBe("human");   // NOT a failure — needs a human
    expect(r!.decision.reason).toContain("effectful");
  });
});
