/**
 * stale-assumption.test.ts — E-A/E-B/E-C: connector-mediated ACCEPT-after-amend.
 * The model assumes the wrong connector-response shape, the recorded response is
 * carried in the evidence, and the amend corrects from that runtime-discovered fact.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null; nodeKinds: string[] } | null>;
    lastVerdict(): Promise<{ outcome: string; evidence: { calls?: { connector: string; method: string; response?: unknown }[] } } | null>;
  };
}
const spec = (budget: number) => ({
  intent: "stale-tier",
  acceptance: [{ id: "A1", statement: "result.tier is the customer's tier", kind: "example" as const }],
  connectors: ["billing"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: budget,
  oracleRef: "tier@v1",
});
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

describe("E-C connector-mediated ACCEPT-after-amend", () => {
  it("wrong shape first -> recorded response in evidence -> corrected -> ACCEPT", async () => {
    const stub = stubFor("stale-ok");
    await stub.admit(spec(3));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ACCEPT");
    expect(r?.nodeKinds).toContain("Amendment"); // it corrected from the runtime fact
  });

  it("CONTROL (budget 1): attempt 1 fails AND the evidence carried the real connector response", async () => {
    const stub = stubFor("stale-ctrl");
    await stub.admit(spec(1));
    expect((await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"))?.state).toBe("ESCALATE");
    const v = await stub.lastVerdict();
    const call = v?.evidence.calls?.find((c) => c.connector === "billing" && c.method === "getTier");
    expect(call).toBeTruthy();                       // E-A: the call was recorded
    expect(call?.response).toEqual({ tier: "pro" }); // E-B: with its real response (runtime-discovered)
  });
});
