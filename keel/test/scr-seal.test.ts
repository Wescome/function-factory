/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 4: SCR's `seal.test.ts` ported onto the DO
 * substrate + the runtime seal (node:crypto Ed25519, Track 3 -- unmodified).
 */
import { describe, it, expect } from "vitest";
import { ReviewService } from "../src/scr/service";
import { audit } from "../src/scr/audit";
import { Keyring, canonical, verifyChain } from "../src/scr/identity";
import type { ReviewEvent } from "../src/scr/events";
import { withLog, h } from "./scr-testkit";

function sealed(log: import("../src/adapters/persistence/scr-review-log-do.adapter").DoReviewLog) {
  const keyring = new Keyring();
  const svc = new ReviewService(log, { keyring });
  const s = svc.openSeries("wes", "refs/heads/main", "sha0");
  const a = svc.openChange("alice", s, "A", ["bob"]);
  svc.appendRevision("alice", a, [h("a.ts", "top", "A1")]);
  svc.recordVerdict("bob", a, "approve");
  svc.recordCheck("ci", a, "integrated", "pass");
  svc.land("wes", s, [a]);
  return { svc, keyring, s, a };
}

describe("INV-12 LOG-IS-SEALED", () => {
  it("a well-formed log verifies", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      expect(verifyChain(log.all(), keyring)).toEqual([]);
      expect(audit(log.all(), { keyring })).toEqual([]);
    });
  });

  it("every event is chained and signed", async () => {
    await withLog((log) => {
      sealed(log);
      for (const e of log.all()) {
        expect(!!(e.digest && e.prev && e.sig)).toBe(true);
      }
      expect(log.all()[0]!.prev).toBe("0".repeat(64));
      const all = log.all();
      for (let i = 1; i < all.length; i++) {
        expect(all[i]!.prev).toBe(all[i - 1]!.digest);
      }
    });
  });

  it("altering a recorded verdict is detected", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      const forged = log.all().map((e) =>
        e.type === "VerdictRecorded" ? { ...e, decision: "reject" as const } : e,
      );
      const v = verifyChain(forged, keyring);
      expect(v.some((x) => x.property === "P16 CONTENT-BOUND")).toBe(true);
    });
  });

  it("relabelling who approved is detected", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      const forged = log.all().map((e) =>
        e.type === "VerdictRecorded" ? { ...e, reviewerId: "mallory" } : e,
      );
      expect(verifyChain(forged, keyring).some((x) => x.property === "P16 CONTENT-BOUND")).toBe(true);
    });
  });

  it("removing an event from the middle is detected", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      const all = log.all();
      const forged = [...all.slice(0, 2), ...all.slice(3)];
      expect(verifyChain(forged, keyring).some((x) => x.property === "P15 CHAIN-INTACT")).toBe(true);
    });
  });

  it("reordering events is detected", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      const all = log.all();
      const forged = [...all] as ReviewEvent[];
      [forged[1], forged[2]] = [forged[2]!, forged[1]!];
      expect(verifyChain(forged, keyring).some((x) => x.property === "P15 CHAIN-INTACT")).toBe(true);
    });
  });

  it("an event signed by the wrong key is detected", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      const mallory = new Keyring();
      mallory.generate("bob");
      const forged = log.all().map((e) => {
        if (e.type !== "VerdictRecorded") return e;
        return { ...e, sig: mallory.sign("bob", e.digest) };
      });
      const v = verifyChain(forged, keyring);
      expect(v.some((x) => x.property === "P17 ATTRIBUTED-BY-KEY")).toBe(true);
    });
  });

  it("an unsealed event is detected", async () => {
    await withLog((log) => {
      const { keyring } = sealed(log);
      const forged = log.all().map((e) => {
        if (e.type !== "CheckRecorded") return e;
        const { prev, digest, sig, ...rest } = e as ReviewEvent & Record<string, unknown>;
        void prev; void digest; void sig;
        return rest as unknown as ReviewEvent;
      });
      expect(verifyChain(forged, keyring).some((x) => x.property === "P14 SEALED")).toBe(true);
    });
  });

  it("chain and content are checkable with no keys at all", async () => {
    await withLog((log) => {
      sealed(log);
      expect(verifyChain(log.all())).toEqual([]);
      const all = log.all();
      const forged = [...all.slice(0, 1), ...all.slice(2)];
      const v = verifyChain(forged);
      expect(v.some((x) => x.property === "P15 CHAIN-INTACT")).toBe(true);
      expect(v.some((x) => x.property === "P17 ATTRIBUTED-BY-KEY")).toBe(false);
    });
  });

  it("a strict keyring refuses to speak for an unenrolled actor", async () => {
    await withLog((log) => {
      const keyring = new Keyring({ trustOnFirstUse: false });
      keyring.generate("wes");
      const svc = new ReviewService(log, { keyring });
      const s = svc.openSeries("wes", "refs/heads/main", "sha0");
      expect(() => svc.openChange("mallory", s, "X", [])).toThrow(/no key enrolled for mallory/);
    });
  });

  it("the canonical form ignores undefined, which JSON round-trips away", () => {
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  });
});
