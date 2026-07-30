/**
 * PLAYBOOK-KEEL-PROPOSER-INTEGRATION-001 — the Lift-Proposer's authoring
 * flow, live end to end against the real Orchestrator DO (mirrors
 * test/metamorphic.test.ts / test/seam.test.ts's cloudflare:test style, not
 * a mock): propose -> challenge (REAL compileMetamorphic, executed via the
 * DO's own sandboxed runtime) -> surface -> approve -> ratifyAndWrite
 * (through the real freezeGate) -> a SUBSEQUENT admit() on the written spec
 * actually enforces the lifted relation.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { LiftProposeInput, LiftProposeResult, LiftApproveResult } from "../src/composition/orchestrator";
import type { SpecificationContent } from "../src/domain/index";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null; verdict: { results: Record<string, string> } | null } | null>;
    proposeLift(input: LiftProposeInput): Promise<LiftProposeResult>;
    approveLift(): Promise<LiftApproveResult>;
    rejectLift(): Promise<{ rejected: boolean }>;
  };
}
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

const parentSpec: SpecificationContent = {
  intent: "family-scalar-demo", // reserved -- ScriptedModelAdapter, deterministic: `return value * 2;`
  acceptance: [{ id: "A1", statement: "check equals value doubled", kind: "example" }],
  connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [],
  attemptBudget: 1, oracleRef: "derived-mr@v1", // has a real metamorphic assertion for A1 (probes [42,43,91])
};

describe("Lift-Proposer integration — C.2, end to end", () => {
  it("propose -> challenge (real probing) -> surface -> approve -> written through freezeGate -> a subsequent run enforces it", async () => {
    const stub = stubFor("lift-e2e");
    const proposed = await stub.proposeLift({
      parent: parentSpec, root: parentSpec, criterionId: "A1",
      family: { kind: "equality", expected: "input * 2" }, disposition: "preserve",
      actionCode: "return value * 2;", // matches the family exactly -- every real probe should pass
      policy: { effectful: [] },
    });
    expect(proposed.surfaced).toBe(true);
    if (!proposed.surfaced) return;
    expect(proposed.package.candidate.status).toBe("surfaced");
    expect(proposed.package.openDefeaters).toEqual([]);

    const approved = await stub.approveLift();
    expect(approved.approved).toBe(true);
    if (!approved.approved) return;
    const lifted = approved.spec.acceptance.find((a) => a.id === "A1")!;
    expect(lifted.kind).toBe("property");
    expect(lifted.family).toEqual({ kind: "equality", expected: "input * 2" });

    // C.2's last leg: dispatch a REAL run against the WRITTEN spec and
    // confirm the lifted relation is actually enforced (a fresh DO, never
    // touching the authoring DO above -- OD-INT-3).
    const runStub = stubFor("lift-e2e-run");
    await runStub.admit(approved.spec);
    const r = await poll(runStub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ACCEPT");
    expect(r?.verdict?.results.A1).toBe("pass");
  });

  it("an overgeneral candidate is defeated by a real failing probe and never surfaces", async () => {
    const stub = stubFor("lift-overgeneral");
    const proposed = await stub.proposeLift({
      parent: parentSpec, root: parentSpec, criterionId: "A1",
      family: { kind: "equality", expected: "input * 2" }, disposition: "preserve",
      actionCode: "return value === 100 ? 999 : value * 2;", // wrong on the real boundary probe 100
      caseLegitimacy: { 100: "confirmed-legitimate" },
      policy: { effectful: [] },
    });
    expect(proposed.surfaced).toBe(false);
  });
});

describe("Lift-Proposer integration — C.3, rejection writes nothing", () => {
  it("rejectLift clears the pending candidate; a subsequent approveLift has nothing to ratify", async () => {
    const stub = stubFor("lift-reject");
    const proposed = await stub.proposeLift({
      parent: parentSpec, root: parentSpec, criterionId: "A1",
      family: { kind: "equality", expected: "input * 2" }, disposition: "preserve",
      actionCode: "return value * 2;",
      policy: { effectful: [] },
    });
    expect(proposed.surfaced).toBe(true);

    const rejected = await stub.rejectLift();
    expect(rejected.rejected).toBe(true);

    const approved = await stub.approveLift();
    expect(approved.approved).toBe(false);
    if (!approved.approved) expect(approved.reason).toBe("no pending lift");
  });
});

describe("Lift-Proposer integration — C.4/C.7, off the critical path, additive", () => {
  it("a normal run completes ACCEPT on a DO that ALSO has a pending, unapproved lift sitting on it", async () => {
    const stub = stubFor("lift-off-critical-path");
    // Admit a completely unrelated, ordinary run FIRST.
    await stub.admit({
      intent: "echo 42",
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example" as const }],
      connectors: ["echo"], capabilityCeiling: "connectors-only" as const, approvalGated: [],
      attemptBudget: 2, oracleRef: "echo@v1",
    });
    // A pending lift on the SAME DO, never approved or rejected.
    const proposed = await stub.proposeLift({
      parent: parentSpec, root: parentSpec, criterionId: "A1",
      family: { kind: "equality", expected: "input * 2" }, disposition: "preserve",
      actionCode: "return value * 2;",
      policy: { effectful: [] },
    });
    expect(proposed.surfaced).toBe(true);

    // The run proceeds and completes, untouched by the pending lift.
    const r = await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE");
    expect(r?.state).toBe("ACCEPT");
  });
});

describe("Lift-Proposer integration — D.7, ratification still passes through the real freezeGate", () => {
  it("a disposition recorded on the parent (not the proposer's claimed one) is what freezeGate actually checks -- a mismatch is still caught at write time", async () => {
    const stub = stubFor("lift-gate-mismatch");
    const parentWithDisposition: SpecificationContent = {
      ...parentSpec,
      decomposable: true,
      behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
      acceptance: [{ id: "A1", statement: "check equals value doubled", kind: "example", behaviorRef: "refund-flow" }],
    };
    // proposeLift is called with "improve" (admits bounded) -- but the
    // PARENT actually records "preserve" for this behaviorRef, which does
    // NOT admit bounded. proposeCandidate's own gate is satisfied (it only
    // sees the disposition it's told); freezeGate resolves the REAL one
    // from the parent and must catch the drift independently.
    const proposed = await stub.proposeLift({
      parent: parentWithDisposition, root: parentWithDisposition, criterionId: "A1",
      family: { kind: "bounded", lo: 0, hi: 1000 }, disposition: "improve",
      actionCode: "return value * 2;",
      policy: { effectful: [] },
    });
    expect(proposed.surfaced).toBe(true); // propose/challenge/surface all pass -- the mismatch is invisible until ratify

    const approved = await stub.approveLift();
    expect(approved.approved).toBe(false);
    if (!approved.approved) expect(approved.reason).toMatch(/freezeGate rejected/);
  });
});
