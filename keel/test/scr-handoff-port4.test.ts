/**
 * PLAYBOOK-KEEL-SCR-PORT-4, Track 3 — the handoff, and the whole-boundary
 * proof.
 *
 * C2 already hands a downstream slice a REFERENCE to its upstream
 * (`consumesResults`: a runId and a doName). That is enough to find the
 * upstream; it is not enough to know what was actually reviewed and
 * shipped. Track 3 grounds that edge on `provenanceOf` — the answer read
 * off the sealed `LandAuthorised` event, never off git.
 *
 * The failure mode this exists to prevent, stated once so it stays
 * findable: if a downstream builds on the wrong upstream, the
 * `consumesResults` edge resolved past `provenanceOf` to raw git.
 *
 * The capstone test at the bottom runs the entire slice->Change boundary
 * in one go: a real dependency edge, a real file overlap, one graph,
 * checks, seam resolution, a fresh human verdict, provenance grounding,
 * and a land of the whole downward-closed set.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { Hunk } from "../src/scr/events";
import type { LandResult } from "../src/composition/review-core";
import type { SpecificationContent } from "../src/domain/lineage/nodes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Provenance = NonNullable<NonNullable<SpecificationContent["consumesResults"]>[string]["provenance"]>;

type DebugFanout = {
  children: readonly {
    runId: string; doName: string; servesClause: string | null; reportedState: string | null; held: boolean;
  }[];
  lastCompose: { payload: unknown; at: number } | null;
};

type ComposeResult = {
  ready: boolean;
  fileOverlaps?: readonly { file: string; children: readonly string[] }[];
  seamResolution?:
    | { resolved: true; changeId: string; changeIds: Record<string, string> }
    | { resolved: false; invariant?: "INV-9"; at?: string; changeId?: string; reason?: string };
};

function coreFor(name: string) {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  return ns.get(ns.idFromName(name)) as unknown as {
    openSeries(actorId: string, targetRef: string, targetSha: string): Promise<string>;
    openChange(actorId: string, seriesId: string, title: string, requiredReviewers?: string[], parents?: string[]): Promise<string>;
    appendRevision(actorId: string, changeId: string, hunks: Hunk[], reason?: string): Promise<number>;
    recordVerdict(reviewerId: string, changeId: string, decision: "approve" | "reject"): Promise<string>;
    recordCheck(actorId: string, changeId: string, kind: "isolated" | "integrated", outcome: "pass" | "fail"): Promise<string>;
    liveCheck(changeId: string, kind: "isolated" | "integrated"): Promise<{ checkId: string; outcome: "pass" | "fail"; revisionSeq: number } | null>;
    land(actorId: string, seriesId: string, changeIds: string[]): Promise<LandResult>;
    landedShaOf(changeId: string): Promise<string | null>;
    provenanceOf(sha: string): Promise<Provenance | null>;
    liveVerdicts(changeId: string): Promise<readonly { verdictId: string; reviewerId: string }[]>;
    snapshot(seriesId: string): Promise<{
      changes: { id: string; parents?: string[]; revisions?: { seq: number; reason: string; hunks: Hunk[] }[] }[];
      openOrder: string[];
      lands: { landEventId: string; changeIds: string[]; landedShas: string[] }[];
    }>;
  };
}

function orchFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    approve(approverId?: string): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null } | null>;
    derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
    join(): Promise<{ ready: boolean; children: readonly { servesClause: string | null; doName: string; writtenFiles: readonly string[] }[] } | { error: string }>;
    compose(): Promise<ComposeResult | { error: string }>;
    configureSeamReplay(doName: string, seriesId: string, projected?: Record<string, string>): Promise<void>;
    projectedChanges(): Promise<Readonly<Record<string, string>>>;
    writtenHunks(): Promise<readonly Hunk[]>;
    debugFanout(): Promise<DebugFanout>;
    dumpNodes(): Promise<readonly { kind: string; content: unknown }[]>;
    childCompleted(runId: string, terminalState: "ACCEPT" | "ESCALATE"): Promise<void>;
  };
}

/**
 * DISCLOSED FINDING, pre-existing and NOT introduced by PORT-4 (nothing
 * here changes it; it is surfaced rather than silently patched, because
 * changing C2's release semantics is not this playbook's call).
 *
 * `admit()`'s completion-push fires only from the run fiber, and only on
 * ACCEPT/ESCALATE. Its own comment says a PAUSE "will [report], on its
 * own eventual ACCEPT/ESCALATE after approval" — but `approve()` takes
 * the resume path, and that path never pushes. So an APPROVAL-GATED
 * derived child reaches ACCEPT without ever waking its parent, and a
 * downstream held on it would wait for the reaper rather than release
 * on the completion it is entitled to.
 *
 * Every existing C2 test uses ungated children, so nothing caught it.
 * PORT-4's fixtures are gated (they must be — an approval gate is where
 * the approver IDENTITY comes from, and without a real identity the
 * slice->Change bridge fails closed rather than forging a verdict), which
 * is what surfaced it.
 *
 * The tests below therefore make the push the child would have made,
 * explicitly, through the same public RPC the child itself calls. That is
 * the ONE thing standing in for the gap; everything downstream of it —
 * release, `consumesResults` grounding, projection, seam replay, land —
 * is the real, unmodified code path.
 */
async function pushCompletionAsChildWould(root: ReturnType<typeof orchFor>, runId: string) {
  await root.childCompleted(runId, "ACCEPT");
}

async function pollUntil(stub: ReturnType<typeof orchFor>, pred: (f: DebugFanout) => boolean): Promise<DebugFanout> {
  for (let i = 0; i < 200; i++) {
    const fanout = await stub.debugFanout();
    if (pred(fanout)) return fanout;
    await sleep(50);
  }
  throw new Error("timed out waiting for the expected fan-out state");
}

/** Clear every approval gate BY NAME -- PORT-4 locked decision 2. The
 *  identity supplied here is the one that will sign this slice's Change
 *  verdict, so nothing downstream ever has to invent one. */
async function driveToTerminal(stub: ReturnType<typeof orchFor>, approverId: string) {
  for (let i = 0; i < 200; i++) {
    const r = await stub.result();
    if (r?.state === "ACCEPT" || r?.state === "ESCALATE") return r;
    if (r?.state === "PAUSE") { await stub.approve(approverId); continue; }
    await sleep(30);
  }
  return stub.result();
}

const handoffSeamRoot = (intent: string) => ({
  intent, capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "UP", statement: "UP marker", kind: "example" as const },
    { id: "DOWN", statement: "DOWN marker", kind: "example" as const, dependsOn: ["UP"] },
  ],
  connectors: ["state"], approvalGated: ["state"], attemptBudget: 1, oracleRef: "seam-handoff@v1",
  forbids: [], decomposable: true,
});

describe("PORT-4, Track 3 — consumesResults grounds on provenanceOf, never on a git ref", () => {
  it("a downstream released after its upstream's Change landed carries that Change's provenance and landEventId", async () => {
    const core = coreFor("port4-grounding-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");

    // The upstream slice's Change, projected and LANDED by an earlier pass
    // -- which is exactly the situation in which there is any provenance
    // to ground on at all. (In the ordinary C2 flow a downstream releases
    // the instant its upstream reaches ACCEPT, long before anything lands,
    // and the edge then carries today's plain reference -- proven by the
    // existing handoff-pipeline suite staying green.)
    //
    // DISCLOSED: the verdict and check below are FIXTURE, hand-written
    // straight onto the review log to stand in for a pass that happened
    // before this test began. No oracle ran and none is claimed to have.
    // What is under test here is `provenanceOf` — what a landed Change
    // tells a downstream — not how its check got recorded.
    const upChange = await core.openChange("keel", seriesId, "UP", ["wes"], []);
    await core.appendRevision("keel", upChange, [{ path: "shared.ts", anchor: "top", content: "from UP" }]);
    await core.recordVerdict("wes", upChange, "approve");
    await core.recordCheck("keel", upChange, "integrated", "pass");
    const landed = await core.land("wes", seriesId, [upChange]);
    expect(landed.landedShas).toHaveLength(1);

    const root = orchFor("port4-grounding-root");
    await root.configureSeamReplay("port4-grounding-core", seriesId, { UP: upChange });

    await root.admit(handoffSeamRoot("seam-handoff-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    // Only UP admits at fan-out; DOWN is held on its declared dependency.
    expect(d.admittedRuns.map((r) => r.servesClause)).toEqual(["UP"]);

    await driveToTerminal(orchFor(d.admittedRuns[0]!.doName), "wes");
    await pushCompletionAsChildWould(root, d.admittedRuns[0]!.runId);
    const released = await pollUntil(root, (f) => f.children.find((c) => c.servesClause === "DOWN")?.held === false);
    const down = released.children.find((c) => c.servesClause === "DOWN")!;

    // DOWN's own admitted Specification carries the grounded edge.
    const nodes = await orchFor(down.doName).dumpNodes();
    const spec = nodes.find((n) => n.kind === "Specification")!.content as SpecificationContent;
    const edge = spec.consumesResults!["UP"]!;

    // The pre-PORT-4 reference is untouched and still present.
    expect(edge.runId).toBeTruthy();
    expect(edge.doName).toBe(d.admittedRuns[0]!.doName);

    // And the grounding: which Change, and the exact LandAuthorised that
    // shipped it.
    expect(edge.landedSha).toBe(landed.landedShas[0]);
    expect(edge.provenance?.changeId).toBe(upChange);
    expect(edge.provenance?.landEventId).toBe(landed.landEventId);
    // Who actually reviewed it -- a question no git ref can answer.
    expect(edge.provenance?.reviewers.map((r) => r.reviewerId)).toEqual(["wes"]);
    // The revision HASH is what a downstream grounds on. Not a branch, not
    // a tip sha read back from a repository.
    expect(edge.provenance?.revisionHash).toBeTruthy();
    expect(edge.provenance?.revisionSeq).toBe(1);
  }, 60000);

  it("an upstream whose Change has NOT landed keeps exactly C2's own reference shape — additive, never a regression", async () => {
    const core = coreFor("port4-ungrounded-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    const upChange = await core.openChange("keel", seriesId, "UP", [], []);
    await core.appendRevision("keel", upChange, [{ path: "shared.ts", anchor: "top", content: "from UP" }]);
    // Deliberately NOT landed.

    const root = orchFor("port4-ungrounded-root");
    await root.configureSeamReplay("port4-ungrounded-core", seriesId, { UP: upChange });
    await root.admit(handoffSeamRoot("seam-handoff-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    await driveToTerminal(orchFor(d.admittedRuns[0]!.doName), "wes");
    await pushCompletionAsChildWould(root, d.admittedRuns[0]!.runId);
    const released = await pollUntil(root, (f) => f.children.find((c) => c.servesClause === "DOWN")?.held === false);
    const down = released.children.find((c) => c.servesClause === "DOWN")!;

    const nodes = await orchFor(down.doName).dumpNodes();
    const spec = nodes.find((n) => n.kind === "Specification")!.content as SpecificationContent;
    const edge = spec.consumesResults!["UP"]!;
    expect(edge.runId).toBeTruthy();
    expect(edge.doName).toBeTruthy();
    expect(edge.landedSha).toBeUndefined();
    expect(edge.provenance).toBeUndefined();
  }, 60000);
});

describe("PORT-4, Track 3 — the whole slice->Change boundary, end to end", () => {
  it("a dependency edge AND a file overlap: one graph, checks, seam resolved, re-reviewed, whole set lands", async () => {
    const root = orchFor("port4-capstone-root");
    const core = coreFor("port4-capstone-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    await root.configureSeamReplay("port4-capstone-core", seriesId);

    await root.admit(handoffSeamRoot("seam-handoff-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);

    // UP runs; DOWN is held on its declared dependency and released by
    // UP's own completion push -- C2's spine, untouched.
    await driveToTerminal(orchFor(d.admittedRuns[0]!.doName), "wes");
    await pushCompletionAsChildWould(root, d.admittedRuns[0]!.runId);
    const released = await pollUntil(root, (f) => f.children.find((c) => c.servesClause === "DOWN")?.held === false);
    await driveToTerminal(orchFor(released.children.find((c) => c.servesClause === "DOWN")!.doName), "wes");

    const j = await root.join();
    if ("error" in j) throw new Error(j.error);
    expect(j.ready).toBe(true);

    // Both slices wrote `shared.ts` -- a real overlap, on disjoint anchors.
    const c = await root.compose();
    if ("error" in c) throw new Error(c.error);
    expect(c.ready).toBe(false);
    expect(c.fileOverlaps).toEqual([{ file: "shared.ts", children: ["DOWN", "UP"] }]);
    expect(c.seamResolution?.resolved).toBe(true);
    if (c.seamResolution?.resolved !== true) return;
    const resolved = c.seamResolution.changeId;

    const changeIds = await root.projectedChanges();
    const up = changeIds["UP"]!;
    const down = changeIds["DOWN"]!;
    expect(up).toBeTruthy();
    expect(down).toBeTruthy();

    const snap = await core.snapshot(seriesId);
    // ONE GRAPH: C2's `DOWN dependsOn UP` became SCR's `parents`, and
    // `Model.openOrder` -- the single source of truth -- puts UP before
    // DOWN, with the seam resolution (a merge point over both) last.
    expect(snap.changes.find((x) => x.id === down)?.parents).toEqual([up]);
    expect(snap.changes.find((x) => x.id === resolved)?.parents).toEqual([up, down]);
    expect(snap.openOrder).toEqual([up, down, resolved]);

    // The resolution really is a conflict-resolution revision carrying
    // BOTH slices' sections...
    const head = snap.changes.find((x) => x.id === resolved)!.revisions!.at(-1)!;
    expect(head.reason).toBe("conflict-resolution");
    expect(head.hunks.map((x) => x.content).sort()).toEqual(["from DOWN", "from UP"]);
    // ...and INV-14 held: it inherited nothing, even though both parents
    // carry their own live approvals from the same human.
    expect(await core.liveVerdicts(resolved)).toEqual([]);
    expect(await core.liveVerdicts(up)).toHaveLength(1);

    // OD-PORT4-1's check half, and the reason this test records NO check
    // of its own: every check below was written by the production path
    // during `compose()`, before this test looked. Each slice's check came
    // from its own VERIFY verdict (`projectSlicesAsChanges` maps
    // `JoinChildReport.outcome`); the resolution's came from
    // `Orchestrator.verifyMergedContent` re-running those same suite
    // assertions, in the same oracle sandbox, over the merged content
    // `previewSeam` produced. Asserting they are here is the only honest
    // way to check this: a test that recorded them itself would be
    // asserting its own literal, and would stay green if the wiring were
    // deleted outright.
    //
    // And the resolution's `pass` is a pass about the MERGE, not a
    // per-slice pass wearing the merge's name. `seam-handoff@v1`'s clauses
    // declare `mergeSensitive` and earn it: each reads the recorded
    // `writeSection` calls -- the one part of the trace `mergedTraceFor`
    // restates -- and demands its own section survived into the merged
    // content alongside a sibling's, on a distinct anchor, with real
    // content. Strip that flag and `verifyMergedContent` records nothing
    // and this land fails on INV-4; blind the assertions back to
    // `trace.result` and the same thing happens. The check this set lands
    // on is one the merged content actually passed.
    for (const changeId of [up, down, resolved]) {
      const chk = await core.liveCheck(changeId, "integrated");
      expect(chk?.outcome).toBe("pass");
    }

    // The verdict half is the human's, and stays the human's: the
    // resolution is unapproved by construction (INV-14, asserted above),
    // so this really is a fresh re-review of merged content.
    await core.recordVerdict("wes", resolved, "approve");

    // Land the whole downward-closed set: one commit per Change (OD-5).
    const landed = await core.land("wes", seriesId, [up, down, resolved]);
    expect(landed.landedShas).toHaveLength(3);

    // ...and provenance resolves for every one of them, off the sealed
    // land event, never off git.
    for (const [i, changeId] of [up, down, resolved].entries()) {
      const prov = await core.provenanceOf(landed.landedShas[i]!);
      expect(prov?.changeId).toBe(changeId);
      expect(prov?.reviewers.map((r) => r.reviewerId)).toEqual(["wes"]);
    }
  }, 90000);

  it("the negative twin: a colliding anchor is INV-9, and nothing lands", async () => {
    const root = orchFor("port4-capstone-collide-root");
    const core = coreFor("port4-capstone-collide-core");
    const seriesId = await core.openSeries("wes", "refs/heads/main", "sha0");
    await root.configureSeamReplay("port4-capstone-collide-core", seriesId);

    await root.admit(handoffSeamRoot("seam-handoff-collide-test"));
    const d = await root.derive();
    if ("error" in d) throw new Error(d.error);
    await driveToTerminal(orchFor(d.admittedRuns[0]!.doName), "wes");
    await pushCompletionAsChildWould(root, d.admittedRuns[0]!.runId);
    const released = await pollUntil(root, (f) => f.children.find((c) => c.servesClause === "DOWN")?.held === false);
    await driveToTerminal(orchFor(released.children.find((c) => c.servesClause === "DOWN")!.doName), "wes");

    const c = await root.compose();
    if ("error" in c) throw new Error(c.error);
    expect(c.ready).toBe(false);
    expect(c.fileOverlaps).toEqual([{ file: "shared.ts", children: ["DOWN", "UP"] }]);
    expect(c.seamResolution?.resolved).toBe(false);
    if (c.seamResolution?.resolved !== false) return;
    expect(c.seamResolution.invariant).toBe("INV-9");
    expect(c.seamResolution.at).toBe("shared.ts:top");

    // No resolution Change was opened, and nothing landed. A conflict
    // resolves nothing, so there is nothing to review and nothing to ship.
    const snap = await core.snapshot(seriesId);
    expect(snap.lands).toHaveLength(0);
    expect(snap.changes.every((x) => !x.revisions?.some((r) => r.reason === "conflict-resolution"))).toBe(true);
  }, 90000);
});
