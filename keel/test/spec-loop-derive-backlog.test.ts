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
