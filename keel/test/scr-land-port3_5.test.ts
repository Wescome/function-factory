/**
 * PLAYBOOK-KEEL-SCR-PORT-3_5: domain-level proof, run in-process
 * (`runInDurableObject` via `withLog`, no RPC boundary) since these are
 * about the SEALED EVENT VOCABULARY and `Model`'s own fold logic --
 * SCR's `PARTIALLY-PROPAGATED`, honesty, and the false-drift fix. None of
 * this needs real git or a real external repo; that proof (partial-failure
 * honesty and resume idempotency against REAL infra, kill-after-push
 * before PrOpened) is Track 3's real-infra probe, run live and reported
 * separately -- `@cloudflare/shell`'s git surface only fetches over real
 * HTTP, so there is no local equivalent for that half.
 */
import { describe, it, expect } from "vitest";
import { ReviewService } from "../src/scr/service";
import { audit } from "../src/scr/audit";
import { SimulatedComposer, type ComposeLayer, type ComposeResult, type Composer } from "../src/scr/vcs";
import { ScriptedTarget } from "../src/scr/target";
import { withLog, h, expectInvariant, expectInvariantAsync } from "./scr-testkit";

/** A two-tier land's own composer, as PORT-3 actually wires it: builds a
 *  real (here, simulated) commit, but onto a FEATURE BRANCH, never the
 *  real target -- `targetAdvanced: false` is the one fact that fixes the
 *  false-drift bug. */
class FeatureBranchComposer implements Composer {
  #inner = new SimulatedComposer();
  async compose(baseSha: string, layers: ComposeLayer[]): Promise<ComposeResult> {
    const r = await this.#inner.compose(baseSha, layers);
    return { ...r, targetAdvanced: false };
  }
}

describe("PORT-3.5, Track 1 — propagation honesty (SCR's PARTIALLY-PROPAGATED)", () => {
  it("LandAuthorised alone is the complete, terminal fact for a local-only land", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");

      const landEventId = await svc.land("wes", s, [a]);

      expect(svc.model.state(a)).toBe("LANDED");
      const rec = svc.model.landRecord(landEventId)!;
      expect(rec.status).toBe("AUTHORISED");
      expect(rec.pushedTip).toBeUndefined();
      expect(rec.pr).toBeUndefined();
    });
  });

  it("confirmPrOpened refuses ahead of a confirmed Pushed -- propagation is a strict sequence", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");
      const landEventId = await svc.land("wes", s, [a]);

      expectInvariant(() => svc.confirmPrOpened("wes", landEventId, 1, "https://example/pr/1"), "INV-6");
    });
  });

  it("confirmPushed / confirmPrOpened on an unknown landEventId refuse INV-1", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      expectInvariant(() => svc.confirmPushed("wes", "land_bogus", "deadbeef"), "INV-1");
      expectInvariant(() => svc.confirmPrOpened("wes", "land_bogus", 1, "https://example/pr/1"), "INV-1");
    });
  });

  it("confirmPushed then confirmPrOpened progress AUTHORISED -> PUSHED -> PR_OPENED, sealed and chain-clean", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");
      const landEventId = await svc.land("wes", s, [a]);
      const tip = svc.model.landRecord(landEventId)!.newTargetSha;

      svc.confirmPushed("wes", landEventId, tip);
      let rec = svc.model.landRecord(landEventId)!;
      expect(rec.status).toBe("PUSHED");
      expect(rec.pushedTip).toBe(tip);

      svc.confirmPrOpened("wes", landEventId, 7, "https://example/pr/7");
      rec = svc.model.landRecord(landEventId)!;
      expect(rec.status).toBe("PR_OPENED");
      expect(rec.pr).toEqual({ number: 7, url: "https://example/pr/7" });

      // INV-12: the new event types are sealed exactly like every other --
      // the honesty guarantee rides on the SAME hash chain, not a special case.
      expect(audit(log.all(), { keyring: svc.keyring })).toEqual([]);
    });
  });

  it("provenanceOf resolves the landed SHA the same regardless of propagation status", async () => {
    await withLog(async (log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");
      const landEventId = await svc.land("wes", s, [a]);
      const tip = svc.model.landRecord(landEventId)!.newTargetSha;

      const beforePropagation = svc.provenanceOf(tip);
      expect(beforePropagation?.changeId).toBe(a);

      svc.confirmPushed("wes", landEventId, tip);
      svc.confirmPrOpened("wes", landEventId, 3, "https://example/pr/3");

      const afterPropagation = svc.provenanceOf(tip);
      expect(afterPropagation).toEqual(beforePropagation);
    });
  });
});

describe("PORT-3.5, Track 2 — the false-drift fix (fence on confirmed reality, not the pushed tip)", () => {
  it("a land that moves a feature branch (targetAdvanced:false) leaves the series's fenced target unchanged", async () => {
    await withLog(async (log) => {
      const target = new ScriptedTarget("main0");
      const svc = new ReviewService(log, { composer: new FeatureBranchComposer(), target });
      const s = svc.openSeries("wes", "refs/heads/main", "main0");
      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");

      await svc.land("wes", s, [a]);

      // The composer built onto a feature branch, not `main` -- `main`
      // (ScriptedTarget's own sha) never moved, and the series must not
      // believe it did.
      expect(svc.model.series.get(s)!.targetSha).toBe("main0");
    });
  });

  it("false-drift is gone: a second land in the same series, real main still unchanged, does not falsely refuse", async () => {
    await withLog(async (log) => {
      const target = new ScriptedTarget("main0");
      const svc = new ReviewService(log, { composer: new FeatureBranchComposer(), target });
      const s = svc.openSeries("wes", "refs/heads/main", "main0");

      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");
      await svc.land("wes", s, [a]);

      // Before PORT-3.5: this land's own `newTargetSha` (the feature-branch
      // tip) would have been stamped onto `series.targetSha`, and THIS
      // second land would falsely see it as "drift" against the still-live
      // ScriptedTarget sha `main0` and refuse with INV-11. It must not.
      const b = svc.openChange("alice", s, "B", []);
      svc.appendRevision("alice", b, [h("b.ts", "top", "B1")]);
      svc.recordCheck("ci", b, "integrated", "pass");
      const landEventId = await svc.land("wes", s, [b]);

      expect(svc.model.landRecord(landEventId)!.status).toBe("AUTHORISED");
      expect(svc.model.state(b)).toBe("LANDED");
    });
  });

  it("real drift is still fenced: an external actor actually moving the target refuses + records TargetAdvanced + replays", async () => {
    await withLog(async (log) => {
      const target = new ScriptedTarget("main0");
      const svc = new ReviewService(log, { composer: new FeatureBranchComposer(), target });
      const s = svc.openSeries("wes", "refs/heads/main", "main0");

      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordCheck("ci", a, "integrated", "pass");
      await svc.land("wes", s, [a]);

      const b = svc.openChange("alice", s, "B", []);
      svc.appendRevision("alice", b, [h("b.ts", "top", "B1")]);
      svc.recordCheck("ci", b, "integrated", "pass");

      // A genuine external actor moves the real target -- unlike this
      // series's own two-tier lands, THIS is a real drift.
      target.push("main1", [h("upstream.ts", "top", "from-someone-else")]);

      await expectInvariantAsync(() => svc.land("wes", s, [b]), "INV-11");

      const events = log.all();
      expect(events.some((e) => e.type === "TargetAdvanced" && e.fromSha === "main0" && e.toSha === "main1")).toBe(true);
      // `b`'s open revision was replayed onto the incoming upstream content.
      const bRevisions = svc.model.changes.get(b)!.revisions;
      expect(bRevisions.length).toBe(2);
      expect(bRevisions.at(-1)!.reason).toBe("rebase");

      // The series's fenced target now reflects the REAL drift -- the one
      // case where it legitimately advances outside a land.
      expect(svc.model.series.get(s)!.targetSha).toBe("main1");
    });
  });
});
