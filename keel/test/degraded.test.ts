/**
 * degraded.test.ts — M5 acceptance: degraded mode. Fault-inject the code
 * executor; the run must fail CLOSED to ESCALATE (never crash, never
 * false-ACCEPT), while lineage and verification keep serving.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    result(): Promise<{ state: string | null; nodeKinds: string[] } | null>;
    readRun(): Promise<{ runId: string | null; nodes: unknown[]; events: number; terminal: string | null }>;
    timeline(): Promise<{ state: string }[]>;
    verifyReplay(): Promise<{ consistent: boolean }>;
  };
}
const degradedSpec = {
  intent: "degraded",
  acceptance: [{ id: "A1", statement: "n/a — executor is down", kind: "example" as const }],
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: 2,
  oracleRef: "uc@v1",
};
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

describe("M5 — degraded mode (fail closed)", () => {
  it("executor fault -> ESCALATE, and lineage + verification keep serving", async () => {
    const stub = stubFor("m5-degraded");
    await stub.admit(degradedSpec);

    const r = await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT");
    // fail CLOSED: never a false ACCEPT when the executor is down
    expect(r?.state).toBe("ESCALATE");
    expect(r?.nodeKinds).toContain("Verdict"); // the verifier still ran (independent of the executor)

    // lineage keeps serving
    const custody = await stub.readRun();
    expect(custody.runId).toBeTruthy();
    expect(custody.events).toBeGreaterThan(0);
    expect(custody.terminal).toBe("ESCALATE");

    // the read side / replay still serve on a degraded run
    const tl = await stub.timeline();
    expect(tl[tl.length - 1]?.state).toBe("ESCALATE");
    expect((await stub.verifyReplay()).consistent).toBe(true);
  });
});
