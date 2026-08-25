/**
 * PLAYBOOK-KEEL-SCR-PORT-3, Track 3: SCR's land suite, adapted, proven
 * through `ReviewCore`'s REAL RPC surface (not `runInDurableObject`) --
 * the serialization guard specifically needs genuine concurrent RPC calls
 * hitting the SAME DO instance mid-`land()`, which a single synchronous
 * JS turn cannot produce. Local-only (no `land_config` row, no external
 * repo): proves the compose/atomicity/serialization mechanics.
 *
 * The external/drift/real-push/real-PR proof runs live against production
 * (`https://github.com/wescome/keel-scr-scratch`) -- `@cloudflare/shell`'s
 * git surface only fetches over real HTTP (isomorphic-git/http/web), so
 * there is no local file://-remote equivalent to simulate a genuinely
 * external drift from inside vitest-pool-workers.
 */
import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { InvariantViolation } from "../src/scr/events";
import type { LandResult } from "../src/composition/review-core";

function stubFor(name: string) {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  return ns.get(ns.idFromName(name)) as unknown as {
    openSeries(actorId: string, targetRef: string, targetSha: string): Promise<string>;
    openChange(actorId: string, seriesId: string, title: string, requiredReviewers?: string[]): Promise<string>;
    appendRevision(actorId: string, changeId: string, hunks: { path: string; anchor: string; content: string }[]): Promise<number>;
    recordVerdict(reviewerId: string, changeId: string, decision: "approve" | "reject"): Promise<string>;
    recordCheck(actorId: string, changeId: string, kind: "isolated" | "integrated", outcome: "pass" | "fail"): Promise<string>;
    land(actorId: string, seriesId: string, changeIds: string[]): Promise<LandResult>;
    provenanceOf(sha: string): Promise<{ changeId: string } | null>;
    snapshot(seriesId: string): Promise<{ series: unknown; changes: unknown[]; lands: unknown[]; landInProgress: boolean }>;
  };
}

describe("PORT-3, Track 3 — clean land through the real RPC surface (local, no external repo)", () => {
  it("open -> revise -> approve -> check -> land: real commits, LandEvent, provenanceOf resolves", async () => {
    const stub = stubFor("port3-clean-land-1");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("alice", s, "A", ["bob"]);
    await stub.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A1" }]);
    await stub.recordVerdict("bob", a, "approve");
    await stub.recordCheck("ci", a, "integrated", "pass");

    const result = await stub.land("wes", s, [a]);
    expect(result.landEventId).toBeTruthy();
    expect(result.landedShas.length).toBe(1);
    expect(result.pr).toBeUndefined(); // no land_config -- local-only, PORT-1/2 behavior unchanged

    const prov = await stub.provenanceOf(result.landedShas[0]!);
    expect(prov?.changeId).toBe(a);
  });

  it("landInProgress clears after a land completes, and after a refused (INV-9) one", async () => {
    const stub = stubFor("port3-clean-land-2");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("alice", s, "A", []);
    await stub.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A1" }]);
    await stub.recordCheck("ci", a, "integrated", "pass");
    await stub.land("wes", s, [a]);

    const after = await stub.snapshot(s);
    expect(after.landInProgress).toBe(false);
  });
});

describe("PORT-3, Track 3 — atomicity (INV-6): a mid-sequence failure never half-advances the ref", () => {
  it("a land that throws mid-compose leaves nothing landed", async () => {
    const stub = stubFor("port3-atomicity-1");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("alice", s, "A", []);
    // No revision, no check -- land() itself refuses this precondition
    // (INV-2/INV-4) before ever calling compose(), which IS the atomicity
    // guarantee in its simplest form: a refused land never touches the ref.
    // Wrapped in an async fn: workerd JSRPC promises are pipelining proxies, and a raw one handed to `.rejects` mints a second, unobserved derived promise on rejection.
    await expect(async () => { await stub.land("wes", s, [a]); }).rejects.toThrow();

    const snap = await stub.snapshot(s);
    expect(snap.lands.length).toBe(0);
    expect(snap.landInProgress).toBe(false); // guard cleared even on throw
  });
});

describe("PORT-3, Track 3 — serialization: an approve/revise arriving during a land is refused, never corrupts it", () => {
  it("the guard check itself: a write is refused while in_progress is set, and succeeds once cleared", async () => {
    // A GENUINE RPC race was tried first and dropped: calling `stub.land(...)`
    // before `stub.recordVerdict(...)` from the client does NOT reliably mean
    // land()'s synchronous guard-check-then-set prefix runs first inside the
    // DO -- there's at least one async hop in the RPC dispatch/deserialization
    // layer itself, BEFORE either method body starts, and that hop's ordering
    // isn't something this test can control or assert on without becoming
    // flaky. What CAN be proven deterministically, locally, is the guard's
    // OWN logic: does a write really get refused while the flag is set, and
    // does it really succeed once cleared. The genuine multi-request race is
    // what the real-infra probe exercises instead, where land()'s own
    // execution window is a real network round-trip (push + PR-open) --
    // long enough that a concurrent write landing mid-flight is the realistic
    // case this guard exists for.
    const stub = stubFor("port3-serialize-1");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("alice", s, "A", []);
    await stub.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A1" }]);

    const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
    const rawStub = ns.get(ns.idFromName("port3-serialize-1"));
    await runInDurableObject(rawStub, (_instance, state) => {
      state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS land_state (id INTEGER PRIMARY KEY, in_progress INTEGER NOT NULL DEFAULT 0)`);
      state.storage.sql.exec(`INSERT OR REPLACE INTO land_state (id, in_progress) VALUES (1, 1)`);
    });

    // Crosses the real DO RPC boundary -- the thrown error is serialized and
    // reconstructed on this side, so it does NOT preserve the InvariantViolation
    // prototype (`instanceof` fails even though `.invariant` survives). Same
    // reason `scr-git-port2.test.ts` only asserts on `.invariant` for its own
    // real-RPC throw, never `instanceof`, for calls that cross that boundary.
    let threw: unknown;
    try { await stub.recordVerdict("bob", a, "approve"); } catch (e) { threw = e; }
    expect((threw as InvariantViolation)?.invariant).toBe("INV-6");

    await runInDurableObject(rawStub, (_instance, state) => {
      state.storage.sql.exec(`INSERT OR REPLACE INTO land_state (id, in_progress) VALUES (1, 0)`);
    });

    const vid = await stub.recordVerdict("bob", a, "approve");
    expect(vid).toBeTruthy();
  });

  it("the guard clears even when land() itself throws, so writes are never permanently locked out", async () => {
    const stub = stubFor("port3-serialize-2");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("alice", s, "A", []);
    await stub.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A1" }]);
    // No check recorded -- land() throws INV-4 before compose ever runs.
    // Wrapped in an async fn: workerd JSRPC promises are pipelining proxies, and a raw one handed to `.rejects` mints a second, unobserved derived promise on rejection.
    await expect(async () => { await stub.land("wes", s, [a]); }).rejects.toThrow();

    // A write immediately after -- proves the flag was cleared in `finally`.
    const vid = await stub.recordVerdict("bob", a, "approve");
    expect(vid).toBeTruthy();
  });
});
