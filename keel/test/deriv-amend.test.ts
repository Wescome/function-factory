/**
 * PLAYBOOK-KEEL-DERIV-AMEND (INV-DECOMP-8): `decide()` lifted to the
 * decomposition level. Everything A1-A9 built DETECTS a bad decomposition
 * (coverage gap, cross-cut fail, seam fail, spanning-uncheckable) and every
 * one of those verdicts flowed nowhere — this closes the loop: re-derive
 * under the coverage gate, carrying the failure as evidence, under a bound.
 *
 * Scope, stated once: against `templateDerive` (deterministic, ignores
 * evidence) this is an honest BOUNDED NO-OP — it re-derives the identical
 * tree, fails identically, escalates once budget is exhausted. The value is
 * the plumbing (decision function, evidence-carrying port, the wrapper) —
 * proven here with both `templateDerive` (live-shaped, deterministic) and a
 * test-double deriver (to prove the evidence channel and the coverage gate
 * hold, since templateDerive alone can't exercise either).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  decideDecomp, failureToEvidence, runSpecLoop, templateDerive, templateDeriver,
  type Deriver, type DerivationEvidence, type SpecLoopCtx, type GatePolicy, type CompositionLegVerdict,
} from "../src/domain/index";
import type { SpecificationContent } from "../src/domain/lineage/nodes";
import { InMemoryBacklog } from "../src/adapters/spec-loop/in-memory-backlog";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Pure: decideDecomp
// ---------------------------------------------------------------------------
describe("decideDecomp — decide() lifted to the decomposition level (pure)", () => {
  const pass: CompositionLegVerdict = { criterionId: "R3", outcome: "pass" };
  const fail: CompositionLegVerdict = { criterionId: "R3", outcome: "fail" };
  const unverifiable: CompositionLegVerdict = { criterionId: "R3", outcome: "unverifiable" };
  const error: CompositionLegVerdict = { criterionId: "S4", outcome: "error" };

  it("every leg passed, loop did not escalate -> ACCEPT", () => {
    expect(decideDecomp({ derivationEscalated: false, clauses: [pass], seams: [], attempt: 1, budget: 3 })).toEqual({ next: "ACCEPT" });
  });

  it("no legs at all (nothing declared to compose) -> ACCEPT — vacuously, same as compose() itself", () => {
    expect(decideDecomp({ derivationEscalated: false, clauses: [], seams: [], attempt: 1, budget: 3 })).toEqual({ next: "ACCEPT" });
  });

  it("a leg failed and attempt < budget -> RE-DERIVE, attempt+1", () => {
    expect(decideDecomp({ derivationEscalated: false, clauses: [fail], seams: [], attempt: 1, budget: 3 })).toEqual({ next: "RE-DERIVE", attempt: 2 });
  });

  it("a leg failed and attempt === budget -> ESCALATE budget-exhausted, never RE-DERIVE past the bound", () => {
    expect(decideDecomp({ derivationEscalated: false, clauses: [fail], seams: [], attempt: 3, budget: 3 })).toEqual({ next: "ESCALATE", reason: "budget-exhausted" });
  });

  it("a leg is unverifiable/error (could not be judged) -> ESCALATE leg-escalate, even with budget remaining — an escalate is not amendable", () => {
    expect(decideDecomp({ derivationEscalated: false, clauses: [unverifiable], seams: [], attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "leg-escalate" });
    expect(decideDecomp({ derivationEscalated: false, clauses: [], seams: [error], attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "leg-escalate" });
  });

  it("the derivation itself escalated on a coverage gap -> ESCALATE coverage-gap, never RE-DERIVE", () => {
    expect(decideDecomp({ derivationEscalated: true, coverageGap: ["A3"], clauses: [], seams: [], attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "coverage-gap" });
  });

  it("the derivation itself escalated with no coverage gap (inner fan-out/derived budget) -> ESCALATE budget-exhausted", () => {
    expect(decideDecomp({ derivationEscalated: true, clauses: [], seams: [], attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "budget-exhausted" });
  });
});

describe("failureToEvidence — the union of coverage/compose/spanning-checkability (pure)", () => {
  it("gathers failed clause ids from both clauses and seams", () => {
    const ev = failureToEvidence(
      { coverageGap: undefined, clauses: [{ criterionId: "R3", outcome: "fail" }], seams: [{ criterionId: "S4", outcome: "fail" }] },
      [],
    );
    expect(ev.failedClauses).toEqual(["R3", "S4"]);
    expect(ev.coverageGap).toBeUndefined();
    expect(ev.spanningUncheckable).toBeUndefined();
  });

  it("carries a coverage gap when given one (documentary — decideDecomp never reaches RE-DERIVE with one non-empty in practice)", () => {
    const ev = failureToEvidence({ coverageGap: ["A3"], clauses: [], seams: [] }, []);
    expect(ev.coverageGap).toEqual(["A3"]);
  });

  it("dedupes spanning-uncheckable ids across children", () => {
    const ev = failureToEvidence({ coverageGap: undefined, clauses: [], seams: [] }, ["A9", "A9", "A2"]);
    expect(ev.spanningUncheckable).toEqual(["A9", "A2"]);
  });

  it("empty everywhere -> an empty (but defined) evidence object", () => {
    const ev = failureToEvidence({ coverageGap: undefined, clauses: [], seams: [] }, []);
    expect(ev).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Pure: templateDerive ignores evidence (the honest no-op)
// ---------------------------------------------------------------------------
describe("templateDerive — ignores evidence (the deterministic no-op)", () => {
  const root: SpecificationContent = {
    intent: "reconcile", capabilityCeiling: "connectors-only",
    acceptance: [
      { id: "A1", statement: "a", kind: "example" },
      { id: "A2", statement: "b", kind: "property" },
    ],
    connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
    forbids: [], decomposable: true,
  };

  it("with evidence vs without -> byte-identical output", () => {
    const noEvidence = templateDerive(root, root);
    const withEvidence = templateDerive(root, root, { failedClauses: ["A1"], coverageGap: ["A2"] });
    expect(withEvidence).toEqual(noEvidence);
  });
});

// ---------------------------------------------------------------------------
// Milestones 4 & 5 — need a test-double deriver (templateDerive alone can't
// exercise either): the evidence channel reaching the port, and the coverage
// gate holding when a re-derivation (adversarially) drops a clause.
// ---------------------------------------------------------------------------
describe("SpecLoopCtx.evidence threading — the evidence channel, end to end (test double)", () => {
  const root: SpecificationContent = {
    intent: "reconcile", capabilityCeiling: "connectors-only",
    acceptance: [
      { id: "A1", statement: "a", kind: "example" },
      { id: "A2", statement: "b", kind: "property" },
    ],
    connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
    forbids: [], decomposable: true,
  };
  const policy: GatePolicy = { effectful: ["billing", "gate"] };

  function ctx(deriver: Deriver, admitted: SpecificationContent[], evidence?: DerivationEvidence): SpecLoopCtx {
    return {
      deriver, policy, backlog: new InMemoryBacklog(),
      bound: { maxDepth: 3, maxFanout: 3, budget: 20 }, leaseMs: 10000, now: () => 1000,
      admit: async (s) => { admitted.push(s); },
      evidence,
    };
  }

  it("first pass: the deriver receives evidence undefined", async () => {
    const received: (DerivationEvidence | undefined)[] = [];
    const recorder: Deriver = { derive: (p, r, ev) => { received.push(ev); return templateDeriver.derive(p, r, ev); } };
    await runSpecLoop(root, ctx(recorder, [])); // no evidence passed
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((e) => e === undefined)).toBe(true);
  });

  it("a re-derivation: the deriver receives the POPULATED DerivationEvidence — proves the channel is wired end to end even though templateDerive ignores it", async () => {
    const received: (DerivationEvidence | undefined)[] = [];
    const recorder: Deriver = { derive: (p, r, ev) => { received.push(ev); return templateDeriver.derive(p, r, ev); } };
    const evidence: DerivationEvidence = { failedClauses: ["R3"] };
    await runSpecLoop(root, ctx(recorder, [], evidence));
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((e) => e === evidence)).toBe(true);
  });
});

describe("the gate holds under re-derivation (test double, not templateDerive)", () => {
  const root: SpecificationContent = {
    intent: "reconcile", capabilityCeiling: "connectors-only",
    acceptance: [
      { id: "A1", statement: "a", kind: "example" },
      { id: "A2", statement: "b", kind: "property" },
    ],
    connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
    forbids: [], decomposable: true,
  };
  const policy: GatePolicy = { effectful: ["billing", "gate"] };

  it("given evidence, a (model-style) deriver that drops a clause -> checkCoverage escalates the re-derivation exactly as a first derivation would", async () => {
    // No evidence: covers both clauses honestly. WITH evidence (simulating
    // "the model tried something different in response to the failure"):
    // drops A2 — the untrusted-deriver mistake coverage exists to catch.
    const adversarial: Deriver = {
      derive: (p, r, ev) => (ev ? [{ ...p, acceptance: [p.acceptance[0]!], servesClause: "A1" }] : templateDeriver.derive(p, r)),
    };
    const admittedHonest: SpecificationContent[] = [];
    const honestCtx: SpecLoopCtx = { deriver: adversarial, policy, backlog: new InMemoryBacklog(), bound: { maxDepth: 3, maxFanout: 3, budget: 20 }, leaseMs: 10000, now: () => 1000, admit: async (s) => { admittedHonest.push(s); } };
    const honest = await runSpecLoop(root, honestCtx);
    expect(honest.escalated).toBe(false); // both clauses covered -> no gap

    const admittedRederived: SpecificationContent[] = [];
    const rederivedCtx: SpecLoopCtx = { ...honestCtx, admit: async (s) => { admittedRederived.push(s); }, evidence: { failedClauses: ["R3"] } };
    const rederived = await runSpecLoop(root, rederivedCtx);
    expect(rederived.escalated).toBe(true);
    expect(rederived.coverageGap).toEqual(["A2"]); // the dropped clause, named
    expect(rederived.admitted).toBe(0); // fail-closed: nothing admitted from the under-covered batch
  });
});

// ---------------------------------------------------------------------------
// Integration: Orchestrator.deriveAmend() against the REAL production
// deriver (templateDerive) — milestones 1-3 of the live playbook, run here
// deterministically via the scripted-model fixtures already established.
// ---------------------------------------------------------------------------
type DerivAmendResult =
  | { status: "done"; decision: { next: string; reason?: string; attempt?: number }; attempts: readonly unknown[] }
  | { status: "pending"; attempt: number; attempts: readonly unknown[] }
  | { error: string };

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    deriveAmend(budget: number): Promise<DerivAmendResult>;
  };
}
async function pollDone(stub: ReturnType<typeof stubFor>, budget: number): Promise<DerivAmendResult> {
  for (let i = 0; i < 150; i++) {
    const r = await stub.deriveAmend(budget);
    if (!("status" in r) || r.status !== "pending") return r;
    await sleep(100);
  }
  return stub.deriveAmend(budget);
}

describe("Orchestrator.deriveAmend() — against templateDerive, the honest bounded no-op", () => {
  it("milestone 1: a decomposition that always fails cross-cut re-derives to the IDENTICAL tree, fails identically, and ESCALATEs budget-exhausted after EXACTLY `budget` attempts", { timeout: 30000 }, async () => {
    const stub = stubFor("da-m1-bounded-noop");
    const budget = 3;
    await stub.admit({
      intent: "compose-anchor-test", capabilityCeiling: "connectors-only",
      acceptance: [{ id: "R1", statement: "R1 marker", kind: "example" }, { id: "R2", statement: "R2 marker mismatch", kind: "example" }],
      connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "compose-demo@v1",
      forbids: [], decomposable: true,
    });
    const r = await pollDone(stub, budget);
    if (!("status" in r) || r.status !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
    expect(r.decision).toEqual({ next: "ESCALATE", reason: "budget-exhausted" });
    expect(r.attempts).toHaveLength(budget); // not 1, not unbounded — exactly the budget
  });

  it("milestone 2: a clean decomposition ACCEPTs on attempt 1, no re-derivation", { timeout: 30000 }, async () => {
    const stub = stubFor("da-m2-clean-accept");
    await stub.admit({
      intent: "compose-anchor-test", capabilityCeiling: "connectors-only",
      acceptance: [{ id: "R1", statement: "R1 marker", kind: "example" }, { id: "R2", statement: "R2 marker", kind: "example" }],
      connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "compose-demo@v1",
      forbids: [], decomposable: true,
    });
    const r = await pollDone(stub, 3);
    if (!("status" in r) || r.status !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
    expect(r.decision).toEqual({ next: "ACCEPT" });
    expect(r.attempts).toHaveLength(1);
  });

  it("milestone 3: an escalate (spanning-uncheckable seam) does NOT re-derive — attempt count 1, regardless of budget", { timeout: 30000 }, async () => {
    const stub = stubFor("da-m3-escalate-no-rederive");
    await stub.admit({
      intent: "seam-anchor-test", capabilityCeiling: "connectors-only",
      acceptance: [{ id: "S1", statement: "S1 marker", kind: "example" }, { id: "S2", statement: "S2 marker match", kind: "example" }],
      connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "seam-vacuous@v1",
      forbids: [], decomposable: true,
    });
    const r = await pollDone(stub, 5);
    if (!("status" in r) || r.status !== "done") throw new Error(`expected done, got ${JSON.stringify(r)}`);
    expect(r.decision).toEqual({ next: "ESCALATE", reason: "leg-escalate" });
    expect(r.attempts).toHaveLength(1); // never re-derived, whatever the budget
  });
});
