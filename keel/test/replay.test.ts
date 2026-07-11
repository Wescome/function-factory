/**
 * replay.test.ts — G5: lineage + replay. Any run replays from any state, and
 * the run's decisions replay deterministically (decide() re-derived from the
 * append-only record reproduces the recorded control flow).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    approve(): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null } | null>;
    readRun(): Promise<{ runId: string | null; nodes: { id: string; kind: string }[]; events: number; terminal: string | null }>;
    timeline(): Promise<{ index: number; type: string; state: string }[]>;
    replayTo(index: number): Promise<{ index: number; state: string; presentKinds: string[] }>;
    verifyReplay(): Promise<{ consistent: boolean; steps: number; reason?: string }>;
    crossRun(): Promise<{ intent: string; terminal: string; attempts: number; nodeCounts: Record<string, number> }>;
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
  for (let i = 0; i < 80; i++) {
    const r = await stub.result();
    if (r && until(r.state)) return r;
    await sleep(20);
  }
  return null;
}

describe("KEEL — lineage + replay (G5)", () => {
  it("a converge run replays deterministically and from any state", async () => {
    const stub = stubFor("g5-converge");
    await stub.admit(spec("converge"));
    await poll(stub, (s) => s === "ACCEPT");

    // the recorded timeline is the full state sequence, incl. the amend
    const tl = await stub.timeline();
    const states = tl.map((t) => t.state);
    expect(states[0]).toBe("INTENT");
    expect(states).toContain("AMEND");
    expect(states[states.length - 1]).toBe("ACCEPT");

    // replay from ANY state: every index reconstructs a valid snapshot with a
    // non-shrinking present-node set
    let lastCount = 0;
    for (let i = 0; i < tl.length; i++) {
      const snap = await stub.replayTo(i);
      expect(snap.state).toBe(states[i]);
      expect(snap.presentKinds.length).toBeGreaterThanOrEqual(lastCount);
      lastCount = snap.presentKinds.length;
    }
    // first index sees only the Specification; last sees the whole chain
    expect((await stub.replayTo(0)).presentKinds).toEqual(["Specification"]);
    const full = await stub.replayTo(tl.length - 1);
    expect(full.presentKinds).toEqual(expect.arrayContaining(["Specification", "Action", "ExecutionTrace", "Verdict"]));

    // THE core proof: decisions re-derived from lineage reproduce the run
    const rc = await stub.verifyReplay();
    expect(rc.consistent).toBe(true);
    expect(rc.steps).toBeGreaterThanOrEqual(2); // two verdicts (fail -> amend -> pass)
  });

  it("a paused-then-approved run replays across the pause boundary", async () => {
    const stub = stubFor("g5-pause");
    await stub.admit(spec("approve"));
    await poll(stub, (s) => s === "PAUSE");
    await stub.approve();
    await poll(stub, (s) => s === "ACCEPT");

    const tl = await stub.timeline();
    const states = tl.map((t) => t.state);
    expect(states).toContain("PAUSE");
    expect(states[states.length - 1]).toBe("ACCEPT");
    expect((await stub.verifyReplay()).consistent).toBe(true);
  });

  it("cross-run records project terminal + attempts per run", async () => {
    const conv = stubFor("g5-xr-converge");
    await conv.admit(spec("converge"));
    await poll(conv, (s) => s === "ACCEPT");
    const esc = stubFor("g5-xr-escalate");
    await esc.admit(spec("never", 2));
    await poll(esc, (s) => s === "ESCALATE");

    const cr1 = await conv.crossRun();
    expect(cr1).toMatchObject({ intent: "converge", terminal: "ACCEPT" });
    expect(cr1.attempts).toBeGreaterThanOrEqual(2);
    expect(cr1.nodeCounts.Amendment).toBeGreaterThanOrEqual(1);

    const cr2 = await esc.crossRun();
    expect(cr2).toMatchObject({ intent: "never", terminal: "ESCALATE", attempts: 2 });
  });
});
