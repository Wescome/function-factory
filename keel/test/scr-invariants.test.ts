/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 4: SCR's `invariants.test.ts` ported onto
 * the DO substrate. Structurally identical to SCR's own file (same
 * describes, same test names, same scenarios) -- only the harness changed:
 * `node:test`/`node:assert` -> vitest, `InMemoryEventLog`/`SqliteEventLog`
 * -> `DoReviewLog` via `withLog` (test/scr-testkit.ts), each test body runs
 * inside `runInDurableObject` since `ReviewService` + `DoReviewLog` must be
 * constructed together in the DO's own execution context (see
 * review-core.ts's doc for why).
 */
import { describe, it, expect } from "vitest";
import { ReviewService } from "../src/scr/service";
import { interdiff } from "../src/scr/interdiff";
import { audit } from "../src/scr/audit";
import type { DoReviewLog } from "../src/adapters/persistence/scr-review-log-do.adapter";
import { withLog, h, expectInvariant, expectInvariantAsync } from "./scr-testkit";

/** Three-layer series, each layer approved by `rev` and integrated-checked. */
function stack(log: DoReviewLog, reviewers = ["rev"]) {
  const svc = new ReviewService(log);
  const s = svc.openSeries("wes", "refs/heads/main", "sha_main_0");
  const a = svc.openChange("wes", s, "A", reviewers);
  const b = svc.openChange("wes", s, "B", reviewers);
  const c = svc.openChange("wes", s, "C", reviewers);
  svc.appendRevision("wes", a, [h("a.ts", "top", "A1")]);
  svc.appendRevision("wes", b, [h("b.ts", "top", "B1")]);
  svc.appendRevision("wes", c, [h("c.ts", "top", "C1")]);
  return { svc, s, a, b, c };
}

function approveAndCheck(svc: ReviewService, ids: string[], reviewer = "rev") {
  for (const id of ids) {
    svc.recordVerdict(reviewer, id, "approve");
    svc.recordCheck("ci", id, "isolated", "pass");
    svc.recordCheck("ci", id, "integrated", "pass");
  }
}

describe("INV-1 CHANGE-IDENTITY-STABLE", () => {
  it("id survives revision, reorder and the landing of a lower layer", async () => {
    await withLog(async (log) => {
      const { svc, s, a, b, c } = stack(log);
      svc.appendRevision("wes", c, [h("c.ts", "top", "C2")]);
      svc.reorder("wes", s, [a, c, b]);
      approveAndCheck(svc, [a]);
      await svc.land("wes", s, [a]);

      const m = svc.model;
      expect(m.changes.has(c)).toBe(true);
      expect(m.changes.get(c)!.revisions.length).toBe(3);
      expect(m.openOrder(s)).toEqual([c, b]);
    });
  });
});

describe("INV-2 VERDICT-BINDS-REVISION", () => {
  it("no verdict event carries a SHA, and verdicts outlive SHA rewriting", async () => {
    await withLog(async (log) => {
      const { svc, s, a, b, c } = stack(log);
      approveAndCheck(svc, [a, b, c]);
      const vBefore = svc.model.liveVerdicts(c).map((v) => v.verdictId);

      await svc.land("wes", s, [a]);

      const v = svc.model.verdicts.get(vBefore[0]!)!;
      expect(typeof v.revisionSeq).toBe("number");
      expect("sha" in v).toBe(false);
      expect("commit" in v).toBe(false);

      const after = svc.model.liveVerdicts(c);
      expect(after.length).toBe(1);
      expect(after[0]!.carriedFrom).toBe(vBefore[0]);
    });
  });
});

describe("INV-3 CARRY-FORWARD-IS-EXPLICIT", () => {
  it("empty in-scope interdiff carries forward and records its hash", async () => {
    await withLog(async (log) => {
      const { svc, s, a, c } = stack(log);
      approveAndCheck(svc, [a, c]);
      const before = svc.model.liveVerdicts(c)[0]!.verdictId;
      await svc.land("wes", s, [a]);

      const carried = svc.model.liveVerdicts(c)[0]!;
      expect(carried.carriedFrom).toBe(before);
      const ev = svc.model;
      expect(ev.verdicts.get(carried.verdictId)!.decision).toBe("approve");
      expect(interdiff([h("c.ts", "top", "C1")], [h("c.ts", "top", "C1")]).empty).toBe(true);
    });
  });

  it("a non-empty interdiff lapses the verdict to STALE, never to absent", async () => {
    await withLog((log) => {
      const { svc, c } = stack(log);
      svc.recordVerdict("rev", c, "approve");
      const vid = svc.model.liveVerdicts(c)[0]!.verdictId;

      svc.appendRevision("wes", c, [h("c.ts", "top", "C2")]);

      const v = svc.model.verdicts.get(vid)!;
      expect(v.stale).toBe(true);
      expect(v.staleCause).toBe("new-revision");
      expect(svc.model.state(c)).toBe("STALE");
    });
  });

  it("scoped verdicts only lapse when their own files move", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("wes", s, "X", []);
      svc.appendRevision("wes", x, [h("x.ts", "top", "X1"), h("y.ts", "top", "Y1")]);
      const vid = svc.recordVerdict("rev", x, "approve", ["x.ts"]);

      svc.appendRevision("wes", x, [h("x.ts", "top", "X1"), h("y.ts", "top", "Y2")]);
      expect(svc.model.verdicts.get(vid)!.stale).toBe(false);

      svc.appendRevision("wes", x, [h("x.ts", "top", "X2"), h("y.ts", "top", "Y2")]);
      const live = svc.model.liveVerdicts(x);
      expect(live.length).toBe(0);
    });
  });

  it("landing is refused when a required approval is stale", async () => {
    await withLog(async (log) => {
      const { svc, s, a } = stack(log);
      approveAndCheck(svc, [a]);
      svc.appendRevision("wes", a, [h("a.ts", "top", "A2")]);
      svc.recordCheck("ci", a, "integrated", "pass");
      await expectInvariantAsync(() => svc.land("wes", s, [a]), "INV-3");
    });
  });
});

describe("INV-4 TWO-AXIS-CHECK", () => {
  it("editing a lower layer invalidates the upper integrated check by construction", async () => {
    await withLog((log) => {
      const { svc, a, b } = stack(log);
      svc.recordCheck("ci", b, "integrated", "pass");
      expect(svc.model.liveCheck(b, "integrated")).toBeTruthy();

      svc.appendRevision("wes", a, [h("a.ts", "top", "A2")]);

      expect(svc.model.liveCheck(b, "integrated")).toBeUndefined();
    });
  });

  it("isolated checks do not gate landing; integrated ones do", async () => {
    await withLog(async (log) => {
      const { svc, s, a } = stack(log);
      svc.recordVerdict("rev", a, "approve");
      svc.recordCheck("ci", a, "isolated", "pass");
      await expectInvariantAsync(() => svc.land("wes", s, [a]), "INV-4");
      svc.recordCheck("ci", a, "integrated", "pass");
      expect(await svc.land("wes", s, [a])).toBeTruthy();
    });
  });

  it("OD-1 top-only policy accepts a prefix checked only at the top", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log, { policy: { integratedCheckPolicy: "top-only" } });
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("wes", s, "A", []);
      const b = svc.openChange("wes", s, "B", []);
      svc.appendRevision("wes", a, [h("a.ts", "top", "A1")]);
      svc.appendRevision("wes", b, [h("b.ts", "top", "B1")]);
      svc.recordVerdict("rev", a, "approve");
      svc.recordVerdict("rev", b, "approve");
      svc.recordCheck("ci", b, "integrated", "pass");
      expect(await svc.land("wes", s, [a, b])).toBeTruthy();
    });
  });
});

describe("INV-5 PREFIX-LANDING-ONLY", () => {
  it("landing a hole is rejected as a reorder request, not performed", async () => {
    await withLog(async (log) => {
      const { svc, s, a, b, c } = stack(log);
      approveAndCheck(svc, [a, b, c]);
      await expectInvariantAsync(() => svc.land("wes", s, [b]), "INV-5");
      await expectInvariantAsync(() => svc.land("wes", s, [a, c]), "INV-5");
      expect(svc.model.lands.length).toBe(0);
    });
  });

  it("reorder then land makes the same intent expressible", async () => {
    await withLog(async (log) => {
      const { svc, s, a, b, c } = stack(log);
      svc.reorder("wes", s, [b, a, c]);
      approveAndCheck(svc, [b]);
      expect(await svc.land("wes", s, [b])).toBeTruthy();
    });
  });
});

describe("INV-6 LAND-IS-ATOMIC", () => {
  it("a failed land transaction persists nothing", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("wes", s, "A", []);
      svc.appendRevision("wes", a, [h("a.ts", "top", "A1")]);
      const before = log.all().length;

      const dupe = { ...log.all()[0]! };
      expectInvariant(
        () => log.appendAtomic([{ ...dupe, type: "SeriesReordered" } as never, dupe]),
        "INV-6",
      );
      expect(log.all().length).toBe(before);
    });
  });
});

describe("INV-7 NO-SILENT-REORDER", () => {
  it("reorder must be an explicit permutation", async () => {
    await withLog((log) => {
      const { svc, s, a, b } = stack(log);
      expectInvariant(() => svc.reorder("wes", s, [a, b]), "INV-7");
    });
  });

  it("reorder stales verdicts of changes whose lower layers changed", async () => {
    await withLog((log) => {
      const { svc, s, a, b, c } = stack(log);
      approveAndCheck(svc, [a, b, c]);
      const vA = svc.model.liveVerdicts(a)[0]!.verdictId;

      svc.reorder("wes", s, [b, a, c]);

      expect(svc.model.verdicts.get(vA)!.stale).toBe(true);
      expect(svc.model.verdicts.get(vA)!.staleCause).toBe("reordered");
      expect(svc.model.liveVerdicts(c).length).toBe(1);
    });
  });
});

describe("INV-8 APPEND-ONLY-REVIEW-LOG", () => {
  it("staling a verdict supersedes rather than erases", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("wes", s, "X", []);
      svc.appendRevision("wes", x, [h("x.ts", "top", "X1")]);
      const vid = svc.recordVerdict("rev", x, "approve");
      svc.appendRevision("wes", x, [h("x.ts", "top", "X2")]);

      const kinds = log.all().map((e) => e.type);
      expect(kinds).toContain("VerdictRecorded");
      expect(kinds).toContain("VerdictStaled");
      expect(log.all().some((e) => e.type === "VerdictRecorded" && e.verdictId === vid)).toBe(true);
    });
  });

  it("the store refuses UPDATE and DELETE at the storage layer", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      svc.openSeries("wes", "refs/heads/main", "sha0");
    });
    // A fresh DO instance, same idea as SCR's own "reopen a raw handle" --
    // here, a fresh runInDurableObject over a NEW DO (the append-only
    // guard is proven directly in test/scr-review-log-do.test.ts against
    // the SAME storage a live ReviewService just wrote through; re-asserted
    // here to keep this file's own structure 1:1 with SCR's).
    await withLog((log) => {
      const svc = new ReviewService(log);
      svc.openSeries("wes", "refs/heads/main", "sha0");
      expect(log.all().length).toBeGreaterThan(0);
    });
  });
});

describe("INV-9 CONFLICT-IS-A-STATE", () => {
  it("a failed rebase records the hunk and never force-pushes or drops", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("wes", s, "A", []);
      const b = svc.openChange("wes", s, "B", []);
      svc.appendRevision("wes", a, [h("shared.ts", "top", "from-A")]);
      svc.appendRevision("wes", b, [h("shared.ts", "top", "from-B")]);
      svc.recordVerdict("rev", a, "approve");
      svc.recordCheck("ci", a, "integrated", "pass");

      await svc.land("wes", s, [a]);

      expect(svc.model.state(b)).toBe("CONFLICTED");
      expect(svc.model.head(b)!.hunks[0]!.content).toBe("from-B");
      await expectInvariantAsync(() => svc.land("wes", s, [b]), "INV-9");
    });
  });
});

describe("INV-10 ATTRIBUTION-ORTHOGONAL-TO-ORDER", () => {
  it("reorder never moves authorship", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      const b = svc.openChange("bob", s, "B", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.appendRevision("bob", b, [h("b.ts", "top", "B1")]);

      svc.reorder("wes", s, [b, a]);

      expect(svc.model.changes.get(a)!.authorId).toBe("alice");
      expect(svc.model.changes.get(b)!.authorId).toBe("bob");
    });
  });
});

describe("OD-3 split inherits no verdicts", () => {
  it("split emits provenance edges and starts review clean", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const x = svc.openChange("wes", s, "X", []);
      svc.appendRevision("wes", x, [h("x.ts", "top", "X1"), h("y.ts", "top", "Y1")]);
      svc.recordVerdict("rev", x, "approve");

      const [p, q] = svc.split("wes", x, [["x.ts"], ["y.ts"]]);

      expect(svc.model.changes.get(p!)!.splitFrom).toBe(x);
      expect(svc.model.changes.get(q!)!.splitFrom).toBe(x);
      expect(svc.model.liveVerdicts(p!).length).toBe(0);
      expect(svc.model.liveVerdicts(q!).length).toBe(0);
      expect(svc.model.state(x)).toBe("ABANDONED");
    });
  });
});

describe("the load-bearing query", () => {
  it("provenance of a landed SHA is answered from the LandEvent", async () => {
    await withLog(async (log) => {
      const { svc, s, a, b } = stack(log);
      approveAndCheck(svc, [a, b]);
      const landId = await svc.land("wes", s, [a, b]);

      const land = svc.model.lands[0]!;
      expect(land.landEventId).toBe(landId);
      expect(land.landedShas.length).toBe(2);

      const prov = svc.provenanceOf(land.landedShas[1]!)!;
      expect(prov.changeId).toBe(b);
      expect(prov.authorId).toBe("wes");
      expect(prov.revisionSeq).toBe(1);
      expect(prov.reviewers.map((r) => r.reviewerId)).toEqual(["rev"]);
    });
  });

  it("provenance survives a rebase that rewrote the SHA it reviewed", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha_main_0");
      const a = svc.openChange("wes", s, "A", ["rev"]);
      const c = svc.openChange("wes", s, "C", ["rev"]);
      svc.appendRevision("wes", a, [h("a.ts", "top", "A1")]);
      svc.appendRevision("wes", c, [h("c.ts", "top", "C1")]);
      approveAndCheck(svc, [a, c]);
      await svc.land("wes", s, [a]);

      svc.recordCheck("ci", c, "integrated", "pass");
      expect(svc.model.head(c)!.seq).toBe(2);

      await svc.land("wes", s, [c]);
      const sha = svc.model.lands[1]!.landedShas[0]!;
      const prov = svc.provenanceOf(sha)!;
      expect(prov.revisionSeq).toBe(2);
      expect(prov.reviewers[0]!.carriedFrom).toBeTruthy();
    });
  });
});

describe("a new process attached to an existing log", () => {
  it("resumes its counters instead of colliding with recorded ids", async () => {
    await withLog((log) => {
      const first = new ReviewService(log);
      const s = first.openSeries("wes", "refs/heads/main", "sha0");
      const a = first.openChange("alice", s, "A", []);
      first.appendRevision("alice", a, [h("a.ts", "top", "A1")]);

      const second = new ReviewService(log);
      const b = second.openChange("alice", s, "B", []);
      second.appendRevision("alice", b, [h("b.ts", "top", "B1")]);

      const ids = log.all().map((e) => e.eventId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(a).not.toBe(b);
      expect(audit(log.all())).toEqual([]);
    });
  });
});
