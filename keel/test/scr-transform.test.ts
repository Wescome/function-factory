/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 4: SCR's `transform.test.ts` ported onto
 * the DO substrate.
 */
import { describe, it, expect } from "vitest";
import { ReviewService } from "../src/scr/service";
import { audit } from "../src/scr/audit";
import { interdiff } from "../src/scr/interdiff";
import { withLog, h } from "./scr-testkit";

describe("INV-3' CARRY-FORWARD-MODULO-DECLARED-TRANSFORM", () => {
  it("a rename carries the approval, and the scope follows the file", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("config.ts", "loader", "v1")]);
      const vid = svc.recordVerdict("bob", x, "approve", ["config.ts"]);

      svc.appendRevision("alice", x, [h("settings.ts", "loader", "v1")], "author-edit", [
        { kind: "rename", from: "config.ts", to: "settings.ts" },
      ]);

      const live = svc.model.liveVerdicts(x);
      expect(live.length).toBe(1);
      expect(live[0]!.carriedFrom).toBe(vid);
      expect(live[0]!.scope).toEqual(["settings.ts"]);
    });
  });

  it("an undeclared rename lapses the approval", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("config.ts", "loader", "v1")]);
      svc.recordVerdict("bob", x, "approve");

      svc.appendRevision("alice", x, [h("settings.ts", "loader", "v1")]);

      expect(svc.model.liveVerdicts(x).length).toBe(0);
      expect(svc.model.state(x)).toBe("STALE");
    });
  });

  it("a declared reindent carries; a content change under it does not", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "fn", "  return 1;")]);
      svc.recordVerdict("bob", x, "approve");

      svc.appendRevision("alice", x, [h("a.ts", "fn", "return 1;")], "author-edit", [
        { kind: "reindent" },
      ]);
      expect(svc.model.liveVerdicts(x).length).toBe(1);

      svc.appendRevision("alice", x, [h("a.ts", "fn", "return 2;")], "author-edit", [
        { kind: "reindent" },
      ]);
      expect(svc.model.liveVerdicts(x).length).toBe(0);
    });
  });

  it("a transform declared on one file does not excuse a change to another", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A"), h("b.ts", "top", "B")]);
      svc.recordVerdict("bob", x, "approve");

      svc.appendRevision("alice", x, [h("c.ts", "top", "A"), h("b.ts", "top", "B2")], "author-edit", [
        { kind: "rename", from: "a.ts", to: "c.ts" },
      ]);

      expect(svc.model.liveVerdicts(x).length).toBe(0);
    });
  });

  it("the interdiff records the transforms that justified it", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A")]);
      svc.recordVerdict("bob", x, "approve");
      svc.appendRevision("alice", x, [h("z.ts", "top", "A")], "author-edit", [
        { kind: "rename", from: "a.ts", to: "z.ts" },
      ]);

      const carry = log.all().find((e) => e.type === "VerdictCarriedForward")!;
      expect(carry.transforms).toEqual([{ kind: "rename", from: "a.ts", to: "z.ts" }]);
      expect(carry.interdiffHash).toBeTruthy();
    });
  });

  it("position is already free — hunk identity never held a line number", () => {
    expect(interdiff([h("a.ts", "top", "X")], [h("a.ts", "top", "X")]).empty).toBe(true);
  });
});

describe("INV-14 RESOLUTION-NEVER-CARRIES", () => {
  it("a conflict resolution lapses every approval, transform or not", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A")]);
      svc.recordVerdict("bob", x, "approve");

      svc.appendRevision("alice", x, [h("a.ts", "top", "A")], "conflict-resolution");

      expect(svc.model.liveVerdicts(x).length).toBe(0);
      expect(svc.model.state(x)).toBe("STALE");
      expect(audit(log.all(), { keyring: svc.keyring })).toEqual([]);
    });
  });

  it("audit catches a forged carry-forward onto resolved content", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A")]);
      svc.recordVerdict("bob", x, "approve");
      svc.appendRevision("alice", x, [h("a.ts", "top", "A")], "conflict-resolution");

      const forged = [
        ...log.all(),
        {
          eventId: "forged",
          at: 99,
          actorId: "attacker",
          prev: "x",
          digest: "x",
          sig: "x",
          type: "VerdictCarriedForward" as const,
          fromVerdictId: "vd_x",
          verdictId: "vd_y",
          changeId: x,
          toRevisionSeq: 2,
          interdiffHash: "nothing-changed",
        },
      ];
      expect(audit(forged).some((v) => v.property === "P20 RESOLUTION-NEVER-CARRIES")).toBe(true);
    });
  });
});

describe("sibling collision prediction", () => {
  function branches(log: import("../src/adapters/persistence/scr-review-log-do.adapter").DoReviewLog, collide: boolean) {
    const svc = new ReviewService(log);
    const s = svc.openSeries("wes", "refs/heads/main", "sha0");
    const a = svc.openChange("alice", s, "A", [], undefined, []);
    const b = svc.openChange("alice", s, "B", [], undefined, [a]);
    const c = svc.openChange("carol", s, "C", [], undefined, [a]);
    svc.appendRevision("alice", a, [h("base.ts", "root", "A1")]);
    svc.appendRevision("alice", b, [h(collide ? "x.ts" : "b.ts", "top", "from-B")]);
    svc.appendRevision("carol", c, [h(collide ? "x.ts" : "c.ts", "top", "from-C")]);
    return { svc, s, a, b, c };
  }

  it("a collision is visible long before the land refuses it", async () => {
    await withLog((log) => {
      const { svc, s, b, c } = branches(log, true);
      const clashes = svc.collisions(s);
      expect(clashes.length).toBe(1);
      expect([clashes[0]!.a, clashes[0]!.b].sort()).toEqual([b, c].sort());
      expect(clashes[0]!.path).toBe("x.ts");
      expect(clashes[0]!.anchors).toEqual(["top"]);

      expect(svc.model.state(b)).not.toBe("CONFLICTED");
      expect(svc.model.state(c)).not.toBe("CONFLICTED");
    });
  });

  it("disjoint branches predict nothing", async () => {
    await withLog((log) => {
      const { svc, s } = branches(log, false);
      expect(svc.collisions(s)).toEqual([]);
    });
  });

  it("ancestry is not collision", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", [], undefined, []);
      const b = svc.openChange("alice", s, "B", [], undefined, [a]);
      svc.appendRevision("alice", a, [h("x.ts", "top", "first")]);
      svc.appendRevision("alice", b, [h("x.ts", "top", "second")]);
      expect(svc.collisions(s)).toEqual([]);
    });
  });

  it("the prediction clears when one side moves off the anchor", async () => {
    await withLog((log) => {
      const { svc, s, c } = branches(log, true);
      expect(svc.collisions(s).length).toBe(1);
      svc.appendRevision("carol", c, [h("x.ts", "other", "from-C")]);
      expect(svc.collisions(s)).toEqual([]);
    });
  });

  it("the per-layer view names the other branch", async () => {
    await withLog((log) => {
      const { svc, s, b, c } = branches(log, true);
      const forB = svc.collisionsFor(s, b);
      expect(forB.length).toBe(1);
      expect(forB[0]!.other).toBe(c);
    });
  });
});

describe("review order and staleness explanation", () => {
  it("a merge point is not offered before its branches", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", [], undefined, []);
      const b = svc.openChange("alice", s, "B", [], undefined, [a]);
      const d = svc.openChange("dana", s, "D", [], undefined, [a, b]);
      for (const [id, p] of [[a, "a.ts"], [b, "b.ts"], [d, "d.ts"]] as const) {
        svc.appendRevision("alice", id, [h(p, "top", "v1")]);
      }

      expect(svc.reviewNext(s, "bob")).toEqual([a]);
      svc.recordVerdict("bob", a, "approve");
      expect(svc.reviewNext(s, "bob")).toEqual([b]);
      svc.recordVerdict("bob", b, "approve");
      expect(svc.reviewNext(s, "bob")).toEqual([d]);
    });
  });

  it("a lapsed verdict can say exactly what moved under it", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A1"), h("b.ts", "top", "B1")]);
      const vid = svc.recordVerdict("bob", x, "approve");
      svc.appendRevision("alice", x, [h("a.ts", "top", "A2"), h("b.ts", "top", "B1")]);

      const d = svc.whatChanged(vid)!;
      expect(d.from).toBe(1);
      expect(d.to).toBe(2);
      expect(d.removed.map((x) => x.content)).toEqual(["A1"]);
      expect(d.added.map((x) => x.content)).toEqual(["A2"]);
    });
  });

  it("a scoped verdict reports only what moved in its scope", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("alice", s, "X", []);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A1"), h("b.ts", "top", "B1")]);
      const vid = svc.recordVerdict("bob", x, "approve", ["b.ts"]);
      svc.appendRevision("alice", x, [h("a.ts", "top", "A2"), h("b.ts", "top", "B2")]);

      const d = svc.whatChanged(vid)!;
      expect(d.added.map((x) => x.path)).toEqual(["b.ts"]);
    });
  });
});
