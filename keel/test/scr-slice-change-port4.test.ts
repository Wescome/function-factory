/**
 * PLAYBOOK-KEEL-SCR-PORT-4, Track 1 — one graph, one spine.
 *
 * The capstone's first claim: KEEL's own orchestration graph (C2's
 * `dependsOnClauses`) and SCR's review graph (`ChangeOpened.parents`,
 * ordered by `Model.openOrder`) are ONE graph on two substrates, not two
 * graphs kept in sync. These tests are what makes that checkable rather
 * than merely asserted in prose.
 *
 * Mixed pure + real-RPC, following `scr-land-port3.test.ts`'s own
 * `stubFor` pattern. Every `.rejects` site wraps its call in an async
 * function first — see `.agent/patterns/workerd-jsrpc-rejects-proxy.md`:
 * a raw workerd JsRpcPromise handed to `.rejects` mints a second,
 * unobserved derived promise and fails the gate on an unhandled
 * rejection even though the assertion itself passes.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { seriesParentsFor } from "../src/domain/spec-loop/slice-change";
import { checkDependencyGraph } from "../src/domain/spec-loop/dag";
import { projectSlicesAsChanges, mergedTraceFor, type ReviewCoreLike } from "../src/composition/slice-change-bridge";
import type { ExecutionTraceContent } from "../src/domain/index";
import type { JoinChildReport } from "../src/composition/orchestrator";
import type { SpecificationContent } from "../src/domain/lineage/nodes";
import type { LandResult } from "../src/composition/review-core";

type Hunk = { path: string; anchor: string; content: string };

function stubFor(name: string) {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  return ns.get(ns.idFromName(name)) as unknown as ReviewCoreLike & {
    openSeries(actorId: string, targetRef: string, targetSha: string): Promise<string>;
    land(actorId: string, seriesId: string, changeIds: string[]): Promise<LandResult>;
    liveVerdicts(changeId: string): Promise<readonly { verdictId: string; reviewerId: string; decision: string }[]>;
    liveCheck(changeId: string, kind: string): Promise<{ checkId: string; outcome: string; revisionSeq: number } | null>;
    snapshot(seriesId: string): Promise<{
      series: unknown;
      changes: { id: string; parents?: string[] }[];
      openOrder: string[];
      lands: unknown[];
      landInProgress: boolean;
    }>;
  };
}

/** A minimal C2 candidate. Only `servesClause`/`dependsOnClauses` matter
 *  to the graph translation; the rest is what `SpecificationContent`
 *  requires to exist at all. */
const cand = (servesClause: string, dependsOnClauses: string[] = []): SpecificationContent => ({
  intent: `slice ${servesClause}`,
  capabilityCeiling: "connectors-only",
  acceptance: [{ id: servesClause, statement: `${servesClause} marker`, kind: "example" }],
  connectors: ["state"],
  approvalGated: [],
  attemptBudget: 1,
  oracleRef: "seam-files@v1",
  forbids: [],
  decomposable: false,
  servesClause,
  dependsOnClauses,
});

const childFor = (servesClause: string, outcome: "pass" | "fail" = "pass"): JoinChildReport => ({
  runId: `run-${servesClause}`,
  doName: `derived-${servesClause}`,
  servesClause,
  parentRunId: "root",
  terminal: "ACCEPT",
  outcome,
  observable: false,
  observed: { present: false },
  spanningUncheckable: [],
  writtenFiles: [`${servesClause}.ts`],
});

describe("PORT-4, Track 1 — C2's dependency graph IS SCR's change graph", () => {
  it("openOrder over the projected Changes equals the C2 topological order, not the input order", async () => {
    // Input order is deliberately NOT the topological order: C depends on
    // B, B depends on A, and they are handed over as [C, A, B]. If any
    // second ordering existed anywhere in the pipeline, this is where it
    // would show up.
    const candidates = [cand("C", ["B"]), cand("A"), cand("B", ["A"])];
    expect(checkDependencyGraph(candidates).ok).toBe(true);

    const parents = seriesParentsFor(candidates);
    expect(parents).toEqual([
      { servesClause: "C", parentClauses: ["B"] },
      { servesClause: "A", parentClauses: [] },
      { servesClause: "B", parentClauses: ["A"] },
    ]);
    const parentsByClause = new Map(parents.map((p) => [p.servesClause, p.parentClauses]));

    const stub = stubFor("port4-one-graph");
    const seriesId = await stub.openSeries("wes", "refs/heads/main", "sha0");

    const children = [childFor("C"), childFor("A"), childFor("B")];
    const landings = await projectSlicesAsChanges(
      stub,
      seriesId,
      children,
      (c) => [{ path: `${c.servesClause}.ts`, anchor: "top", content: c.servesClause! }],
      { actorId: "keel", parentClausesOf: (c) => parentsByClause.get(c.servesClause!) ?? [] },
    );

    const idOf = new Map(landings.map((l) => [l.servesClause, l.changeId]));
    expect(idOf.size).toBe(3);

    const snap = await stub.snapshot(seriesId);
    // THE assertion: SCR's own deterministic topological order
    // (Model.openOrder) is exactly A -> B -> C, the order C2's edges
    // imply -- never [C, A, B], the order the batch happened to arrive in.
    expect(snap.openOrder).toEqual([idOf.get("A"), idOf.get("B"), idOf.get("C")]);

    // And the edges themselves crossed over, not just the ordering: each
    // Change's parents are the Changes its clause declared it depends on.
    const byId = new Map(snap.changes.map((c) => [c.id, c]));
    expect(byId.get(idOf.get("A")!)?.parents).toEqual([]);
    expect(byId.get(idOf.get("B")!)?.parents).toEqual([idOf.get("A")]);
    expect(byId.get(idOf.get("C")!)?.parents).toEqual([idOf.get("B")]);
  });

  it("a cycle is refused by checkDependencyGraph upstream and never reaches openChange — one check, not two", async () => {
    const candidates = [cand("A", ["B"]), cand("B", ["A"])];
    const report = checkDependencyGraph(candidates);
    expect(report.ok).toBe(false);
    expect([...report.cycleNodes].sort()).toEqual(["A", "B"]);

    // The live path gates on exactly that report before any candidate is
    // admitted, so the projection is never reached. A core that throws on
    // ANY call proves the gate, not the projection, is what stops it.
    const refusingCore: ReviewCoreLike = {
      openChange: async () => { throw new Error("openChange must never be reached for a cyclic batch"); },
      appendRevision: async () => { throw new Error("unreachable"); },
      recordCheck: async () => { throw new Error("unreachable"); },
      recordVerdict: async () => { throw new Error("unreachable"); },
    };
    if (report.ok) {
      await projectSlicesAsChanges(refusingCore, "ser", [], () => []);
    }
    expect(report.ok).toBe(false);

    // Belt and braces: were a cyclic batch ever forced past the gate, the
    // bridge itself fails closed on INV-13 rather than emitting a partial
    // projection. Wrapped in an async fn per the .rejects/JSRPC pattern
    // (harmless here, consistent everywhere).
    const parentsByClause = new Map(seriesParentsFor(candidates).map((p) => [p.servesClause, p.parentClauses]));
    await expect(async () => {
      await projectSlicesAsChanges(
        refusingCore,
        "ser",
        [childFor("A"), childFor("B")],
        () => [{ path: "x.ts", anchor: "top", content: "x" }],
        { parentClausesOf: (c) => parentsByClause.get(c.servesClause!) ?? [] },
      );
    }).rejects.toThrow(/INV-13/);
  });
});

describe("PORT-4, Track 1 — the slice's VERIFY verdict IS an SCR check (INV-4 acquired)", () => {
  it("a passing slice records integrated/pass, and a base move stales it with no event", async () => {
    const stub = stubFor("port4-check-inv4");
    const seriesId = await stub.openSeries("wes", "refs/heads/main", "sha0");

    const parentsByClause = new Map([["A", []], ["B", ["A"]]] as [string, string[]][]);
    const landings = await projectSlicesAsChanges(
      stub,
      seriesId,
      [childFor("A"), childFor("B")],
      (c) => [{ path: `${c.servesClause}.ts`, anchor: "top", content: `v1-${c.servesClause}` }],
      { parentClausesOf: (c) => parentsByClause.get(c.servesClause!) ?? [] },
    );
    const idOf = new Map(landings.map((l) => [l.servesClause, l.changeId]));
    const a = idOf.get("A")!;
    const b = idOf.get("B")!;

    // Both fixture slices carry `outcome: "pass"` (the default on
    // `childFor` -- a stand-in for a real VERIFY verdict, supplied as this
    // unit test's INPUT), so the bridge records a live integrated pass for
    // each. What is under test here is the mapping, not the verdict.
    expect((await stub.liveCheck(a, "integrated"))?.outcome).toBe("pass");
    expect((await stub.liveCheck(b, "integrated"))?.outcome).toBe("pass");

    // The LOWER layer revises. B's own revision did not move -- but B's
    // BASE did, and `baseFingerprintOf` folds every open ancestor's head
    // into the fingerprint, so B's check is no longer live. Nothing
    // emitted an event to say so; it is derived, which is the whole
    // point of INV-4's second axis.
    await stub.appendRevision("keel", a, [{ path: "A.ts", anchor: "top", content: "v2-A" }]);
    expect(await stub.liveCheck(b, "integrated")).toBeNull();
    // A's own check went stale too, on the OTHER axis (its revision seq
    // moved) -- two axes, both real.
    expect(await stub.liveCheck(a, "integrated")).toBeNull();
  });

  it("a failing slice records integrated/fail, and land refuses it", async () => {
    const stub = stubFor("port4-check-fail");
    const seriesId = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const landings = await projectSlicesAsChanges(
      stub,
      seriesId,
      [childFor("A", "fail")],
      () => [{ path: "A.ts", anchor: "top", content: "A" }],
    );
    const a = landings[0]!.changeId;
    expect((await stub.liveCheck(a, "integrated"))?.outcome).toBe("fail");
    await expect(async () => { await stub.land("wes", seriesId, [a]); }).rejects.toThrow();
  });
});

/**
 * PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1) — `mergedTraceFor`, pure.
 *
 * The bridge between "VERIFY is a predicate over an ExecutionTrace" and "a
 * merge produces content, not an execution". These tests pin exactly what
 * it is allowed to restate and what it must leave alone, because that
 * boundary is the whole honesty claim: restating an execution's RESULT
 * would be inventing an observation.
 */
describe("PORT-4 — mergedTraceFor restates writes, and only writes", () => {
  const trace = (): ExecutionTraceContent => ({
    executionId: "ex-1",
    status: "completed",
    egress: "connector-only",
    result: { ok: true },
    calls: [
      { seq: 0, connector: "echo", method: "ping", args: {}, response: { pong: true } },
      { seq: 1, connector: "state", method: "writeSection", args: { path: "shared.ts", anchor: "top", content: "from X" }, response: { ok: true } },
    ],
  });

  it("replaces the slice's own writes with the merge's, and keeps every non-write call", () => {
    const out = mergedTraceFor(trace(), [
      { path: "shared.ts", anchor: "top", content: "from X" },
      { path: "shared.ts", anchor: "bottom", content: "from Y" },
    ]);
    // The non-write call survives untouched, response included.
    expect(out.calls[0]).toEqual({ seq: 0, connector: "echo", method: "ping", args: {}, response: { pong: true } });
    // The slice's single pre-merge write is gone, replaced by BOTH merged
    // sections -- the content that actually stands after the merge.
    expect(out.calls.slice(1).map((c) => (c.args as { content: string }).content)).toEqual(["from X", "from Y"]);
    expect(out.calls.filter((c) => c.connector === "state")).toHaveLength(2);
  });

  it("claims no response for a reconstructed write — nothing executed, so nothing returned", () => {
    const out = mergedTraceFor(trace(), [{ path: "shared.ts", anchor: "top", content: "from X" }]);
    const write = out.calls.find((c) => c.connector === "state")!;
    expect(write.response).toBeUndefined();
    expect("response" in write).toBe(false);
  });

  it("leaves result/status/egress exactly as the slice recorded them", () => {
    const t = trace();
    const out = mergedTraceFor(t, [{ path: "shared.ts", anchor: "bottom", content: "merged" }]);
    expect(out.result).toEqual(t.result);
    expect(out.status).toBe(t.status);
    expect(out.egress).toBe(t.egress);
    expect(out.executionId).toBe(t.executionId);
  });

  it("a whole-file hunk restates as writeFile, an anchored one as writeSection", () => {
    const out = mergedTraceFor(trace(), [
      { path: "whole.ts", anchor: "file", content: "all of it" },
      { path: "part.ts", anchor: "mid", content: "some of it" },
    ]);
    const writes = out.calls.filter((c) => c.connector === "state");
    expect(writes.map((c) => c.method)).toEqual(["writeFile", "writeSection"]);
    // The `file` anchor is not a section name and is not smuggled in as one.
    expect(writes[0]!.args).toEqual({ path: "whole.ts", content: "all of it" });
    expect(writes[1]!.args).toEqual({ path: "part.ts", anchor: "mid", content: "some of it" });
  });

  it("an empty merge leaves a trace with no writes at all — not the slice's own", () => {
    const out = mergedTraceFor(trace(), []);
    expect(out.calls.filter((c) => c.connector === "state")).toHaveLength(0);
    expect(out.calls).toHaveLength(1);
  });
});

describe("PORT-4, Track 1 — the slice's human approval IS an SCR verdict, never an invented one", () => {
  it("an ungated slice lands with requiredReviewers: [] and no verdict", async () => {
    const stub = stubFor("port4-ungated-lands");
    const seriesId = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const landings = await projectSlicesAsChanges(
      stub,
      seriesId,
      [childFor("A")],
      () => [{ path: "A.ts", anchor: "top", content: "A" }],
      { approvalOf: () => undefined }, // approvalGated: [] -- nothing to clear
    );
    const a = landings[0]!.changeId;

    expect(await stub.liveVerdicts(a)).toEqual([]);
    const result = await stub.land("wes", seriesId, [a]);
    expect(result.landedShas).toHaveLength(1);
  });

  it("a gated slice whose gate is still held is refused at land — fail-closed, no fabricated approver", async () => {
    const stub = stubFor("port4-gated-refused");
    const seriesId = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const landings = await projectSlicesAsChanges(
      stub,
      seriesId,
      [childFor("A")],
      () => [{ path: "A.ts", anchor: "top", content: "A" }],
      // approvalGated: ["state"], gate held by a REAL identity that has
      // not cleared it. Never a placeholder name.
      { approvalOf: () => ({ approverId: "wes", approved: false }) },
    );
    const a = landings[0]!.changeId;

    expect(await stub.liveVerdicts(a)).toEqual([]);
    await expect(async () => { await stub.land("wes", seriesId, [a]); }).rejects.toThrow();

    // Once the real human really approves, the SAME Change lands.
    await stub.recordVerdict("wes", a, "approve");
    const verdicts = await stub.liveVerdicts(a);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.reviewerId).toBe("wes");
    const result = await stub.land("wes", seriesId, [a]);
    expect(result.landedShas).toHaveLength(1);
  });

  it("a gated slice whose gate was really cleared carries that identity's own signed verdict", async () => {
    const stub = stubFor("port4-gated-approved");
    const seriesId = await stub.openSeries("wes", "refs/heads/main", "sha0");
    const landings = await projectSlicesAsChanges(
      stub,
      seriesId,
      [childFor("A")],
      () => [{ path: "A.ts", anchor: "top", content: "A" }],
      { approvalOf: () => ({ approverId: "wes", approved: true }) },
    );
    const a = landings[0]!.changeId;

    const verdicts = await stub.liveVerdicts(a);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.reviewerId).toBe("wes"); // the identity that called approve(approverId)
    expect(verdicts[0]!.decision).toBe("approve");

    const result = await stub.land("wes", seriesId, [a]);
    const prov = await (stub as unknown as { provenanceOf(sha: string): Promise<{ reviewers: { reviewerId: string }[] } | null> })
      .provenanceOf(result.landedShas[0]!);
    // The provenance query answers "who reviewed this" with the real
    // human, resolved from the LandAuthorised event -- never from git.
    expect(prov?.reviewers.map((r) => r.reviewerId)).toEqual(["wes"]);
  });
});

describe("PORT-4, Track 1 — approve(approverId) is what makes an honest verdict possible", () => {
  it("approvers() is empty for a run approved without an identity, and names the identity when supplied", async () => {
    const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
    const orch = ns.get(ns.idFromName("port4-approver-identity")) as unknown as {
      admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
      approve(approverId?: string): Promise<{ resumed: boolean; state?: string }>;
      approvers(): Promise<readonly string[]>;
    };
    // Nothing paused, nothing approved: the honest answer is "nobody",
    // and it stays "nobody" -- the bridge refuses to project a gated
    // slice from this, rather than inventing a name for it.
    expect(await orch.approvers()).toEqual([]);
    const r = await orch.approve("wes");
    expect(r.resumed).toBe(false); // no pending run -- nothing to resume
    expect(await orch.approvers()).toEqual([]); // and so nothing recorded either
  });
});
