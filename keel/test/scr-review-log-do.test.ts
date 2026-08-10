/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 2: proves `DoReviewLog` itself against the
 * REAL DO substrate (ReviewCore) via `cloudflare:test`'s `runInDurableObject`
 * -- append-only guard, atomic-batch rollback (INV-6), and counter-resume
 * across a second `ReviewService` construction over the SAME log (SCR's own
 * CLI-found defect, service.ts's own fix -- unmodified by this port).
 */
import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { DoReviewLog } from "../src/adapters/persistence/scr-review-log-do.adapter";
import { ReviewService } from "../src/scr/service";
import { InvariantViolation } from "../src/scr/events";

function stubFor(name: string) {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  return ns.get(ns.idFromName(name));
}

describe("DoReviewLog — the review log on real DO SQLite", () => {
  it("append-only: a raw UPDATE/DELETE against review_log is blocked by the trigger", async () => {
    const stub = stubFor("scr-log-append-only");
    await runInDurableObject(stub, (_instance, state) => {
      const log = new DoReviewLog(state.storage);
      const svc = new ReviewService(log);
      svc.openSeries("wes", "refs/heads/main", "sha0");

      expect(() => state.storage.sql.exec("UPDATE review_log SET type = 'x'").toArray())
        .toThrow(/append-only/);
      expect(() => state.storage.sql.exec("DELETE FROM review_log").toArray())
        .toThrow(/append-only/);
    });
  });

  it("appendAtomic rolls back the WHOLE batch on a mid-batch failure (INV-6) -- zero rows persist", async () => {
    const stub = stubFor("scr-log-atomic-rollback");
    await runInDurableObject(stub, (_instance, state) => {
      const log = new DoReviewLog(state.storage);
      const svc = new ReviewService(log);
      svc.openSeries("wes", "refs/heads/main", "sha0");
      const before = log.all().length;

      const dupe = { ...log.all()[0]! };
      expect(() => log.appendAtomic([{ ...dupe, type: "SeriesReordered" } as never, dupe]))
        .toThrow(InvariantViolation);
      expect(log.all().length).toBe(before);
    });
  });

  it("a second ReviewService over the SAME log resumes its counters -- no ev_0001 collision", async () => {
    const stub = stubFor("scr-log-resume-counters");
    await runInDurableObject(stub, (_instance, state) => {
      const log = new DoReviewLog(state.storage);
      const first = new ReviewService(log);
      const s = first.openSeries("wes", "refs/heads/main", "sha0");
      const a = first.openChange("alice", s, "A", []);
      first.appendRevision("alice", a, [{ path: "a.ts", anchor: "top", content: "A1" }]);

      const second = new ReviewService(log);
      const b = second.openChange("alice", s, "B", []);
      second.appendRevision("alice", b, [{ path: "b.ts", anchor: "top", content: "B1" }]);

      const ids = log.all().map((e) => e.eventId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(a).not.toBe(b);
    });
  });

  it("the log survives across separate runInDurableObject calls -- real durable storage, not per-call state", async () => {
    const stub = stubFor("scr-log-durable-across-calls");
    await runInDurableObject(stub, (_instance, state) => {
      const log = new DoReviewLog(state.storage);
      new ReviewService(log).openSeries("wes", "refs/heads/main", "sha0");
    });
    const countAfter = await runInDurableObject(stub, (_instance, state) => {
      const log = new DoReviewLog(state.storage);
      return log.all().length;
    });
    expect(countAfter).toBe(1);
  });
});
