/** Use case #3 (capstone): the 6a spec-loop on a REAL decomposable goal.
 *  A currency-snapshot root derives 3 independent sub-specs, each of which the
 *  freeze gate AUTO-ADMITS (attenuating, reversible read-only, prohibition-
 *  inheriting, clause-mapped). The full derive->run->verify chain is the agent's
 *  live spec-loop run; here we prove derivation + gate on the real goal. */
import { describe, it, expect } from "vitest";
import { templateDerive, freezeGate, type GatePolicy } from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";

const root: SpecificationContent = {
  intent: "currency snapshot vs USD", capabilityCeiling: "connectors-only",
  acceptance: [
    { id: "A1", statement: "usd_eur is the current USD->EUR rate", kind: "example" },
    { id: "A2", statement: "usd_gbp is the current USD->GBP rate", kind: "example" },
    { id: "A3", statement: "usd_jpy is the current USD->JPY rate", kind: "example" },
  ],
  connectors: ["fx"], approvalGated: [], attemptBudget: 3, oracleRef: "fxrate@v1",
  forbids: ["write"], decomposable: true,
};
const policy: GatePolicy = { effectful: ["ledger", "gate"] }; // fx is read-only

describe("#3 spec-loop on a real decomposable goal", () => {
  it("derives one sub-spec per rate (3), each mapping its clause + inheriting prohibitions", () => {
    const subs = templateDerive(root, root);
    expect(subs).toHaveLength(3);
    expect(subs.map((s) => s.servesClause)).toEqual(["A1", "A2", "A3"]);
    for (const s of subs) { expect(s.acceptance).toHaveLength(1); expect(s.forbids).toContain("write"); }
  });
  it("the freeze gate AUTO-ADMITS every sub-spec (read-only, attenuating, mapped)", () => {
    for (const s of templateDerive(root, root)) {
      expect(freezeGate(s, root, root, policy).tier).toBe("auto-admit");
    }
  });
  it("a non-decomposable snapshot is NOT split (opt-in respected)", () => {
    expect(templateDerive({ ...root, decomposable: false }, root)).toHaveLength(0);
  });
});
