/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 4: SCR's `dag.test.ts` ported onto the DO
 * substrate -- the SIMULATOR-BACKED subset only. SCR's own "a diamond
 * against real git" test (GitRepo/GitComposer/GitMergeFileRebaser/
 * GitTargetProbe) is deliberately NOT ported: `git.ts` is PORT-2, out of
 * this increment's scope ("No git" -- the no-git simulators stand in).
 */
import { describe, it, expect } from "vitest";
import { ReviewService } from "../src/scr/service";
import { audit } from "../src/scr/audit";
import { withLog, h, expectInvariant } from "./scr-testkit";

/**
 *      D          D depends on both branches
 *     / \
 *    B   C        B and C are siblings on A
 *     \ /
 *      A
 */
function diamond(log: import("../src/adapters/persistence/scr-review-log-do.adapter").DoReviewLog, opts: { collide?: boolean } = {}) {
  const svc = new ReviewService(log);
  const s = svc.openSeries("wes", "refs/heads/main", "sha0");

  const a = svc.openChange("alice", s, "A", [], undefined, []);
  const b = svc.openChange("alice", s, "B", [], undefined, [a]);
  const c = svc.openChange("carol", s, "C", [], undefined, [a]);
  const d = svc.openChange("dana", s, "D", [], undefined, [b, c]);

  svc.appendRevision("alice", a, [h("base.ts", "root", "A1")]);
  svc.appendRevision("alice", b, [h(opts.collide ? "x.ts" : "b.ts", "top", "from-B")]);
  svc.appendRevision("carol", c, [h(opts.collide ? "x.ts" : "c.ts", "top", "from-C")]);
  svc.appendRevision("dana", d, [h("d.ts", "top", "D1")]);
  return { svc, s, a, b, c, d };
}

function authorise(svc: ReviewService, ids: string[]) {
  for (const id of ids) svc.recordCheck("ci", id, "integrated", "pass");
}

describe("DAG shape", () => {
  it("topological order is deterministic and puts ancestors first", async () => {
    await withLog((log) => {
      const { svc, s, a, b, c, d } = diamond(log);
      const order = svc.model.openOrder(s);
      expect(order[0]).toBe(a);
      expect(order.at(-1)).toBe(d);
      expect(order.indexOf(b)).toBeLessThan(order.indexOf(d));
      expect(order.indexOf(c)).toBeLessThan(order.indexOf(d));
      expect(order).toEqual(svc.model.openOrder(s));
      expect([b, c]).toEqual([order[1], order[2]]);
    });
  });

  it("ancestry, not position, defines a base", async () => {
    await withLog((log) => {
      const { svc, b, c, d } = diamond(log);
      expect(svc.model.ancestorsOf(d).sort()).toEqual([b, c, ...svc.model.ancestorsOf(b)].sort());
      expect(svc.model.ancestorsOf(b).includes(c)).toBe(false);
    });
  });

  it("a sibling's revision does not stale your checks", async () => {
    await withLog((log) => {
      const { svc, b, c } = diamond(log);
      svc.recordCheck("ci", b, "integrated", "pass");
      expect(svc.model.liveCheck(b, "integrated")).toBeTruthy();

      svc.appendRevision("carol", c, [h("c.ts", "top", "from-C-v2")]);

      expect(svc.model.liveCheck(b, "integrated")).toBeTruthy();
    });
  });

  it("but a shared ancestor's revision stales both branches", async () => {
    await withLog((log) => {
      const { svc, a, b, c } = diamond(log);
      svc.recordCheck("ci", b, "integrated", "pass");
      svc.recordCheck("ci", c, "integrated", "pass");

      svc.appendRevision("alice", a, [h("base.ts", "root", "A2")]);

      expect(svc.model.liveCheck(b, "integrated")).toBeUndefined();
      expect(svc.model.liveCheck(c, "integrated")).toBeUndefined();
    });
  });
});

describe("INV-5 generalised to downward-closed sets", () => {
  it("landing a branch without its shared ancestor is refused", async () => {
    await withLog((log) => {
      const { svc, s, b } = diamond(log);
      expectInvariant(() => svc.land("wes", s, [b]), "INV-5");
    });
  });

  it("landing a merge point without both branches is refused", async () => {
    await withLog((log) => {
      const { svc, s, a, b, d } = diamond(log);
      expectInvariant(() => svc.land("wes", s, [a, b, d]), "INV-5");
    });
  });

  it("one branch lands without the other, because a sibling is not an ancestor", async () => {
    await withLog((log) => {
      const { svc, s, a, b, c, d } = diamond(log);
      authorise(svc, [a, b]);
      svc.land("wes", s, [a, b]);

      expect(svc.model.state(b)).toBe("LANDED");
      expect(svc.model.changes.get(c)!.landed).toBe(false);
      expect(svc.model.ancestorsOf(d).length).toBe(1);
      expect(audit(log.all(), { keyring: svc.keyring })).toEqual([]);
    });
  });

  it("the set is composed in topological order regardless of how it was asked for", async () => {
    await withLog((log) => {
      const { svc, s, a, b, c, d } = diamond(log);
      authorise(svc, [a, b, c, d]);
      svc.land("wes", s, [d, c, b, a]);

      const landed = svc.model.lands[0]!.changeIds;
      expect(landed[0]).toBe(a);
      expect(landed.at(-1)).toBe(d);
    });
  });
});

describe("the cost of a diamond, made explicit", () => {
  it("two branches clean against their parent but not each other are caught at land", async () => {
    await withLog((log) => {
      const { svc, s, a, b, c } = diamond(log, { collide: true });
      authorise(svc, [a, b, c]);

      expect(svc.model.state(b)).not.toBe("CONFLICTED");
      expect(svc.model.state(c)).not.toBe("CONFLICTED");

      let threw: unknown;
      try {
        svc.land("wes", s, [a, b, c]);
      } catch (e) {
        threw = e;
      }
      expect((threw as { invariant?: string })?.invariant).toBe("INV-9");
      expect((threw as { message?: string })?.message ?? "").toMatch(/does not compose/);
      expect(svc.model.lands.length).toBe(0);
    });
  });

  it("landing them one at a time surfaces the same conflict as a rebase", async () => {
    await withLog((log) => {
      const { svc, s, a, b, c } = diamond(log, { collide: true });
      authorise(svc, [a, b]);
      svc.land("wes", s, [a, b]);

      expect(svc.model.state(c)).toBe("CONFLICTED");
    });
  });
});

describe("INV-13 ORDER-IS-ACYCLIC", () => {
  it("a change cannot become its own ancestor", async () => {
    await withLog((log) => {
      const { svc, a, d } = diamond(log);
      expectInvariant(() => svc.reparent("wes", a, [d]), "INV-13");
      expectInvariant(() => svc.reparent("wes", a, [a]), "INV-13");
    });
  });

  it("an unknown parent is refused", async () => {
    await withLog((log) => {
      const { svc, a } = diamond(log);
      expectInvariant(() => svc.reparent("wes", a, ["chg_nope"]), "INV-13");
    });
  });

  it("reparenting lapses the verdicts beneath it, naming the cause", async () => {
    await withLog((log) => {
      const { svc, a, b, c, d } = diamond(log);
      for (const id of [b, d]) svc.recordVerdict("bob", id, "approve");
      const vD = svc.model.liveVerdicts(d)[0]!.verdictId;

      svc.reparent("wes", b, [c]);

      expect(svc.model.verdicts.get(vD)!.staleCause).toBe("reordered");
      expect(svc.model.ancestorsOf(b).includes(c)).toBe(true);
      expect(svc.model.ancestorsOf(b).includes(a)).toBe(true);
    });
  });
});
