/**
 * close-loop.test.ts — G4: the loop closed. AMEND convergence, ESCALATE, and
 * PAUSE→approve (D8 abort-and-replay), all end-to-end on real workerd.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; status: string; runId: string }>;
    approve(): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null; verdict: unknown; executionId: string | null; nodeKinds: string[] } | null>;
  };
}

const spec = (intent: string, attemptBudget = 3) => ({
  intent,
  acceptance: [{ id: "A1", statement: "returns { value: 42 }", kind: "example" as const }],
  connectors: intent === "approve" ? ["gate"] : ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: intent === "approve" ? ["gate"] : ([] as string[]),
  attemptBudget,
  oracleRef: "echo@v1",
});

async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  let r: Awaited<ReturnType<typeof stub.result>> = null;
  for (let i = 0; i < 80; i++) {
    r = await stub.result();
    if (r && until(r.state)) break;
    await sleep(20);
  }
  return r;
}

describe("KEEL — close the loop (G4)", () => {
  it("AMEND: a first-attempt failure converges via amend to ACCEPT", async () => {
    const stub = stubFor("g4-converge");
    await stub.admit(spec("converge"));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ACCEPT");
    // proof it actually amended: >= 2 attempts (2 Verdicts) and an Amendment node
    const verdicts = r?.nodeKinds.filter((k) => k === "Verdict").length ?? 0;
    expect(verdicts).toBeGreaterThanOrEqual(2);
    expect(r?.nodeKinds).toContain("Amendment");
  });

  it("ESCALATE: a task that never passes exhausts budget and escalates", async () => {
    const stub = stubFor("g4-escalate");
    await stub.admit(spec("never", 2));
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ESCALATE");
    const verdicts = r?.nodeKinds.filter((k) => k === "Verdict").length ?? 0;
    expect(verdicts).toBe(2); // exactly the budget
  });

  it("PAUSE -> approve: an approval-gated call pauses, then replays to ACCEPT (D8)", async () => {
    const stub = stubFor("g4-pause");
    await stub.admit(spec("approve"));
    const paused = await poll(stub, (s) => s === "PAUSE");
    expect(paused?.state).toBe("PAUSE");
    expect(paused?.executionId).toBeTruthy();

    const resumed = await stub.approve();
    expect(resumed.resumed).toBe(true);

    const done = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(done?.state).toBe("ACCEPT");
  });
});
