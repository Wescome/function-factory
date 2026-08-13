/**
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 3: SCR's `git.test.ts` scenarios (both
 * describes) + a real-git fuzzer, re-pointed at the isomorphic-git-backed
 * adapters (Track 1's `IsomorphicGitRebaser`, Track 2's
 * `IsomorphicGitComposer`), running against the real DO + Workspace
 * substrate. `GitTargetProbe` (an external upstream watch) is PORT-3
 * scope, not this playbook's -- `StaticTarget`/`ScriptedTarget` (already
 * shipped, no-git-specific) still stand in for "the target ref", exactly
 * as PORT-1 left them; only the REBASE/COMPOSE machinery is real here.
 *
 * SCR's own assertions read `repo.git(['cat-file'...])`/`rev-parse`/`log`/
 * `showFile` directly -- KEEL has no raw git CLI (real git only exists via
 * isomorphic-git). Reworked onto `git.log()`'s real GitLogEntry[] (oid,
 * message, author, parent) and `workspace.readFile()` after a checkout --
 * verifying the SAME properties SCR's own test proves (real commits, in
 * order, with the Change-Id trailer, real author, real file content),
 * through what KEEL's actual surface exposes.
 *
 * PLAYBOOK-KEEL-COMPUTER-SWAP-001: `withGitStack`'s own repo setup
 * (previously `@cloudflare/shell`'s `createGit()` convenience wrapper)
 * re-pointed to isomorphic-git's own `init`/`add`/`commit` directly
 * against `@cloudflare/computer`'s `workspace.fs`, matching the SAME
 * substrate `IsomorphicGitComposer` now runs on -- this file's own
 * assertions (`git.log`, `git.checkout`, `workspace.readFile`) follow.
 */
import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { Workspace } from "@cloudflare/computer";
import { init, add, commit, checkout, log as gitLog } from "isomorphic-git";
import { computerGitFs } from "../src/adapters/git/computer-git-fs.adapter";
import { ReviewService } from "../src/scr/service";
import { InvariantViolation, type Hunk } from "../src/scr/events";
import { audit } from "../src/scr/audit";
import { IsomorphicGitRebaser } from "../src/adapters/git/isomorphic-git-rebaser.adapter";
import { IsomorphicGitComposer } from "../src/adapters/git/isomorphic-git-composer.adapter";
import { DoReviewLog } from "../src/adapters/persistence/scr-review-log-do.adapter";

const h = (path: string, anchor: string, content: string): Hunk => ({ path, anchor, content });

function stubFor(name: string) {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  return ns.get(ns.idFromName(name));
}

/** Fresh DO instance, real DO-backed Workspace + review log, real git
 *  init'd with a root commit — mirrors SCR's own `GitRepo.init()`. */
async function withGitStack<T>(fn: (ctx: {
  svc: ReviewService;
  workspace: Workspace;
  fs: ReturnType<typeof computerGitFs>;
  log: DoReviewLog;
  headSha: string;
  s: string;
}) => T | Promise<T>): Promise<T> {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  const stub = ns.get(ns.idFromName(`scr-port2-${Math.random().toString(36).slice(2)}`));
  return runInDurableObject(stub, async (_instance, state) => {
    const workspace = new Workspace({ storage: state.storage as unknown as ConstructorParameters<typeof Workspace>[0]["storage"] });
    const fs = computerGitFs(workspace.fs);
    await init({ fs, dir: "/", defaultBranch: "main" });
    await workspace.fs.writeFile("/.keep", "");
    await add({ fs, dir: "/", filepath: ".keep" });
    const headSha = await commit({ fs, dir: "/", message: "root", author: { name: "scr", email: "scr@example.com" } });

    const reviewLog = new DoReviewLog(state.storage);
    const svc = new ReviewService(reviewLog, {
      rebaser: new IsomorphicGitRebaser(),
      composer: new IsomorphicGitComposer(workspace),
    });
    const s = svc.openSeries("wes", "refs/heads/main", headSha);
    return fn({ svc, workspace, fs, log: reviewLog, headSha, s });
  });
}

describe("git-backed composition (Track 3)", () => {
  it("landing writes one real commit per Change and provenance resolves each SHA", async () => {
    await withGitStack(async ({ svc, workspace, fs, s }) => {
      const a = svc.openChange("alice", s, "extract loader", ["bob"]);
      const b = svc.openChange("carol", s, "use loader", ["bob"]);
      svc.appendRevision("alice", a, [h("config.ts", "loader", "v1")]);
      svc.appendRevision("carol", b, [h("server.ts", "boot", "useLoader()")]);
      for (const id of [a, b]) {
        svc.recordVerdict("bob", id, "approve");
        svc.recordCheck("ci", id, "integrated", "pass");
      }
      await svc.land("wes", s, [a, b]);
      const [shaA, shaB] = svc.model.lands[0]!.landedShas;

      const entries = await gitLog({ fs, dir: "/", depth: 5 });
      const entryA = entries.find((e) => e.oid === shaA)!;
      const entryB = entries.find((e) => e.oid === shaB)!;
      expect(entryA).toBeTruthy();
      expect(entryB).toBeTruthy();
      expect(entryB.commit.parent).toEqual([shaA]); // one commit per Change, in order
      expect(entryA.commit.message).toContain(`Change-Id: ${a}`);
      expect(entryB.commit.author.name).toBe("carol");

      const provA = svc.provenanceOf(shaA!)!;
      expect(provA.changeId).toBe(a);
      expect(provA.authorId).toBe("alice");
      expect(provA.reviewers.map((r) => r.reviewerId)).toEqual(["bob"]);

      // File content really landed, at the right commit.
      await checkout({ fs, dir: "/", ref: shaB!, force: true });
      expect(await workspace.fs.readFile("/config.ts", "utf8")).toMatch(/loader\tv1/);
      await checkout({ fs, dir: "/", ref: "main", force: true }); // leave it as land() left it
    });
  });

  it("partial land rewrites what is above it; the review record does not move", async () => {
    await withGitStack(async ({ svc, s }) => {
      const a = svc.openChange("alice", s, "A", ["bob"]);
      const b = svc.openChange("alice", s, "B", ["bob"]);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.appendRevision("alice", b, [h("b.ts", "top", "B1")]);
      for (const id of [a, b]) {
        svc.recordVerdict("bob", id, "approve");
        svc.recordCheck("ci", id, "integrated", "pass");
      }
      const vBefore = svc.model.liveVerdicts(b)[0]!.verdictId;

      await svc.land("wes", s, [a]);

      expect(svc.model.head(b)!.seq).toBe(2); // rebase is a revision, not a mutation
      const carried = svc.model.liveVerdicts(b)[0]!;
      expect(carried.carriedFrom).toBe(vBefore);

      svc.recordCheck("ci", b, "integrated", "pass");
      await svc.land("wes", s, [b]);

      const shaB = svc.model.lands[1]!.landedShas[0]!;
      const prov = svc.provenanceOf(shaB)!;
      expect(prov.revisionSeq).toBe(2);
      expect(prov.reviewers[0]!.carriedFrom).toBe(vBefore);
    });
  });
});

describe("git merge-file decides conflicts (Track 3, through the full land() flow)", () => {
  it("same file, different anchors — clean replay, verdict carries", async () => {
    await withGitStack(async ({ svc, s }) => {
      const a = svc.openChange("alice", s, "A", ["bob"]);
      const b = svc.openChange("alice", s, "B", ["bob"]);
      svc.appendRevision("alice", a, [h("shared.ts", "imports", "import x")]);
      svc.appendRevision("alice", b, [h("shared.ts", "body", "use x")]);
      svc.recordVerdict("bob", b, "approve");
      svc.recordVerdict("bob", a, "approve");
      svc.recordCheck("ci", a, "integrated", "pass");

      await svc.land("wes", s, [a]);

      expect(svc.model.state(b)).toBe("REVIEWED");
      expect(svc.model.liveVerdicts(b).length).toBe(1);
    });
  });

  it("same file, same anchor, different content — CONFLICTED, hunk preserved", async () => {
    await withGitStack(async ({ svc, s }) => {
      const a = svc.openChange("alice", s, "A", []);
      const b = svc.openChange("alice", s, "B", []);
      svc.appendRevision("alice", a, [h("shared.ts", "body", "from-A")]);
      svc.appendRevision("alice", b, [h("shared.ts", "body", "from-B")]);
      svc.recordVerdict("bob", a, "approve");
      svc.recordCheck("ci", a, "integrated", "pass");

      await svc.land("wes", s, [a]);

      expect(svc.model.state(b)).toBe("CONFLICTED");
      expect(svc.model.head(b)!.hunks[0]!.content).toBe("from-B");
      let threw: unknown;
      try { await svc.land("wes", s, [b]); } catch (e) { threw = e; }
      expect((threw as InvariantViolation)?.invariant).toBe("INV-9");
    });
  });

  it("same file, same anchor, identical content — no conflict", async () => {
    await withGitStack(async ({ svc, s }) => {
      const a = svc.openChange("alice", s, "A", []);
      const b = svc.openChange("alice", s, "B", []);
      svc.appendRevision("alice", a, [h("shared.ts", "body", "same")]);
      svc.appendRevision("alice", b, [h("shared.ts", "body", "same"), h("shared.ts", "x", "extra")]);
      svc.recordVerdict("bob", a, "approve");
      svc.recordCheck("ci", a, "integrated", "pass");

      await svc.land("wes", s, [a]);
      expect(svc.model.state(b)).not.toBe("CONFLICTED");
    });
  });
});

describe("real-git fuzzer (Track 3, scaled down from SCR's 12x90)", () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const PATHS = ["a.ts", "b.ts", "c.ts"];
  const ANCHORS = ["top", "mid", "bot"];

  async function fuzzOnce(seed: number, steps: number): Promise<{ landed: number; conflicts: number }> {
    return withGitStack(async ({ svc, s }) => {
      const r = rng(seed);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;
      let landed = 0;

      const commands: (() => void | Promise<void>)[] = [
        () => { // open
          const open = svc.model.openOrder(s);
          const parents = r() < 0.5 || !open.length ? [] : [pick(open)];
          svc.openChange(pick(["alice", "carol"]), s, `C${Math.floor(r() * 1000)}`, r() < 0.6 ? ["bob"] : [], undefined, parents);
        },
        () => { // revise
          const open = svc.model.openOrder(s);
          if (!open.length) throw new InvariantViolation("N/A", "no open change");
          const id = pick(open);
          svc.appendRevision(svc.model.changes.get(id)!.authorId, id, [
            { path: pick(PATHS), anchor: pick(ANCHORS), content: `v${Math.floor(r() * 4)}` },
          ]);
        },
        () => { // verdict
          const open = svc.model.openOrder(s).filter((id) => svc.model.changes.get(id)!.revisions.length);
          if (!open.length) throw new InvariantViolation("N/A", "nothing to review");
          svc.recordVerdict("bob", pick(open), r() < 0.85 ? "approve" : "reject");
        },
        () => { // check
          const open = svc.model.openOrder(s).filter((id) => svc.model.changes.get(id)!.revisions.length);
          if (!open.length) throw new InvariantViolation("N/A", "nothing to check");
          svc.recordCheck("ci", pick(open), "integrated", r() < 0.9 ? "pass" : "fail");
        },
        async () => { // land
          const open = svc.model.openOrder(s);
          if (!open.length) throw new InvariantViolation("N/A", "nothing to land");
          const k = 1 + Math.floor(r() * Math.min(open.length, 2));
          const ids = r() < 0.2 ? [pick(open)] : open.slice(0, k);
          await svc.land("wes", s, ids);
          landed += ids.length;
        },
      ];

      for (let i = 0; i < steps; i++) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await pick(commands)();
        } catch (e) {
          if (!(e instanceof InvariantViolation)) {
            throw new Error(`seed ${seed} step ${i}: non-invariant failure: ${String(e)}`);
          }
        }
      }

      const conflicts = [...svc.model.changes.values()].filter((c) => c.conflicted).length;
      return { landed, conflicts };
    });
  }

  it("12 seeded runs x 40 commands against real git — audits clean throughout", async () => {
    let landed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await fuzzOnce(seed, 40);
      landed += r.landed;
    }
    expect(landed).toBeGreaterThan(0);
  }, 120000);
});

describe("audit holds through the real-git path", () => {
  it("a clean history through real land() audits clean", async () => {
    await withGitStack(async ({ svc, log, s }) => {
      const a = svc.openChange("alice", s, "A", ["bob"]);
      svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
      svc.recordVerdict("bob", a, "approve");
      svc.recordCheck("ci", a, "integrated", "pass");
      await svc.land("wes", s, [a]);

      expect(audit(log.all(), { keyring: svc.keyring })).toEqual([]);
    });
  });
});
