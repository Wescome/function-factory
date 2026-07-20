/**
 * amend-evidence.test.ts — proves per-criterion evidence CONTENT drives a
 * targeted correction (not just "evidence exists -> different code"). The
 * scripted model here reads WHICH criterion failed and fixes exactly that.
 * A budget-1 control proves attempt 1 genuinely fails.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null; nodeKinds: string[] } | null>;
    lastVerdict(): Promise<{ outcome: string; results: Record<string, string>; attempt: number } | null>;
    verifyReplay(): Promise<{ consistent: boolean }>;
  };
}
const spec = (budget: number, intent = "amend-demo", oracleRef = "derived@v1") => ({
  intent,
  acceptance: [
    { id: "A1", statement: "result.value === 42", kind: "example" as const },
    { id: "A2", statement: "the check field must be a NUMBER internally consistent with value", kind: "example" as const },
  ],
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: budget,
  oracleRef,
});
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

describe("AMEND with per-criterion evidence (the harness earning its keep)", () => {
  it("attempt 1 fails A2, evidence names A2, attempt 2 corrects exactly it -> ACCEPT", async () => {
    const stub = stubFor("amend-accept");
    await stub.admit(spec(3));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");

    // Converging is only possible if the model READ that A2 (not A1) failed and
    // fixed check. If evidence content were ignored it would loop wrong -> ESCALATE.
    expect(r?.state).toBe("ACCEPT");
    expect(r?.nodeKinds).toContain("Amendment");
    expect(r?.nodeKinds.filter((k) => k === "Verdict").length).toBeGreaterThanOrEqual(2);

    const v = await stub.lastVerdict();
    expect(v?.results).toEqual({ A1: "pass", A2: "pass" }); // final: both pass
    expect(v?.attempt).toBe(2);                              // corrected on the 2nd attempt
    expect((await stub.verifyReplay()).consistent).toBe(true);
  });

  it("CONTROL: with budget 1 (no amend allowed) the same task ESCALATEs — attempt 1 really fails", async () => {
    const stub = stubFor("amend-control");
    await stub.admit(spec(1));
    const r = await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT");
    expect(r?.state).toBe("ESCALATE");                       // proves attempt 1 fails A2
    const v = await stub.lastVerdict();
    expect(v?.results.A2).toBe("fail");                      // and specifically on A2
    expect(v?.results.A1).toBe("pass");                      // A1 was fine
  });

  it("derived-fair (value*2, derivable): converges to ACCEPT via the observed-value gradient", async () => {
    const stub = stubFor("amend-fair");
    // amend-demo emits check=84 once it reads A2 failed; derived-fair wants value*2=84
    await stub.admit(spec(3, "amend-demo", "derived-fair@v1"));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ACCEPT");                         // evidence CAN close a derivable rule
    expect(r?.nodeKinds).toContain("Amendment");
  });

  it("derived-blind (value*2+7, unconvergeable): the harness correctly ESCALATEs", async () => {
    const stub = stubFor("amend-blind");
    // amend-blind-sim makes reasonable guesses (mirror, double) but cannot derive
    // the hidden +7 from evidence alone -> correct fail-closed ESCALATE
    await stub.admit(spec(3, "amend-blind-sim", "derived-blind@v1"));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ESCALATE");                       // beyond evidence's reach -> escalate, not false-accept
    expect(r?.nodeKinds.filter((k) => k === "Amendment").length).toBeGreaterThanOrEqual(1);
  });
});
