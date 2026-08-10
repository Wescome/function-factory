/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 4: SCR's `property.test.ts` ported onto
 * the DO substrate -- the SIMULATOR-BACKED fuzzer only. SCR's own "12
 * seeded runs x 90 commands against real git" fuzzer is deliberately NOT
 * ported (git.ts is PORT-2, out of scope: "No git" -- the no-git
 * simulators, `ScriptedTarget` here, stand in). The "forged history" tests
 * at the end are pure `audit()` calls over hand-built event arrays -- no DO
 * needed, ported unchanged.
 */
import { describe, it, expect } from "vitest";
import { ReviewService } from "../src/scr/service";
import { InvariantViolation } from "../src/scr/events";
import { audit } from "../src/scr/audit";
import { ScriptedTarget } from "../src/scr/target";
import type { DoReviewLog } from "../src/adapters/persistence/scr-review-log-do.adapter";
import { withLog } from "./scr-testkit";

/** mulberry32 — small, seeded, reproducible. */
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
const REVIEWERS = ["bob", "dana"];
const AUTHORS = ["alice", "carol"];

interface RunResult {
  steps: number;
  accepted: number;
  rejected: Record<string, number>;
  landed: number;
  conflicts: number;
}

/**
 * Drive the service with a random command stream and audit the *entire*
 * history after every accepted command. A command the service refuses is
 * not a failure -- refusals are the invariants doing their job -- but the
 * refusal must be an InvariantViolation naming an invariant, never a crash.
 */
function fuzz(log: DoReviewLog, seed: number, steps: number): RunResult {
  const r = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;

  const scripted = new ScriptedTarget("sha0");
  const svc = new ReviewService(log, { target: scripted });

  const s = svc.openSeries("wes", "refs/heads/main", "sha0");
  const rejected: Record<string, number> = {};
  let accepted = 0;
  let landed = 0;

  /**
   * Weighted so the stream actually reaches the interesting region. An
   * unweighted generator spends almost all of its budget opening changes
   * and being refused, which proves the refusals work and nothing else.
   */
  const commands: [number, () => void][] = [
    [4, () => {
      const m = svc.model;
      const open = m.openOrder(s).filter((id) => m.hasContent(id));
      if (!open.length) throw new InvariantViolation("N/A", "nothing to authorise");
      const id = open[0]!;
      for (const rev of m.changes.get(id)!.requiredReviewers) {
        svc.recordVerdict(rev, id, "approve");
      }
      svc.recordCheck("ci", id, "integrated", "pass");
    }],
    [2, () => {
      const open = svc.model.openOrder(s);
      let parents: string[] | undefined;
      const roll = r();
      if (roll < 0.2 || !open.length) parents = [];
      else if (roll < 0.5) parents = [pick(open)];
      else if (roll < 0.65 && open.length > 1) {
        const x = pick(open);
        const y = pick(open.filter((i) => i !== x));
        parents = [x, y];
      }
      svc.openChange(
        pick(AUTHORS),
        s,
        `C${Math.floor(r() * 1000)}`,
        r() < 0.6 ? [pick(REVIEWERS)] : [],
        undefined,
        parents,
      );
    }],
    [1, () => {
      const open = svc.model.openOrder(s);
      if (open.length < 2) throw new InvariantViolation("N/A", "nothing to reparent");
      const id = pick(open);
      const candidates = open.filter((x) => x !== id);
      svc.reparent("wes", id, r() < 0.3 ? [] : [pick(candidates)]);
    }],
    [3, () => {
      const m = svc.model;
      const open = m.openOrder(s);
      if (!open.length) throw new InvariantViolation("N/A", "no open change");
      const id = pick(open);
      const n = 1 + Math.floor(r() * 2);
      const hunks = Array.from({ length: n }, () => ({
        path: pick(PATHS),
        anchor: pick(ANCHORS),
        content: `v${Math.floor(r() * 4)}`,
      }));
      const roll = r();
      if (roll < 0.12) {
        svc.appendRevision(m.changes.get(id)!.authorId, id, hunks, "conflict-resolution");
      } else if (roll < 0.24) {
        svc.appendRevision(m.changes.get(id)!.authorId, id, hunks, "author-edit", [
          r() < 0.5 ? { kind: "whitespace" } : { kind: "rename", from: pick(PATHS), to: pick(PATHS) },
        ]);
      } else {
        svc.appendRevision(m.changes.get(id)!.authorId, id, hunks);
      }
    }],
    [3, () => {
      const m = svc.model;
      const open = m.openOrder(s).filter((id) => m.changes.get(id)!.revisions.length);
      if (!open.length) throw new InvariantViolation("N/A", "nothing to review");
      const id = pick(open);
      svc.recordVerdict(
        pick(REVIEWERS),
        id,
        r() < 0.85 ? "approve" : "reject",
        r() < 0.3 ? [pick(PATHS)] : [],
      );
    }],
    [3, () => {
      const m = svc.model;
      const open = m.openOrder(s).filter((id) => m.changes.get(id)!.revisions.length);
      if (!open.length) throw new InvariantViolation("N/A", "nothing to check");
      svc.recordCheck(
        "ci",
        pick(open),
        r() < 0.5 ? "isolated" : "integrated",
        r() < 0.9 ? "pass" : "fail",
      );
    }],
    [1, () => {
      const open = [...svc.model.openOrder(s)];
      if (open.length < 2) throw new InvariantViolation("N/A", "nothing to reorder");
      for (let i = open.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [open[i], open[j]] = [open[j]!, open[i]!];
      }
      svc.reorder("wes", s, open);
    }],
    [1, () => {
      const m = svc.model;
      const open = m.openOrder(s).filter((id) => m.changes.get(id)!.revisions.length);
      if (!open.length) throw new InvariantViolation("N/A", "nothing to discuss");
      const id = pick(open);
      svc.openThread("bob", id, pick([...m.head(id)!.hunks]), "q");
    }],
    [4, () => {
      const m = svc.model;
      const open = m.openOrder(s);
      if (!open.length) throw new InvariantViolation("N/A", "nothing to land");
      const k = 1 + Math.floor(r() * Math.min(open.length, 3));
      const ids = r() < 0.2 ? [pick(open)] : open.slice(0, k);
      svc.land("wes", s, ids);
      landed += ids.length;
      scripted.adopt(svc.model.series.get(s)!.targetSha);
    }],
    [1, () => {
      const path = pick(PATHS);
      const anchor = pick(ANCHORS);
      const content = `up${Math.floor(r() * 3)}`;
      scripted.push(`up_${Math.floor(r() * 1e9)}`, [{ path, anchor, content }]);
    }],
    [2, () => {
      svc.observeTarget("wes", s);
    }],
  ];

  const weighted = commands.flatMap(([w, fn]) => Array<() => void>(w).fill(fn));

  for (let i = 0; i < steps; i++) {
    try {
      pick(weighted)();
      accepted++;
    } catch (e) {
      if (!(e instanceof InvariantViolation)) {
        throw new Error(`seed ${seed} step ${i}: non-invariant failure: ${String(e)}`);
      }
      rejected[e.invariant] = (rejected[e.invariant] ?? 0) + 1;
    }

    const v = audit(log.all(), { keyring: svc.keyring });
    if (v.length) {
      throw new Error(
        `seed ${seed} step ${i}: ${v.map((x) => `${x.property} [${x.invariant}] ${x.detail}`).join("; ")}`,
      );
    }
  }

  const conflicts = [...svc.model.changes.values()].filter((c) => c.conflicted).length;
  return { steps, accepted, rejected, landed, conflicts };
}

describe("property: the audit holds over arbitrary histories", () => {
  it("200 seeded runs x 80 commands, simulated backend", async () => {
    let accepted = 0;
    let landed = 0;
    const rejected: Record<string, number> = {};
    for (let seed = 1; seed <= 200; seed++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await withLog((log) => fuzz(log, seed, 80));
      accepted += r.accepted;
      landed += r.landed;
      for (const [k, n] of Object.entries(r.rejected)) rejected[k] = (rejected[k] ?? 0) + n;
    }
    expect(landed).toBeGreaterThan(100);
    expect(rejected["INV-5"]).toBeGreaterThan(0);
    expect(rejected["INV-3"]).toBeGreaterThan(0);
    expect(rejected["INV-4"]).toBeGreaterThan(0);
    expect(rejected["INV-11"]).toBeGreaterThan(0);
    expect(rejected["INV-13"]).toBeGreaterThan(0);
    console.log(
      `      accepted ${accepted}, landed ${landed}, refusals ` +
        Object.entries(rejected)
          .filter(([k]) => k !== "N/A")
          .sort()
          .map(([k, n]) => `${k}:${n}`)
          .join(" "),
    );
  }, 120000);
});

describe("the audit detects a forged history", () => {
  it("a land that skips a layer is caught", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      const b = svc.openChange("alice", s, "B", []);
      svc.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A" }]);
      svc.appendRevision("alice", b, [{ path: "b.ts", anchor: "top", content: "B" }]);

      const forged = [
        ...log.all(),
        {
          eventId: "forged",
          at: 99,
          actorId: "attacker",
          type: "Landed" as const,
          landEventId: "land_x",
          seriesId: s,
          changeIds: [b],
          landedShas: ["deadbeef"],
          revisionSeqs: [1],
          verdictIds: [[]],
          baseFingerprint: "x",
          baseSha: "sha0",
          newTargetSha: "deadbeef",
        },
      ];

      const v = audit(forged as never);
      expect(v.some((x) => x.property === "P2 DOWNWARD-CLOSED")).toBe(true);
    });
  });

  it("a land with no approval from a required reviewer is caught", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", ["bob"]);
      svc.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A" }]);

      const forged = [
        ...log.all(),
        {
          eventId: "forged",
          at: 99,
          actorId: "attacker",
          type: "Landed" as const,
          landEventId: "land_x",
          seriesId: s,
          changeIds: [a],
          landedShas: ["deadbeef"],
          revisionSeqs: [1],
          verdictIds: [[]],
          baseFingerprint: "x",
          baseSha: "sha0",
          newTargetSha: "deadbeef",
        },
      ];

      const v = audit(forged as never);
      expect(v.some((x) => x.property === "P7 AUTHORISED")).toBe(true);
    });
  });

  it("a land naming a revision that never existed is caught", async () => {
    await withLog((log) => {
      const svc = new ReviewService(log);
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      const a = svc.openChange("alice", s, "A", []);
      svc.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A" }]);

      const forged = [
        ...log.all(),
        {
          eventId: "forged",
          at: 99,
          actorId: "attacker",
          type: "Landed" as const,
          landEventId: "land_x",
          seriesId: s,
          changeIds: [a],
          landedShas: ["deadbeef"],
          revisionSeqs: [7],
          verdictIds: [[]],
          baseFingerprint: "x",
          baseSha: "sha0",
          newTargetSha: "deadbeef",
        },
      ];

      expect(audit(forged as never).some((x) => x.property === "P4 LAND-RESOLVES")).toBe(true);
    });
  });
});
