/** Phase 6a [2]+[3]: template derivation feeds the gate; backlog leases fail-closed. */
import { describe, it, expect } from "vitest";
import { templateDerive, freezeGate, type GatePolicy } from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";
import { InMemoryBacklog } from "../src/adapters/spec-loop/in-memory-backlog";

const root: SpecificationContent = {
  intent: "reconcile ledgers", capabilityCeiling: "connectors-only",
  acceptance: [
    { id: "A1", statement: "totals match", kind: "example" },
    { id: "A2", statement: "discrepancies flagged", kind: "property" },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
  forbids: ["write-source"], decomposable: true,
};
const policy: GatePolicy = { effectful: ["billing", "gate"] };

describe("6a [2] template derivation", () => {
  it("splits a multi-criterion parent into per-criterion sub-specs, each gate AUTO-ADMITs", () => {
    const derived = templateDerive(root, root);
    expect(derived).toHaveLength(2);
    for (const d of derived) {
      expect(d.acceptance).toHaveLength(1);            // one clause each
      expect(d.servesClause).toBeTruthy();              // mapped (positive-serve inspectable)
      expect(d.forbids).toContain("write-source");      // inherits root prohibition
      expect(freezeGate(d, root, root, policy).tier).toBe("auto-admit"); // structurally safe
    }
  });
  it("single-criterion parent -> nothing to decompose", () => {
    expect(templateDerive({ ...root, acceptance: [root.acceptance[0]!] }, root)).toHaveLength(0);
  });
});

describe("PLAYBOOK-KEEL-SPANNING [templateDerive] — the trusted path carries spanning clauses into every child", () => {
  const spanningRoot: SpecificationContent = {
    ...root,
    acceptance: [
      { id: "A1", statement: "totals match", kind: "example" },
      { id: "A2", statement: "discrepancies flagged", kind: "property" },
      { id: "A3", statement: "every presented amount is in whole minor units", kind: "property" },
    ],
    spanning: ["A3"],
  };

  it("every child's acceptance includes A3 alongside its own served clause -> all auto-admit", () => {
    const derived = templateDerive(spanningRoot, spanningRoot);
    expect(derived).toHaveLength(3); // one per clause, INCLUDING A3 itself
    for (const d of derived) {
      expect(d.acceptance.map((a) => a.id)).toContain("A3");
      expect(d.spanning).toEqual(["A3"]); // propagated downward, like forbids
      expect(freezeGate(d, spanningRoot, spanningRoot, policy).tier).toBe("auto-admit");
    }
  });

  it("A3 (the spanning clause itself) is not duplicated in its own child's acceptance", () => {
    const derived = templateDerive(spanningRoot, spanningRoot);
    const a3Child = derived.find((d) => d.servesClause === "A3")!;
    expect(a3Child.acceptance.map((a) => a.id)).toEqual(["A3"]); // not ["A3", "A3"]
  });

  it("no spanning declared -> every child's acceptance is still exactly one clause (byte-identical to before this playbook)", () => {
    const derived = templateDerive(root, root); // `root` (module-level) has no `spanning` field
    for (const d of derived) expect(d.acceptance).toHaveLength(1);
  });

  // Live-verify caught this: a spanning clause inflates every child's
  // acceptance to length 2 (its own clause + the carried spanning one), so a
  // decomposability guard keyed on raw `acceptance.length` never converges —
  // every depth-1 child still "looks" 2-clause-decomposable and splits AGAIN
  // into the same shape. A single 3-clause root produced 11 admitted runs
  // through the real BFS (runSpecLoop) instead of 3 before this was fixed.
  // Unit-testing templateDerive as a single, one-shot call (as every OTHER
  // test above does) cannot catch this — it only shows up across MULTIPLE
  // levels of derivation, so this test explicitly re-derives from one of
  // templateDerive's own children, the way runSpecLoop's queue does.
  it("multi-level recursion terminates: re-deriving from a spanning child produces nothing further to split", () => {
    const derived = templateDerive(spanningRoot, spanningRoot);
    expect(derived).toHaveLength(3); // A1-serving, A2-serving, A3-serving (A3 is the spanning clause itself)
    for (const child of derived) {
      // Each child becomes a new "parent" at the next BFS depth, exactly as
      // runSpecLoop does (`queue.push({ spec: cand, depth: depth + 1 })`).
      const grandchildren = templateDerive(child, spanningRoot);
      expect(grandchildren).toHaveLength(0);
    }
  });
});

describe("6a [3] backlog + lease", () => {
  it("enqueue -> listPending -> dispose removes from pending", async () => {
    const bl = new InMemoryBacklog();
    const e = await bl.enqueue(root, "auto-admit", Date.now() + 10000);
    expect((await bl.listPending()).map((x) => x.id)).toContain(e.id);
    await bl.dispose(e.id, "admitted");
    expect(await bl.listPending()).toHaveLength(0);
  });
  it("INV-SPEC-LEASED: a pending entry past its lease EXPIRES fail-closed", async () => {
    const bl = new InMemoryBacklog();
    await bl.enqueue(root, "human-preapproval", 1000); // lease in the past
    const n = await bl.expireStale(2000);
    expect(n).toBe(1);
    expect(await bl.listPending()).toHaveLength(0);     // no longer pending — not silently admissible
  });
});
