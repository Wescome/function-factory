/**
 * PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (D.2, D.4): writes + rollback, driven
 * through the real spec-loop (admit -> PAUSE -> approve -> AMEND -> ...).
 *
 * One spec, budget 2: attempt 1 creates two files under a write-effectful
 * (approval-gated) path and deliberately fails; the AMEND path reverts its
 * writes before attempt 2 runs. Attempt 2 reads both paths back and only
 * passes if the revert actually removed them.
 *
 * (Sharing one Workspace across SEPARATE specs/admits was tried first and
 * doesn't work: approve() reloads "the" Specification via `nodes.find(kind
 * === "Specification")`, which is the FIRST one ever admitted to a DO --
 * correct for one spec's own multi-attempt loop, wrong once a second,
 * later-admitted spec shares the same DO. See test/rollback-preimage.test.ts
 * for the pre-image-RESTORE case (an existing file's prior content, not
 * just a created file's deletion), tested directly against the connector.)
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    approve(): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null; verdict: unknown; executionId: string | null; nodeKinds: string[] } | null>;
    dumpNodes(): Promise<readonly { kind: string }[]>;
  };
}

const spec = {
  intent: "wr-clean-test",
  acceptance: [{ id: "A1", statement: "attempt 1's created files are gone by attempt 2", kind: "example" as const }],
  connectors: ["state"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: ["state"],
  attemptBudget: 2,
  oracleRef: "wr-clean@v1",
  forbids: [],
  decomposable: false,
};

/** Drive PAUSE -> approve() cycles (each write-effectful call gates
 *  individually, D8) through to a terminal state. */
async function driveToTerminal(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 200; i++) {
    const r = await stub.result();
    if (r?.state === "ACCEPT" || r?.state === "ESCALATE") return r;
    if (r?.state === "PAUSE") { await stub.approve(); continue; }
    await sleep(30);
  }
  return stub.result();
}

describe("PLAYBOOK-KEEL-WRITE-ROLLBACK-001 — writes + rollback (spec-loop level)", () => {
  it("D.2: attempt 1's writes are reverted before attempt 2 -- files created by the failed attempt are gone", async () => {
    const stub = stubFor("wr-clean-1");
    await stub.admit(spec);
    const r = await driveToTerminal(stub);
    expect(r?.state).toBe("ACCEPT"); // only true if aGone/bGone are both true on attempt 2
    expect(r?.nodeKinds).toContain("Amendment"); // confirms it really did amend, not accept on attempt 1
  }, 30000);

  it("D.4: rollback writes nothing to the append-only ledger -- only the loop's own nodes are added", async () => {
    const stub = stubFor("wr-clean-2");
    await stub.admit(spec);
    const r = await driveToTerminal(stub);
    expect(r?.state).toBe("ACCEPT");
    // Only the loop's OWN node kinds appear -- Specification, Action,
    // ExecutionTrace (one per pause + one per completion -- each
    // write-effectful call gates individually, unrelated to rollback),
    // Verdict, Amendment. The revert itself never calls repo.append/emit,
    // so no extra/unexpected kind appears, and exactly one Specification
    // (rollback never re-admits or mutates the run's own root).
    const kinds = (await stub.dumpNodes()).map((n) => n.kind);
    const distinctKinds = [...new Set(kinds)].sort();
    expect(distinctKinds).toEqual(["Action", "Amendment", "ExecutionTrace", "Specification", "Verdict"]);
    expect(kinds.filter((k) => k === "Specification")).toHaveLength(1);
  }, 30000);
});
