/**
 * skeleton.test.ts — G3: the thinnest real loop, end to end on real workerd.
 *
 * Admits one trivial connectors-only task and asserts it walks
 * INTENT→GENERATE→EXECUTE→VERIFY→ACCEPT, producing a real lineage chain.
 * Also asserts D7 idempotent admission (a repeat admit is a no-op).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const trivialSpec = {
  intent: "echo 42",
  acceptance: [{ id: "A1", statement: "echo returns { value: 42 }", kind: "example" as const }],
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: 3,
  oracleRef: "echo@v1",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function admit(name: string) {
  const stub = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR
    .get((env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR.idFromName(name)) as unknown as {
      admit(c: unknown): Promise<{ accepted: boolean; status: string; runId: string }>;
      result(): Promise<{ state: string | null; verdict: unknown; nodeKinds: string[] } | null>;
    };
  return stub;
}

describe("KEEL walking skeleton — G3", () => {
  it("a trivial task runs end-to-end to ACCEPT with a real lineage chain", async () => {
    const stub = await admit("g3-accept");
    const a = await stub.admit(trivialSpec);
    expect(a.accepted).toBe(true);

    let r: Awaited<ReturnType<typeof stub.result>> = null;
    for (let i = 0; i < 60; i++) {
      r = await stub.result();
      if (r?.state) break;
      await sleep(20);
    }
    expect(r?.state).toBe("ACCEPT");
    // the full lineage chain exists
    expect(r?.nodeKinds).toEqual(expect.arrayContaining(["Specification", "Action", "ExecutionTrace", "Verdict"]));
  });

  it("D7: a repeat admit of the same spec is idempotent (accepted:false)", async () => {
    const stub = await admit("g3-idem");
    const first = await stub.admit(trivialSpec);
    expect(first.accepted).toBe(true);
    await sleep(40);
    const second = await stub.admit(trivialSpec);
    expect(second.accepted).toBe(false);
    expect(second.runId).toBe(first.runId); // same content-addressed run
  });
});
