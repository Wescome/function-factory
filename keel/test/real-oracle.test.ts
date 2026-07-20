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
const spec = (opts: { intent?: string; oracleRef: string; acceptance: { id: string; kind: "example" | "property" }[]; budget?: number; spanning?: string[] }) => ({
  intent: opts.intent ?? "multi",
  acceptance: opts.acceptance.map((a) => ({ id: a.id, statement: a.id, kind: a.kind })),
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: opts.budget ?? 3,
  oracleRef: opts.oracleRef,
  spanning: opts.spanning,
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

describe("PLAYBOOK-KEEL-SPANNING-CHECKABILITY — tagging an uncheckable spanning clause", () => {
  it("a spanning clause with no assertion -> still ESCALATE (unchanged), and evidence.spanningUncheckable names it (this is the signal that was buried as generic unverifiable noise before this playbook)", async () => {
    const stub = stubFor("sc-spanning-uncheckable");
    // A9 has no assertion in multi@v1, same fixture as the ordinary
    // "unverifiable" test above — the ONLY difference is declaring it spanning.
    await stub.admit(spec({ oracleRef: "multi@v1", acceptance: [{ id: "A1", kind: "example" }, { id: "A9", kind: "example" }], spanning: ["A9"] }));
    expect((await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"))?.state).toBe("ESCALATE"); // fail-closed unchanged
    const v = await stub.lastVerdict();
    expect(v?.outcome).toBe("escalate");
    const evidence = v?.evidence as { spanningUncheckable?: string[]; perCriterion?: Record<string, string> };
    expect(evidence.spanningUncheckable).toEqual(["A9"]);
    expect(evidence.perCriterion?.A9).toBe("unverifiable"); // the underlying detail is untouched, just tagged
  });

  it("an ordinary (non-spanning) unverifiable criterion is NOT tagged — same fixture, no `spanning` declared", async () => {
    const stub = stubFor("sc-ordinary-unverifiable");
    await stub.admit(spec({ oracleRef: "multi@v1", acceptance: [{ id: "A1", kind: "example" }, { id: "A9", kind: "example" }] })); // no spanning field
    expect((await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"))?.state).toBe("ESCALATE");
    const v = await stub.lastVerdict();
    const evidence = v?.evidence as { spanningUncheckable?: string[] };
    expect(evidence.spanningUncheckable).toEqual([]); // A9 is unverifiable, but never DECLARED spanning, so not tagged
  });

  it("a checkable spanning clause is clean: an assertion exists for it -> normal pass/fail, spanningUncheckable stays empty", async () => {
    const stub = stubFor("sc-checkable-spanning");
    // A1 and A2 BOTH have real assertions in multi@v1 — declaring A1 spanning
    // here should change NOTHING about how it's judged (satisfaction path,
    // A7 + the pre-existing oracle, untouched).
    await stub.admit(spec({ oracleRef: "multi@v1", acceptance: [{ id: "A1", kind: "example" }, { id: "A2", kind: "property" }], spanning: ["A1"] }));
    expect((await poll(stub, (s) => s === "ESCALATE" || s === "ACCEPT"))?.state).toBe("ACCEPT");
    const v = await stub.lastVerdict();
    expect(v?.outcome).toBe("pass");
    expect(v?.results).toEqual({ A1: "pass", A2: "pass" });
    const evidence = v?.evidence as { spanningUncheckable?: string[] };
    expect(evidence.spanningUncheckable).toEqual([]);
  });
});
