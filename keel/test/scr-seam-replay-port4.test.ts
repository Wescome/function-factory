/**
 * PLAYBOOK-KEEL-SCR-PORT-4, Track 2 — the seam replay.
 *
 * C1b gave the file-overlap floor exactly one thing to say: refused. This
 * is the layer that lets it say WHY, and sometimes say "and here is the
 * merge, go review it." The floor itself is unchanged and still refuses
 * to compose — every outcome below is a non-composing outcome.
 *
 * `.rejects` sites wrap their call in an async function first (see
 * `.agent/patterns/workerd-jsrpc-rejects-proxy.md`). Note that
 * `resolveSeam` deliberately RETURNS its INV-9 conflict rather than
 * throwing, so the hazard does not arise for it at all — conflict is a
 * state, and a state is a value.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { replaySeam } from "../src/scr/seam-replay";
import { AnchorRebaser } from "../src/scr/rebase";
import type { Hunk } from "../src/scr/events";
import type { LandResult } from "../src/composition/review-core";

const rebaser = new AnchorRebaser();
const h = (path: string, anchor: string, content: string): Hunk => ({ path, anchor, content });

function stubFor(name: string) {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  return ns.get(ns.idFromName(name)) as unknown as {
    openSeries(actorId: string, targetRef: string, targetSha: string): Promise<string>;
    openChange(actorId: string, seriesId: string, title: string, requiredReviewers?: string[], parents?: string[]): Promise<string>;
    appendRevision(actorId: string, changeId: string, hunks: Hunk[], reason?: string): Promise<number>;
    recordVerdict(reviewerId: string, changeId: string, decision: "approve" | "reject"): Promise<string>;
    recordCheck(actorId: string, changeId: string, kind: "isolated" | "integrated", outcome: "pass" | "fail"): Promise<string>;
    liveCheck(changeId: string, kind: "isolated" | "integrated"): Promise<{ checkId: string; outcome: "pass" | "fail"; revisionSeq: number } | null>;
    previewSeam(
      seriesId: string,
      ordered: { changeId: string; hunks: Hunk[] }[],
    ): Promise<{ ok: true; resolved: Hunk[] } | { ok: false; invariant: "INV-9"; at: string; changeId: string }>;
    resolveSeam(
      actorId: string,
      seriesId: string,
      ordered: { changeId: string; hunks: Hunk[] }[],
      opts?: { requiredReviewers?: string[]; checkOutcome?: "pass" | "fail" },
    ): Promise<{ ok: true; resolvedChangeId: string } | { ok: false; invariant: "INV-9"; at: string; changeId: string }>;
    land(actorId: string, seriesId: string, changeIds: string[]): Promise<LandResult>;
    liveVerdicts(changeId: string): Promise<readonly { verdictId: string; reviewerId: string }[]>;
    snapshot(seriesId: string): Promise<{
      changes: { id: string; parents?: string[]; revisions?: { seq: number; reason: string; hunks: Hunk[] }[] }[];
      openOrder: string[];
      lands: unknown[];
    }>;
  };
}

describe("PORT-4, Track 2 — replaySeam (pure)", () => {
  it("disjoint anchors resolve clean, to the ordered union", () => {
    const res = replaySeam(
      [
        { changeId: "chg_A", hunks: [h("shared.ts", "top", "from X")] },
        { changeId: "chg_B", hunks: [h("shared.ts", "bottom", "from Y")] },
      ],
      rebaser,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resolved).toEqual([
      h("shared.ts", "top", "from X"),
      h("shared.ts", "bottom", "from Y"),
    ]);
  });

  it("the SAME anchor with different content is INV-9, named at file:anchor", () => {
    const res = replaySeam(
      [
        { changeId: "chg_A", hunks: [h("shared.ts", "top", "from X")] },
        { changeId: "chg_B", hunks: [h("shared.ts", "top", "from Y")] },
      ],
      rebaser,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.at).toEqual({ path: "shared.ts", anchor: "top" });
    // Named on the layer that could not replay -- the SECOND one, the one
    // that arrived onto content already accumulated.
    expect(res.changeId).toBe("chg_B");
  });

  it("replay order fixes the union's ORDER but never the clean/conflict verdict", () => {
    const a = { changeId: "chg_A", hunks: [h("shared.ts", "top", "from X")] };
    const b = { changeId: "chg_B", hunks: [h("shared.ts", "bottom", "from Y")] };

    const ab = replaySeam([a, b], rebaser);
    const ba = replaySeam([b, a], rebaser);
    expect(ab.ok).toBe(true);
    expect(ba.ok).toBe(true);
    if (!ab.ok || !ba.ok) return;
    // Same verdict, same SET...
    expect([...ab.resolved].sort((x, y) => x.anchor.localeCompare(y.anchor)))
      .toEqual([...ba.resolved].sort((x, y) => x.anchor.localeCompare(y.anchor)));
    // ...different order. Which is exactly why the order handed to
    // `replaySeam` must be `Model.openOrder` and not something a caller
    // made up: the resolved CONTENT depends on it.
    expect(ab.resolved.map((x) => x.anchor)).toEqual(["top", "bottom"]);
    expect(ba.resolved.map((x) => x.anchor)).toEqual(["bottom", "top"]);

    // And a genuine conflict is a conflict from either side.
    const c = { changeId: "chg_C", hunks: [h("shared.ts", "top", "from Z")] };
    expect(replaySeam([a, c], rebaser).ok).toBe(false);
    expect(replaySeam([c, a], rebaser).ok).toBe(false);
  });

  it("an identical hunk on both sides is not a conflict, and does not duplicate", () => {
    const res = replaySeam(
      [
        { changeId: "chg_A", hunks: [h("shared.ts", "top", "same")] },
        { changeId: "chg_B", hunks: [h("shared.ts", "top", "same")] },
      ],
      rebaser,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resolved).toEqual([h("shared.ts", "top", "same")]);
  });
});

/**
 * Direct contract tests for `ReviewCore`'s own RPC surface: no
 * orchestrator, no oracle, no slice run. DISCLOSED once for the whole
 * block: every `recordCheck` and every `checkOutcome` below is FIXTURE —
 * a literal this file hands the log to build the precondition a given
 * assertion needs. Nothing here observed anything, and no comment below
 * says otherwise. The tests that prove a check came from a real oracle run
 * are in "OD-PORT4-1: the merged-content check is observed, never assumed"
 * at the bottom of this file, and they record nothing themselves.
 */
describe("PORT-4, Track 2 — resolveSeam through the real RPC surface", () => {
  it("a clean resolution is a real merge point: both slices as parents, conflict-resolution revision, NO inherited approval (INV-14)", async () => {
    const stub = stubFor("port4-resolve-clean");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");

    const a = await stub.openChange("keel", s, "X", ["wes"], []);
    await stub.appendRevision("keel", a, [h("shared.ts", "top", "from X")]);
    await stub.recordVerdict("wes", a, "approve");
    const b = await stub.openChange("keel", s, "Y", ["wes"], []);
    await stub.appendRevision("keel", b, [h("shared.ts", "bottom", "from Y")]);
    await stub.recordVerdict("wes", b, "approve");

    // Both slices carry a live approval going in...
    expect(await stub.liveVerdicts(a)).toHaveLength(1);
    expect(await stub.liveVerdicts(b)).toHaveLength(1);

    const res = await stub.resolveSeam("keel", s, [
      { changeId: a, hunks: [h("shared.ts", "top", "from X")] },
      { changeId: b, hunks: [h("shared.ts", "bottom", "from Y")] },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resolved = res.resolvedChangeId;

    const snap = await stub.snapshot(s);
    const rc = snap.changes.find((c) => c.id === resolved)!;
    expect(rc).toBeTruthy();
    // A real merge point in the SAME one graph -- not a change parked
    // beside it.
    expect(rc.parents).toEqual([a, b]);
    // The content is the ordered union, and it arrived as a
    // conflict-resolution -- the INV-14 trigger, reachable through RPC
    // for the first time (PORT-4 Track 1 widened `appendRevision`).
    const head = rc.revisions!.at(-1)!;
    expect(head.reason).toBe("conflict-resolution");
    expect(head.hunks).toEqual([h("shared.ts", "top", "from X"), h("shared.ts", "bottom", "from Y")]);
    // INV-14 RESOLUTION-NEVER-CARRIES: the resolution inherits NOTHING.
    // Both parents were approved; the merge of them is not.
    expect(await stub.liveVerdicts(resolved)).toEqual([]);
    // It also inherited its parents' required reviewers, so the approval
    // it lacks is an approval it genuinely needs.
    expect(await stub.liveVerdicts(a)).toHaveLength(1); // the parents' own verdicts are untouched
  });

  it("the resolution is fail-closed at land: no fresh verdict, no landing — and no check, no landing either", async () => {
    const stub = stubFor("port4-resolve-failclosed");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("keel", s, "X", [], []);
    await stub.appendRevision("keel", a, [h("shared.ts", "top", "from X")]);
    await stub.recordCheck("keel", a, "integrated", "pass");
    const b = await stub.openChange("keel", s, "Y", [], []);
    await stub.appendRevision("keel", b, [h("shared.ts", "bottom", "from Y")]);
    await stub.recordCheck("keel", b, "integrated", "pass");

    const res = await stub.resolveSeam(
      "keel",
      s,
      [
        { changeId: a, hunks: [h("shared.ts", "top", "from X")] },
        { changeId: b, hunks: [h("shared.ts", "bottom", "from Y")] },
      ],
      // DISCLOSED INJECTION. This is a contract test for `resolveSeam`'s
      // OPTIONS, called directly against the review-log RPC surface with
      // no orchestrator and no oracle in the picture: `checkOutcome:
      // "pass"` is a literal this test hands in to prove the option is
      // wired to `recordCheck`, NOT an outcome anything observed. The
      // production caller derives it from a real oracle run
      // (`Orchestrator.verifyMergedContent`); the test that proves THAT is
      // "a clean seam records the check the oracle actually produced",
      // below, which records nothing itself.
      { requiredReviewers: ["wes"], checkOutcome: "pass" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resolved = res.resolvedChangeId;

    // Landing the whole downward-closed set is refused: the resolution has
    // a required reviewer and no live approval. This is the point of the
    // whole track -- resolved content is content nobody reviewed.
    await expect(async () => { await stub.land("wes", s, [a, b, resolved]); }).rejects.toThrow();
    expect((await stub.snapshot(s)).lands).toHaveLength(0);

    // A FRESH human verdict on the resolution -- not a carried-forward one
    // -- is what unblocks it.
    await stub.recordVerdict("wes", resolved, "approve");
    const result = await stub.land("wes", s, [a, b, resolved]);
    expect(result.landedShas).toHaveLength(3);
  });

  it("without an observed re-run of VERIFY the resolution records no check at all, and land refuses on INV-4", async () => {
    const stub = stubFor("port4-resolve-nocheck");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("keel", s, "X", [], []);
    await stub.appendRevision("keel", a, [h("shared.ts", "top", "from X")]);
    await stub.recordCheck("keel", a, "integrated", "pass");
    const b = await stub.openChange("keel", s, "Y", [], []);
    await stub.appendRevision("keel", b, [h("shared.ts", "bottom", "from Y")]);
    await stub.recordCheck("keel", b, "integrated", "pass");

    // No `checkOutcome`: nothing re-ran VERIFY over the merged content, so
    // the log says nothing about it rather than claiming a result nobody
    // produced. `land()` then refuses on INV-4.
    const res = await stub.resolveSeam("keel", s, [
      { changeId: a, hunks: [h("shared.ts", "top", "from X")] },
      { changeId: b, hunks: [h("shared.ts", "bottom", "from Y")] },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await expect(async () => { await stub.land("wes", s, [a, b, res.resolvedChangeId]); }).rejects.toThrow();
    expect((await stub.snapshot(s)).lands).toHaveLength(0);
  });

  it("a colliding anchor comes back as an INV-9 STATE, not a throw, and opens no Change", async () => {
    const stub = stubFor("port4-resolve-conflict");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("keel", s, "X", [], []);
    await stub.appendRevision("keel", a, [h("shared.ts", "top", "from X")]);
    const b = await stub.openChange("keel", s, "Y", [], []);
    await stub.appendRevision("keel", b, [h("shared.ts", "top", "from Y")]);

    const before = (await stub.snapshot(s)).changes.length;
    const res = await stub.resolveSeam("keel", s, [
      { changeId: a, hunks: [h("shared.ts", "top", "from X")] },
      { changeId: b, hunks: [h("shared.ts", "top", "from Y")] },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.invariant).toBe("INV-9");
    expect(res.at).toBe("shared.ts:top");
    expect(res.changeId).toBe(b);

    // Nothing was opened: a conflict resolves nothing, so there is nothing
    // to review.
    expect((await stub.snapshot(s)).changes).toHaveLength(before);
  });
});

describe("PORT-4, Track 2 — the clean branch is reachable from a REAL slice run", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  type ComposeResult = {
    ready: boolean;
    fileOverlaps?: readonly { file: string; children: readonly string[] }[];
    seamResolution?:
      | { resolved: true; changeId: string; changeIds: Record<string, string> }
      | { resolved: false; invariant?: "INV-9"; at?: string; changeId?: string; reason?: string };
  };

  function orchFor(name: string) {
    const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
    return ns.get(ns.idFromName(name)) as unknown as {
      admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
      approve(approverId?: string): Promise<{ resumed: boolean; state?: string }>;
      result(): Promise<{ state: string | null } | null>;
      derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
      join(): Promise<{ ready: boolean; children: readonly { servesClause: string | null; writtenFiles: readonly string[] }[] } | { error: string }>;
      compose(): Promise<ComposeResult | { error: string }>;
      configureSeamReplay(doName: string, seriesId: string): Promise<void>;
      projectedChanges(): Promise<Readonly<Record<string, string>>>;
      writtenHunks(): Promise<readonly Hunk[]>;
    };
  }

  async function driveToTerminal(stub: ReturnType<typeof orchFor>, approverId: string) {
    for (let i = 0; i < 200; i++) {
      const r = await stub.result();
      if (r?.state === "ACCEPT" || r?.state === "ESCALATE") return r;
      // The human clears the gate BY NAME -- PORT-4 locked decision 2.
      // This identity is what will sign the Change's approve verdict, so
      // nothing downstream ever has to invent one.
      if (r?.state === "PAUSE") { await stub.approve(approverId); continue; }
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

  it("two slices on disjoint SECTIONS of one file: flagged by the floor, resolved clean by the replay, containing both sections", async () => {
    const root = orchFor("port4-section-clean");
    const core = stubFor("port4-section-clean-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    await root.configureSeamReplay("port4-section-clean-core", seriesId);

    await root.admit(seamRoot("seam-section-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    expect(d.admittedRuns).toHaveLength(2);
    for (const run of d.admittedRuns) {
      const r = await driveToTerminal(orchFor(run.doName), "wes");
      expect(r?.state).toBe("ACCEPT");
    }

    // Each slice really did produce a sub-file HUNK, not a whole-file claim.
    const hunksByRun = await Promise.all(d.admittedRuns.map((r) => orchFor(r.doName).writtenHunks()));
    expect(hunksByRun.flat().map((x) => x.anchor).sort()).toEqual(["bottom", "top"]);

    // The floor still flags it -- one file, two slices. That never changes.
    const c = await root.compose();
    if ("error" in c) throw new Error(c.error);
    expect(c.ready).toBe(false);
    expect(c.fileOverlaps).toEqual([{ file: "shared.ts", children: ["X", "Y"] }]);

    // ...and the replay resolves it, because the hunks genuinely compose.
    expect(c.seamResolution).toBeTruthy();
    expect(c.seamResolution!.resolved).toBe(true);
    if (!c.seamResolution!.resolved) return;
    const resolved = c.seamResolution!.changeId;

    const snap = await core.snapshot(seriesId);
    const rc = snap.changes.find((x) => x.id === resolved)!;
    const head = rc.revisions!.at(-1)!;
    expect(head.reason).toBe("conflict-resolution");
    // The resolved content carries BOTH sections -- the whole point of
    // locked decision 1.
    expect(head.hunks.map((x) => x.content).sort()).toEqual(["from X", "from Y"]);
    // Still unapproved, still unlandable. Resolution is not consent.
    expect(await core.liveVerdicts(resolved)).toEqual([]);
  }, 60000);

  it("two slices on the SAME section of one file: INV-9, named at shared.ts:top, nothing resolved", async () => {
    const root = orchFor("port4-section-collide");
    const core = stubFor("port4-section-collide-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    await root.configureSeamReplay("port4-section-collide-core", seriesId);

    await root.admit(seamRoot("seam-collide-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    for (const run of d.admittedRuns) await driveToTerminal(orchFor(run.doName), "wes");

    const c = await root.compose();
    if ("error" in c) throw new Error(c.error);
    expect(c.ready).toBe(false);
    expect(c.fileOverlaps).toEqual([{ file: "shared.ts", children: ["X", "Y"] }]);
    expect(c.seamResolution?.resolved).toBe(false);
    if (c.seamResolution?.resolved !== false) return;
    expect(c.seamResolution.invariant).toBe("INV-9");
    expect(c.seamResolution.at).toBe("shared.ts:top");

    // Nothing landed, nothing to land.
    expect((await core.snapshot(seriesId)).lands).toHaveLength(0);
  }, 60000);
});

/**
 * PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1) — "the check (VERIFY) re-runs
 * automatically on the merged content."
 *
 * Every test in this block records NO check of its own. What the review log
 * ends up carrying is written by the production path
 * (`Orchestrator.verifyMergedContent` -> `ReviewCore.resolveSeam`) during
 * `compose()`, and is read back here. A test that recorded the outcome
 * itself would be asserting its own literal and would stay green with the
 * wiring deleted.
 *
 * Three outcomes are reachable and all three are proven, here and in
 * `scr-handoff-port4.test.ts`:
 *  - `fail`   — `seam-solo@v1`, below: a merge-sensitive assertion both
 *               slices satisfy alone and their merge genuinely breaks.
 *  - silence  — `seam-files@v1`, below: a suite whose assertions read only
 *               `trace.result`, which `mergedTraceFor` copies verbatim, so
 *               it cannot judge a merge and no check is written.
 *  - `pass`   — the capstone in `scr-handoff-port4.test.ts`, on
 *               `seam-handoff@v1`, whose merge-sensitive assertions read
 *               the merged writes and are genuinely satisfied by them.
 */
describe("PORT-4 — OD-PORT4-1: the merged-content check is observed, never assumed", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  type ComposeResult = {
    ready: boolean;
    fileOverlaps?: readonly { file: string; children: readonly string[] }[];
    seamResolution?:
      | { resolved: true; changeId: string; changeIds: Record<string, string> }
      | { resolved: false; invariant?: "INV-9"; at?: string; changeId?: string; reason?: string };
  };

  function orchFor(name: string) {
    const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
    return ns.get(ns.idFromName(name)) as unknown as {
      admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
      approve(approverId?: string): Promise<{ resumed: boolean; state?: string }>;
      result(): Promise<{ state: string | null } | null>;
      derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
      compose(): Promise<ComposeResult | { error: string }>;
      configureSeamReplay(doName: string, seriesId: string): Promise<void>;
      projectedChanges(): Promise<Readonly<Record<string, string>>>;
    };
  }

  async function driveToTerminal(stub: ReturnType<typeof orchFor>, approverId: string) {
    for (let i = 0; i < 200; i++) {
      const r = await stub.result();
      if (r?.state === "ACCEPT" || r?.state === "ESCALATE") return r;
      if (r?.state === "PAUSE") { await stub.approve(approverId); continue; }
      await sleep(30);
    }
    return stub.result();
  }

  const root = (intent: string, oracleRef: string) => ({
    intent, capabilityCeiling: "connectors-only" as const,
    acceptance: [
      { id: "X", statement: "X marker", kind: "example" as const },
      { id: "Y", statement: "Y marker", kind: "example" as const },
    ],
    connectors: ["state"], approvalGated: ["state"], attemptBudget: 1, oracleRef,
    forbids: [], decomposable: true,
  });

  it("a suite that never reads what was WRITTEN cannot judge the merge: no check is recorded, and not even a human verdict lands it", async () => {
    const orch = orchFor("port4-mergecheck-blind");
    const core = stubFor("port4-mergecheck-blind-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    await orch.configureSeamReplay("port4-mergecheck-blind-core", seriesId);

    // `seam-files@v1`'s clauses assert `trace.result.ok === true` and
    // nothing else. `mergedTraceFor` copies `trace.result` verbatim from
    // the slice's own recorded run (it must — no merge re-executes
    // anything), so re-running those assertions over the merged content is
    // a REAL oracle run that answers a question about the SLICE. The suite
    // declares no `mergeSensitive` assertion, which is the honest reading
    // of that: it has no way to judge a merge.
    await orch.admit(root("seam-section-test", "seam-files@v1"));
    const d = await orch.derive();
    if ("error" in d) throw new Error(d.error);
    for (const run of d.admittedRuns) await driveToTerminal(orchFor(run.doName), "wes");

    const c = await orch.compose();
    if ("error" in c) throw new Error(c.error);
    // The merge itself is clean and the resolution really is opened --
    // this is about the CHECK, not about the merge failing.
    expect(c.seamResolution?.resolved).toBe(true);
    if (c.seamResolution?.resolved !== true) return;
    const resolved = c.seamResolution.changeId;

    // The whole point: SILENCE. `verifyMergedContent` returned `undefined`,
    // so `resolveSeam` recorded no check at all rather than laundering the
    // slices' own `pass` into a claim about content nobody checked.
    expect(await core.liveCheck(resolved, "integrated")).toBeNull();

    // Each slice's OWN check is untouched and still a real per-slice
    // VERIFY verdict -- the refusal is scoped to the merge, not contagious.
    const ids = await orch.projectedChanges();
    expect(await core.liveCheck(ids["X"]!, "integrated")).toMatchObject({ outcome: "pass" });
    expect(await core.liveCheck(ids["Y"]!, "integrated")).toMatchObject({ outcome: "pass" });

    // Refused first for want of a fresh human verdict on merged content
    // (INV-3)...
    await expect(async () => { await core.land("wes", seriesId, [ids["X"]!, ids["Y"]!, resolved]); })
      .rejects.toThrow(/INV-3/);

    // ...and STILL refused once a human really does approve it, because
    // approval is consent and INV-4 wants a CHECK. Fail-closed all the way
    // down: unverifiable content does not ship on a signature alone.
    await core.recordVerdict("wes", resolved, "approve");
    await expect(async () => { await core.land("wes", seriesId, [ids["X"]!, ids["Y"]!, resolved]); })
      .rejects.toThrow(/INV-4/);
    expect((await core.snapshot(seriesId)).lands).toHaveLength(0);
  }, 60000);

  it("the merged content genuinely FAILS a check both slices passed alone, and nothing lands", async () => {
    const orch = orchFor("port4-mergecheck-fail");
    const core = stubFor("port4-mergecheck-fail-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    await orch.configureSeamReplay("port4-mergecheck-fail-core", seriesId);

    // `seam-solo@v1` demands that a trace carry exactly ONE write to
    // `shared.ts`. Each slice satisfies that; their merge cannot.
    await orch.admit(root("seam-solo-test", "seam-solo@v1"));
    const d = await orch.derive();
    if ("error" in d) throw new Error(d.error);
    for (const run of d.admittedRuns) {
      // Each slice's OWN VERIFY passed -- that is what makes this a real
      // test of the re-run and not just a test of a failing suite.
      expect((await driveToTerminal(orchFor(run.doName), "wes"))?.state).toBe("ACCEPT");
    }

    const c = await orch.compose();
    if ("error" in c) throw new Error(c.error);
    // The hunks are on DISJOINT anchors, so the merge itself is clean --
    // this is not INV-9 wearing a different hat.
    expect(c.seamResolution?.resolved).toBe(true);
    if (c.seamResolution?.resolved !== true) return;
    const resolved = c.seamResolution.changeId;

    const ids = await orch.projectedChanges();
    // Each slice's own Change carries the `pass` its own VERIFY produced...
    expect(await core.liveCheck(ids["X"]!, "integrated")).toMatchObject({ outcome: "pass" });
    expect(await core.liveCheck(ids["Y"]!, "integrated")).toMatchObject({ outcome: "pass" });
    // ...and the merge of them carries a `fail` nobody asked for and
    // nobody could have predicted from either slice alone.
    expect(await core.liveCheck(resolved, "integrated")).toMatchObject({ outcome: "fail" });

    // Even fully approved by a human, it will not land: a recorded failing
    // check is a refusal (INV-4), not advice.
    await core.recordVerdict("wes", resolved, "approve");
    await expect(async () => { await core.land("wes", seriesId, [ids["X"]!, ids["Y"]!, resolved]); })
      .rejects.toThrow(/INV-4/);
    expect((await core.snapshot(seriesId)).lands).toHaveLength(0);
  }, 60000);

  it("previewSeam produces the merge without touching the log, and agrees with resolveSeam", async () => {
    const stub = stubFor("port4-preview-seam");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("keel", s, "X", [], []);
    await stub.appendRevision("keel", a, [h("shared.ts", "top", "from X")]);
    const b = await stub.openChange("keel", s, "Y", [], []);
    await stub.appendRevision("keel", b, [h("shared.ts", "bottom", "from Y")]);
    const ordered = [
      { changeId: a, hunks: [h("shared.ts", "top", "from X")] },
      { changeId: b, hunks: [h("shared.ts", "bottom", "from Y")] },
    ];

    const before = (await stub.snapshot(s)).changes.length;
    const preview = await stub.previewSeam(s, ordered);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // The content an oracle would be shown, before any of it is committed
    // to an append-only log.
    expect(preview.resolved).toEqual([h("shared.ts", "top", "from X"), h("shared.ts", "bottom", "from Y")]);
    // A preview is a read: no Change opened, nothing to roll back.
    expect((await stub.snapshot(s)).changes).toHaveLength(before);

    // And what `resolveSeam` then commits is exactly what was previewed --
    // same rebaser, same pure `replaySeam`, so the two provably cannot
    // disagree about what the oracle was judging.
    const res = await stub.resolveSeam("keel", s, ordered);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const head = (await stub.snapshot(s)).changes.find((x) => x.id === res.resolvedChangeId)!.revisions!.at(-1)!;
    expect(head.hunks).toEqual(preview.resolved);
  });

  it("previewSeam reports a colliding anchor as the same INV-9 STATE resolveSeam would, and opens nothing", async () => {
    const stub = stubFor("port4-preview-conflict");
    const s = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const a = await stub.openChange("keel", s, "X", [], []);
    await stub.appendRevision("keel", a, [h("shared.ts", "top", "from X")]);
    const b = await stub.openChange("keel", s, "Y", [], []);
    await stub.appendRevision("keel", b, [h("shared.ts", "top", "from Y")]);

    const before = (await stub.snapshot(s)).changes.length;
    const preview = await stub.previewSeam(s, [
      { changeId: a, hunks: [h("shared.ts", "top", "from X")] },
      { changeId: b, hunks: [h("shared.ts", "top", "from Y")] },
    ]);
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.invariant).toBe("INV-9");
    expect(preview.at).toBe("shared.ts:top");
    expect(preview.changeId).toBe(b);
    expect((await stub.snapshot(s)).changes).toHaveLength(before);
  });
});
