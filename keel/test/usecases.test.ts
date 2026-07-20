/**
 * usecases.test.ts — M5 acceptance: the three architecture use cases reproduced
 * against the BUILT system, each reaching its UC-specified terminal + custody.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    approve(): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null; nodeKinds: string[] } | null>;
    verifyReplay(): Promise<{ consistent: boolean }>;
  };
}
const spec = (intent: string, attemptBudget = 3) => ({
  intent,
  acceptance: [{ id: "A1", statement: "meets acceptance", kind: "example" as const }],
  connectors: intent === "uc-002" ? ["gate"] : ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: intent === "uc-002" ? ["gate"] : ([] as string[]),
  attemptBudget,
  oracleRef: "uc@v1",
});
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

describe("M5 — the three use cases, reproduced against the built system", () => {
  it("UC-001 (feature add): verifier catches the race on attempt 1, amend fixes it -> ACCEPT", async () => {
    const stub = stubFor("uc-001");
    await stub.admit(spec("uc-001"));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ACCEPT");
    expect(r?.nodeKinds).toContain("Amendment"); // it amended, per the UC narrative
    expect(r?.nodeKinds.filter((k) => k === "Verdict").length).toBeGreaterThanOrEqual(2);
    expect((await stub.verifyReplay()).consistent).toBe(true);
  });

  it("UC-002 (schema migration): approval-gated -> PAUSE -> approve -> ACCEPT (expand/contract)", async () => {
    const stub = stubFor("uc-002");
    await stub.admit(spec("uc-002"));
    expect((await poll(stub, (s) => s === "PAUSE"))?.state).toBe("PAUSE");
    await stub.approve();
    expect((await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE"))?.state).toBe("ACCEPT");
  });

  it("UC-003 (stale total): verifier rejects symptom-masking each attempt -> ESCALATE", async () => {
    const stub = stubFor("uc-003");
    await stub.admit(spec("uc-003", 2));
    const r = await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT");
    expect(r?.state).toBe("ESCALATE");
    expect(r?.nodeKinds.filter((k) => k === "Verdict").length).toBe(2);
    expect((await stub.verifyReplay()).consistent).toBe(true);
  });
});
