/** D-B: keep-best / rollback — a regressing amend is not reported as the result. */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null; verdict: { results?: Record<string, string> } | null } | null>;
  };
}
describe("D-B keep-best", () => {
  it("on ESCALATE, reports the best attempt (A1 pass), not the regressed last (A1 fail)", async () => {
    const stub = stubFor("kb");
    await stub.admit({
      intent: "regress-demo",
      acceptance: [{ id: "A1", statement: "value 42", kind: "example" }, { id: "A2", statement: "tag perfect", kind: "example" }],
      connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [], attemptBudget: 3, oracleRef: "regress@v1",
    });
    let r = null;
    for (let i = 0; i < 80; i++) { r = await stub.result(); if (r?.state === "ESCALATE") break; await sleep(20); }
    expect(r?.state).toBe("ESCALATE");
    // without keep-best this would be the last attempt (A1 fail). With it: attempt 1 (A1 pass).
    expect(r?.verdict?.results?.A1).toBe("pass");
  });
});
