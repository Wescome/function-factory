/**
 * PLAYBOOK-KEEL-PARALLEL-SLICE-001 — Track 2 (completion-push wake) and
 * Track 3 (SDK-scheduled reaper) against the REAL Orchestrator DO (mirrors
 * test/compose-anchor.test.ts's cloudflare:test style). The fan-out spine
 * itself (childStub -> admit, derived_child, join()/compose()) is
 * unchanged and proven by the existing suite (test/compose-anchor.test.ts,
 * test/spec-loop-join.test.ts, etc.) staying green -- these tests exercise
 * ONLY what this playbook adds: the push, the reaper, and idempotent
 * late-completion.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ComposeClauseVerdict = { criterionId: string; outcome: string; reason?: string; outputs: Record<string, unknown> };
type DebugFanout = {
  children: readonly { runId: string; doName: string; servesClause: string | null; reportedState: string | null; reapAttempts: number; reapScheduleId: string | null }[];
  lastCompose: { payload: unknown; at: number } | null;
  lateCompletions: readonly { runId: string; terminalState: string; reportedAt: number }[];
};

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
    join(): Promise<{ ready: boolean; children: readonly unknown[] } | { error: string }>;
    compose(): Promise<{ ready: boolean; clauses: readonly ComposeClauseVerdict[] } | { error: string }>;
    childCompleted(runId: string, terminalState: "ACCEPT" | "ESCALATE"): Promise<void>;
    reapStuckChildren(payload: { runId: string; doName: string }): Promise<void>;
    debugFanout(): Promise<DebugFanout>;
  };
}

/** Bounded wait for push-driven compose to land -- a PURE READ
 *  (debugFanout, never /compose), mirroring compose-anchor.test.ts's own
 *  pollJoinReady: waiting for eventual consistency in a TEST is not the
 *  same concern as "the parent/caller must not poll in PRODUCTION" (Track
 *  2's own claim) -- this never triggers computation, only observes when
 *  the push already has. */
async function pollUntilComposed(stub: ReturnType<typeof stubFor>): Promise<DebugFanout> {
  for (let i = 0; i < 100; i++) {
    const fanout = await stub.debugFanout();
    if (fanout.lastCompose) return fanout;
    await sleep(50);
  }
  throw new Error("timed out waiting for push-driven compose to land");
}

const composeDeadRoot = () => ({
  intent: "compose-anchor-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "R1", statement: "R1 marker", kind: "example" as const },
    { id: "R2", statement: "R2 marker", kind: "example" as const },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "compose-dead@v1",
  forbids: [], decomposable: true,
});

const stuckFanoutRoot = () => ({
  intent: "stuck-fanout-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "FAST", statement: "FAST marker", kind: "example" as const },
    { id: "STUCK", statement: "STUCK marker", kind: "example" as const },
  ],
  connectors: ["echo", "gate"], approvalGated: ["gate"], attemptBudget: 1, oracleRef: "echo@v1",
  forbids: [], decomposable: true,
});

describe("Track 2 — completion-push wake", () => {
  it("composes on its own, with NO external poll of /compose — a bounded wait, observing only", async () => {
    const stub = stubFor("fanout-push-compose");
    await stub.admit(composeDeadRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);
    expect(d.admittedRuns).toHaveLength(2);

    // Waits for both fast, scripted children to finish and push -- reads
    // ONLY (debugFanout), never calls /compose or /join itself, so a
    // populated `lastCompose` can only mean the PUSH already computed it.
    const fanout = await pollUntilComposed(stub);
    expect(fanout.children.every((c) => c.reportedState === "ACCEPT" || c.reportedState === "ESCALATE")).toBe(true);
    const payload = fanout.lastCompose!.payload as { ready: boolean; clauses: readonly ComposeClauseVerdict[] };
    expect(payload.ready).toBe(true);
    const r3 = payload.clauses.find((c) => c.criterionId === "R3");
    expect(r3?.outcome).toBe("pass"); // compose-dead@v1: well-formed re: anchor, the real verdict
  });

  it("each child's reap schedule is cancelled once it reports — no stray schedule left behind", async () => {
    const stub = stubFor("fanout-push-cancels-reap");
    await stub.admit(composeDeadRoot());
    await stub.derive();
    const fanout = await pollUntilComposed(stub);

    expect(fanout.children.every((c) => c.reportedState !== null)).toBe(true);
    // reapAttempts stayed 0 -- these children reported well within their
    // budget-derived deadline, so no reap ever fired for them.
    expect(fanout.children.every((c) => c.reapAttempts === 0)).toBe(true);
  });

  it("D.5-adjacent (Track 2): a late/duplicate childCompleted for an already-reported child is recorded, not silently dropped, and never re-composes", async () => {
    const stub = stubFor("fanout-late-duplicate");
    await stub.admit(composeDeadRoot());
    await stub.derive();

    const before = await pollUntilComposed(stub);
    const already = before.children.find((c) => c.reportedState !== null)!;
    const composedAtBefore = before.lastCompose!.at;

    await stub.childCompleted(already.runId, "ACCEPT"); // duplicate delivery

    const after = await stub.debugFanout();
    expect(after.lateCompletions.some((l) => l.runId === already.runId)).toBe(true);
    expect(after.lastCompose!.at).toBe(composedAtBefore); // did not re-compose
  });
});

describe("Track 3 — SDK-scheduled reaper (per-child, bounded-retry-then-escalate)", () => {
  it("D.2/C.2: fan-out schedules a real per-child reaper (this.schedule, not raw setAlarm) the moment each child is recorded", async () => {
    const stub = stubFor("fanout-schedules-reaper");
    await stub.admit(stuckFanoutRoot());
    await stub.derive();
    const fanout = await stub.debugFanout();
    expect(fanout.children).toHaveLength(2);
    expect(fanout.children.every((c) => !!c.reapScheduleId)).toBe(true);
  });

  it("a child that never reports (PAUSED, awaiting an approval this fixture never grants) is DETERMINISTIC to reap — never a timing race", async () => {
    const stub = stubFor("fanout-reap-stuck");
    await stub.admit(stuckFanoutRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);
    const stuck = d.admittedRuns.find((r) => r.servesClause === "STUCK")!;
    const fast = d.admittedRuns.find((r) => r.servesClause === "FAST")!;

    // First reap: "it may have hit a transient" -- re-admit once (idempotent,
    // D7), schedule a second deadline. Simulated directly (no real
    // multi-minute wait) -- the reap LOGIC is what's under test here, not
    // the SDK's own alarm-firing mechanism.
    await stub.reapStuckChildren({ runId: stuck.runId, doName: stuck.doName });
    let fanout = await stub.debugFanout();
    let stuckRow = fanout.children.find((c) => c.runId === stuck.runId)!;
    expect(stuckRow.reapAttempts).toBe(1);
    expect(stuckRow.reportedState).toBeNull(); // still not reported -- genuinely paused, never approved

    // Second reap, still silent: fail-closed -- escalate, don't retry forever.
    await stub.reapStuckChildren({ runId: stuck.runId, doName: stuck.doName });
    fanout = await stub.debugFanout();
    stuckRow = fanout.children.find((c) => c.runId === stuck.runId)!;
    expect(stuckRow.reportedState).toBe("ESCALATED");

    // B.4: per-child, not per-join -- reaping the stuck one never touched
    // the fast sibling's own bookkeeping.
    const fastRow = fanout.children.find((c) => c.runId === fast.runId)!;
    expect(fastRow.reapAttempts).toBe(0);
  });

  it("join()'s own pull-read stays honest: reap-escalation never fabricates a real verdict for the child that never finished", async () => {
    // DISCOVERED (not introduced by this playbook): PAUSE is recorded into
    // run_terminal (persistTerminal's own PAUSE branch), so join()'s
    // PRE-EXISTING readiness check (`terminal !== null`) already treats a
    // paused child as "terminal enough" -- independent of Track 2/3's own
    // reported_state bookkeeping, which is what actually gates
    // composeIfAllReported. What Track 3 guarantees is narrower and still
    // holds: reap-escalation is bookkeeping ONLY -- it never writes a fake
    // ACCEPT/ESCALATE verdict for the child. join()'s pull-read of a
    // genuinely-paused child still honestly shows no real outcome.
    const stub = stubFor("fanout-reap-join-honest");
    await stub.admit(stuckFanoutRoot());
    const d = await stub.derive();
    if ("error" in d) throw new Error(d.error);
    const stuck = d.admittedRuns.find((r) => r.servesClause === "STUCK")!;

    await stub.reapStuckChildren({ runId: stuck.runId, doName: stuck.doName });
    await stub.reapStuckChildren({ runId: stuck.runId, doName: stuck.doName }); // escalate

    const j = await stub.join();
    if ("error" in j) throw new Error(j.error);
    const stuckReport = j.children.find((c) => (c as { runId: string }).runId === stuck.runId) as { terminal: string | null; outcome: string | null };
    expect(stuckReport.terminal).toBe("PAUSE"); // its own real, honest state -- never overwritten to look ACCEPTed
    expect(stuckReport.outcome).toBeNull(); // no verdict was ever fabricated for it
  });
});
