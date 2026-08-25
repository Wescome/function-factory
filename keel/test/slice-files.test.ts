/**
 * PLAYBOOK-KEEL-SLICE-FILES-001 (C1b) — the file-coordination floor, against
 * the REAL Orchestrator DO (mirrors test/parallel-slice-fanout.test.ts's and
 * test/workspace-write-rollback.test.ts's cloudflare:test style). Track 1
 * (isolation) is a CONFIRMED-not-built finding (see orchestrator.ts's
 * `workspace` getter doc) — no test needed for infrastructure that already
 * existed before this playbook. These tests exercise Track 2 (writtenFiles)
 * and Track 3 (the seam's file-overlap gate).
 *
 * `join()`/`compose()` are PULL reads (they call each child DO directly, live,
 * every time) — so driving a child through PAUSE -> approve() -> ACCEPT
 * directly (bypassing the parent) is sufficient; no push/event dependency.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JoinChild = { runId: string; doName: string; servesClause: string | null; terminal: string | null; writtenFiles: readonly string[] };
type ComposeResult = { ready: boolean; clauses: readonly unknown[]; seams: readonly unknown[]; fileOverlaps?: readonly { file: string; children: readonly string[] }[] };

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    approve(): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null } | null>;
    derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
    join(): Promise<{ ready: boolean; children: readonly JoinChild[] } | { error: string }>;
    compose(): Promise<ComposeResult | { error: string }>;
    writtenFiles(): Promise<readonly string[]>;
  };
}

/** Drive PAUSE -> approve() cycles through to a terminal state -- mirrors
 *  workspace-write-rollback.test.ts's own driveToTerminal exactly, applied
 *  here to a DERIVED CHILD's own doName (not the root). */
async function driveToTerminal(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 200; i++) {
    const r = await stub.result();
    if (r?.state === "ACCEPT" || r?.state === "ESCALATE") return r;
    if (r?.state === "PAUSE") { await stub.approve(); continue; }
    await sleep(30);
  }
  return stub.result();
}

const seamRoot = (intent: string) => ({
  intent, capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "X", statement: "X marker", kind: "example" as const },
    { id: "Y", statement: "Y marker", kind: "example" as const },
  ],
  connectors: ["state"], approvalGated: ["state"], attemptBudget: 1, oracleRef: "seam-files@v1",
  forbids: [], decomposable: true,
});

describe("C1b, Track 2 — discovered written-file set", () => {
  it("a slice that wrote a.ts and b.ts reports exactly those, via the parent's own join()", async () => {
    const root = stubFor("slice-files-writtenfiles");
    await root.admit(seamRoot("seam-disjoint-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    expect(d.admittedRuns).toHaveLength(2);

    for (const run of d.admittedRuns) {
      const r = await driveToTerminal(stubFor(run.doName));
      expect(r?.state).toBe("ACCEPT");
    }

    const j = await root.join();
    if ("error" in j) throw new Error(j.error);
    expect(j.ready).toBe(true);
    const x = j.children.find((c) => c.servesClause === "X")!;
    const y = j.children.find((c) => c.servesClause === "Y")!;
    expect(x.writtenFiles).toEqual(["x-only.ts"]);
    expect(y.writtenFiles).toEqual(["y-only.ts"]);
  }, 30000);
});

describe("C1b, Track 3 — the seam overlap floor", () => {
  it("disjoint file sets compose exactly as today — ready:true, no fileOverlaps", async () => {
    const root = stubFor("slice-files-disjoint-composes");
    await root.admit(seamRoot("seam-disjoint-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    for (const run of d.admittedRuns) await driveToTerminal(stubFor(run.doName));

    const c = await root.compose();
    if ("error" in c) throw new Error(c.error);
    expect(c.ready).toBe(true);
    expect(c.fileOverlaps).toBeUndefined();
  }, 30000);

  it("two slices that wrote the SAME file are caught at the seam — not merged, surfaced (INV-SLICE-SEAM-FLOOR)", async () => {
    const root = stubFor("slice-files-overlap-blocks");
    await root.admit(seamRoot("seam-overlap-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    for (const run of d.admittedRuns) await driveToTerminal(stubFor(run.doName));

    // Both children genuinely finished (ACCEPT) -- join() itself is ready.
    const j = await root.join();
    if ("error" in j) throw new Error(j.error);
    expect(j.ready).toBe(true);

    // But compose() refuses: the overlap gate fires BEFORE the (otherwise
    // passing) result-composition logic ever runs.
    const c = await root.compose();
    if ("error" in c) throw new Error(c.error);
    expect(c.ready).toBe(false);
    expect(c.fileOverlaps).toEqual([{ file: "shared.ts", children: ["X", "Y"] }]);
    expect(c.clauses).toEqual([]); // never reached the existing composes/seams logic
  }, 30000);
});
