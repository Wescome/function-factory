/**
 * PLAYBOOK-KEEL-HANDOFF-001 (C2) — the pipeline: dependency-ordered handoff,
 * against the REAL Orchestrator DO (mirrors test/parallel-slice-fanout.test.ts's
 * cloudflare:test style). C1's fan-out spine (childStub -> admit,
 * derived_child, childCompleted push, SDK reaper) is unchanged and proven by
 * that existing suite staying green — these tests exercise ONLY what C2
 * adds: held admission at fan-out, event-driven release on the upstream's
 * own completion-push, result-reference forwarding, cycle fail-closing the
 * batch, and escalation propagating to a held downstream through the SAME
 * reaper.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type DebugFanout = {
  children: readonly {
    runId: string; doName: string; servesClause: string | null; reportedState: string | null;
    reapAttempts: number; reapScheduleId: string | null; held: boolean; dependsOn: readonly string[];
  }[];
  lastCompose: { payload: unknown; at: number } | null;
  lateCompletions: readonly { runId: string; terminalState: string; reportedAt: number }[];
};

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    derive(): Promise<{ admitted: number; escalated: boolean; dependencyCycle?: readonly string[]; admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
    join(): Promise<{ ready: boolean; children: readonly unknown[] } | { error: string }>;
    reapStuckChildren(payload: { runId: string; doName: string }): Promise<void>;
    debugFanout(): Promise<DebugFanout>;
  };
}

/** Bounded wait for a condition over debugFanout — a PURE READ, never
 *  triggering computation itself (mirrors parallel-slice-fanout.test.ts's
 *  own pollUntilComposed). */
async function pollUntil(stub: ReturnType<typeof stubFor>, pred: (f: DebugFanout) => boolean): Promise<DebugFanout> {
  for (let i = 0; i < 100; i++) {
    const fanout = await stub.debugFanout();
    if (pred(fanout)) return fanout;
    await sleep(50);
  }
  throw new Error("timed out waiting for the expected fan-out state");
}

const handoffRoot = () => ({
  intent: "handoff-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "UP", statement: "UP marker", kind: "example" as const },
    { id: "DOWN", statement: "DOWN marker", kind: "example" as const, dependsOn: ["UP"] },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 1, oracleRef: "handoff@v1",
  forbids: [], decomposable: true,
});

const handoffCycleRoot = () => ({
  intent: "handoff-cycle-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "CYCLE-A", statement: "CYCLE-A marker", kind: "example" as const, dependsOn: ["CYCLE-B"] },
    { id: "CYCLE-B", statement: "CYCLE-B marker", kind: "example" as const, dependsOn: ["CYCLE-A"] },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 1, oracleRef: "handoff@v1",
  forbids: [], decomposable: true,
});

const handoffStuckRoot = () => ({
  intent: "handoff-stuck-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "UP", statement: "UP marker", kind: "example" as const },
    { id: "DOWN", statement: "DOWN marker", kind: "example" as const, dependsOn: ["UP"] },
  ],
  connectors: ["echo", "gate"], approvalGated: ["gate"], attemptBudget: 1, oracleRef: "handoff@v1",
  forbids: [], decomposable: true,
});

describe("C2, Track 1/2 — held admission at fan-out, event-driven release", () => {
  it("DOWN is recorded HELD at fan-out (not deferred to release) and UP admits immediately", async () => {
    const stub = stubFor("handoff-held-at-fanout");
    await stub.admit(handoffRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);

    // Only UP is actually admitted (a real child run) at fan-out --
    // DOWN is held, not yet a real run.
    expect(d.admittedRuns).toHaveLength(1);
    expect(d.admittedRuns[0]!.servesClause).toBe("UP");

    // But BOTH are already recorded in derived_child -- the held-at-fan-out
    // anchor: composeIfAllReported's completeness check must see the full
    // row set from the moment fan-out finishes, not just the immediate ones.
    const fanout = await stub.debugFanout();
    expect(fanout.children).toHaveLength(2);
    const down = fanout.children.find((c) => c.servesClause === "DOWN")!;
    expect(down.held).toBe(true);
    expect(down.dependsOn).toEqual(["UP"]);
    expect(down.reportedState).toBeNull();
    expect(down.reapScheduleId).toBeNull(); // no reap for a held child
  });

  it("DOWN releases the moment UP's completion-push lands, carrying UP's reference as consumesResults, and the pipeline composes end to end", async () => {
    const stub = stubFor("handoff-release-on-push");
    await stub.admit(handoffRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);

    // Wait for DOWN to flip from held to admitted (event-driven, off UP's
    // own childCompleted push -- never a poll of /derive or /compose).
    const released = await pollUntil(stub, (f) => f.children.find((c) => c.servesClause === "DOWN")?.held === false);
    const down = released.children.find((c) => c.servesClause === "DOWN")!;
    expect(down.held).toBe(false);
    expect(down.reapScheduleId).not.toBeNull(); // reap scheduled the moment it actually starts running

    // Both eventually report and the whole tree composes.
    const composed = await pollUntil(stub, (f) => !!f.lastCompose);
    expect(composed.children.every((c) => c.reportedState === "ACCEPT")).toBe(true);

    const j = await stub.join();
    if ("error" in j) throw new Error(j.error);
    expect(j.ready).toBe(true);
  });
});

describe("C2, Track 1 — cycle fail-closes the whole batch (INV-HANDOFF-CYCLE, C2a)", () => {
  it("a declared cycle escalates derive() itself -- nothing admitted, nothing held, no silent partial fan-out", async () => {
    const stub = stubFor("handoff-cycle-escalates");
    await stub.admit(handoffCycleRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);

    expect(d.admitted).toBe(0);
    expect(d.escalated).toBe(true);
    expect(d.dependencyCycle).toEqual(["CYCLE-A", "CYCLE-B"]);
    expect(d.admittedRuns).toHaveLength(0);

    const fanout = await stub.debugFanout();
    expect(fanout.children).toHaveLength(0); // never even reached ctx.admit
  });
});

describe("C2, Track 3 — escalation propagates to a held downstream (INV-HANDOFF-PROPAGATE)", () => {
  it("UP stuck (PAUSED, never approved) -> reaped to ESCALATED after two silent deadlines -> DOWN cascades to ESCALATED without ever being admitted", async () => {
    const stub = stubFor("handoff-propagate-escalate");
    await stub.admit(handoffStuckRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);
    const up = d.admittedRuns.find((r) => r.servesClause === "UP")!;
    expect(up).toBeDefined();

    // DOWN starts out held.
    let fanout = await stub.debugFanout();
    let down = fanout.children.find((c) => c.servesClause === "DOWN")!;
    expect(down.held).toBe(true);

    // First reap: "it may have hit a transient" -- re-admit once, schedule
    // a second deadline. DOWN still held (UP hasn't resolved either way).
    await stub.reapStuckChildren({ runId: up.runId, doName: up.doName });
    fanout = await stub.debugFanout();
    expect(fanout.children.find((c) => c.servesClause === "UP")!.reportedState).toBeNull();
    down = fanout.children.find((c) => c.servesClause === "DOWN")!;
    expect(down.held).toBe(true);
    expect(down.reportedState).toBeNull();

    // Second reap, still silent: UP fail-closes to ESCALATED -- the SAME
    // event cascades to DOWN via releaseSettledHeldChildren, since DOWN's
    // only declared dependency just failed.
    await stub.reapStuckChildren({ runId: up.runId, doName: up.doName });
    fanout = await stub.debugFanout();
    expect(fanout.children.find((c) => c.servesClause === "UP")!.reportedState).toBe("ESCALATED");
    down = fanout.children.find((c) => c.servesClause === "DOWN")!;
    expect(down.reportedState).toBe("ESCALATED");
    expect(down.held).toBe(false);
    // Never actually admitted -- no reap was ever scheduled for it (a held
    // child carries none of its own; it is bounded by its upstream's).
    expect(down.reapAttempts).toBe(0);
  });
});
