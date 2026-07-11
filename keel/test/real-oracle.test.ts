/**
 * real-oracle.test.ts — the real oracle: per-criterion suites, and the
 * wrong-vs-unverifiable distinction (fail -> amend, unverifiable -> escalate).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    result(): Promise<{ state: string | null } | null>;
    lastVerdict(): Promise<{ outcome: string; results: Record<string, string>; evidence: unknown } | null>;
  };
}
const spec = (opts: { intent?: string; oracleRef: string; acceptance: { id: string; kind: "example" | "property" }[]; budget?: number }) => ({
  intent: opts.intent ?? "multi",
  acceptance: opts.acceptance.map((a) => ({ id: a.id, statement: a.id, kind: a.kind })),
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: opts.budget ?? 3,
  oracleRef: opts.oracleRef,
});
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

describe("real oracle — suites, per-criterion, fail-closed", () => {
  it("multi-criterion suite: both an example and a property pass -> ACCEPT", async () => {
    const stub = stubFor("ro-multi");
    await stub.admit(spec({ oracleRef: "multi@v1", acceptance: [{ id: "A1", kind: "example" }, { id: "A2", kind: "property" }] }));
    expect((await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE"))?.state).toBe("ACCEPT");
    const v = await stub.lastVerdict();
    expect(v?.outcome).toBe("pass");
    expect(v?.results).toEqual({ A1: "pass", A2: "pass" }); // per-criterion, not aggregate
  });

  it("per-criterion granularity: the example passes but the property fails -> fail", async () => {
    const stub = stubFor("ro-strict");
    // strict@v1's A2 demands a field the default action omits -> A1 pass, A2 fail
    await stub.admit(spec({ oracleRef: "strict@v1", acceptance: [{ id: "A1", kind: "example" }, { id: "A2", kind: "property" }], budget: 1 }));
    await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"); // budget 1 -> escalate after the fail
    const v = await stub.lastVerdict();
    expect(v?.results).toEqual({ A1: "pass", A2: "fail" }); // distinct per-criterion outcomes
    expect(v?.outcome).toBe("fail");
  });

  it("unverifiable criterion -> ESCALATE, never a silent pass (fail-closed)", async () => {
    const stub = stubFor("ro-unverifiable");
    // A9 has no assertion in multi@v1 -> the oracle cannot verify it
    await stub.admit(spec({ oracleRef: "multi@v1", acceptance: [{ id: "A1", kind: "example" }, { id: "A9", kind: "example" }] }));
    expect((await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"))?.state).toBe("ESCALATE");
    const v = await stub.lastVerdict();
    expect(v?.outcome).toBe("escalate"); // verifier-escalate, not fail, not pass
  });

  it("missing suite -> ESCALATE (can't verify -> don't pass)", async () => {
    const stub = stubFor("ro-nosuite");
    await stub.admit(spec({ oracleRef: "does-not-exist@v1", acceptance: [{ id: "A1", kind: "example" }] }));
    expect((await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"))?.state).toBe("ESCALATE");
  });
});
