/**
 * PLAYBOOK-KEEL-COMPOSE-ANCHOR: the vacuity gate in compose() only checks the
 * clauses a `composes` assertion's `requires` DECLARES. Nothing stopped the
 * relation from reading a clause `requires` never listed — evaluating over a
 * possibly-undefined operand and returning a spurious pass/fail. This proves
 * the fix: `operands(relation) ⊆ requires`, checked AFTER vacuity, `error`
 * (never a judgment) on a bounds violation or a computed-key read.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { relationOperands, checkComposesAnchor, type OracleAssertion } from "../src/adapters/oracle/suite";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ComposeClauseVerdict = {
  criterionId: string;
  outcome: "pass" | "fail" | "unverifiable" | "error";
  reason?: string;
  outputs: Record<string, unknown>;
};

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    derive(): Promise<unknown>;
    join(): Promise<{ ready: boolean; children: readonly unknown[] } | { error: string }>;
    compose(): Promise<{ ready: boolean; clauses: readonly ComposeClauseVerdict[] } | { error: string }>;
  };
}

async function pollJoinReady(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 80; i++) {
    const j = await stub.join();
    if ("ready" in j && j.ready) return;
    await sleep(20);
  }
}

// The deterministic scripted-model fixture: templateDerive rewrites intent to
// "<parent.intent> — sub-goal: return a result object with the field(s)
// described by: <clause statement>" — pairing these EXACT strings with
// ScriptedModelAdapter's own cases (added alongside this playbook) gives a
// real `observed` value (`{present:true, value:14}`) without a live model.
const anchorRoot = (oracleRef: string) => ({
  intent: "compose-anchor-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "R1", statement: "R1 marker", kind: "example" as const },
    { id: "R2", statement: "R2 marker", kind: "example" as const },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef,
  forbids: [], decomposable: true,
});

describe("suite.ts — relationOperands (pure)", () => {
  it("extracts single/double-quoted literal clause ids", () => {
    expect(relationOperands("outputs['R1'] === outputs['R2']")).toEqual({ clauses: new Set(["R1", "R2"]), dynamic: false });
    expect(relationOperands('outputs["R1"] === outputs["R4"]')).toEqual({ clauses: new Set(["R1", "R4"]), dynamic: false });
  });

  it("a relation reading only one clause reports just that one", () => {
    expect(relationOperands("outputs['R1'] > 0")).toEqual({ clauses: new Set(["R1"]), dynamic: false });
  });

  it("a computed-key access (outputs[k]) is dynamic, even alongside literal reads", () => {
    const r = relationOperands("['R1','R2'].every(function(k){ return outputs[k] === outputs['R1']; })");
    expect(r.dynamic).toBe(true);
  });
});

describe("suite.ts — checkComposesAnchor (pure)", () => {
  const wellFormed: OracleAssertion = { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] === outputs['R2']", requires: ["R1", "R2"] } };
  const hole: OracleAssertion = { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] === outputs['R4']", requires: ["R1", "R2"] } };
  const dynamic: OracleAssertion = { criterionId: "R3", kind: "property", composes: { relation: "['R1','R2'].every(function(k){ return outputs[k] === outputs['R1']; })", requires: ["R1", "R2"] } };
  const dead: OracleAssertion = { criterionId: "R3", kind: "property", composes: { relation: "outputs['R1'] > 0", requires: ["R1", "R2"] } };

  it("a non-composes assertion is trivially ok (nothing to anchor-check)", () => {
    expect(checkComposesAnchor({ criterionId: "A1", kind: "example", expr: "true" })).toEqual({ ok: true });
  });

  it("well-formed (operands === requires): ok, no warnings", () => {
    expect(checkComposesAnchor(wellFormed)).toEqual({ ok: true });
  });

  it("THE HOLE: a relation reading a clause requires never declared -> not ok, names it", () => {
    const r = checkComposesAnchor(hole);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/R4/);
  });

  it("a computed-key relation -> not ok, named as a computed-key read", () => {
    const r = checkComposesAnchor(dynamic);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/computed key/);
  });

  it("a dead declaration (requires lists a clause the relation never reads) -> still ok, reported as a warning", () => {
    const r = checkComposesAnchor(dead);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings?.[0]).toMatch(/R2/);
  });
});

describe("Orchestrator.compose() — the anchor wired in", () => {
  it("THE HOLE, closed: compose-hole@v1 -> R3 is error, naming R4 — not a spurious pass/fail over undefined", async () => {
    const stub = stubFor("compose-anchor-hole");
    await stub.admit(anchorRoot("compose-hole@v1"));
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("clauses" in c)) throw new Error("compose() errored");
    expect(c.ready).toBe(true);
    const r3 = c.clauses.find((x) => x.criterionId === "R3")!;
    expect(r3.outcome).toBe("error");
    expect(r3.reason).toMatch(/R4/);
    expect(r3.outcome).not.toBe("pass");
    expect(r3.outcome).not.toBe("fail");
  });

  it("dead declaration live: requires lists R2 but the relation never reads it -> still the real verdict (pass), never error", async () => {
    const stub = stubFor("compose-anchor-wellformed");
    await stub.admit(anchorRoot("compose-dead@v1")); // requires={R1,R2}, relation only reads R1 — well-formed re: anchor (dead is a warning, not a failure)
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("clauses" in c)) throw new Error("compose() errored");
    const r3 = c.clauses.find((x) => x.criterionId === "R3")!;
    expect(r3.outcome).toBe("pass"); // outputs['R1'] === 14 > 0 -- never "error"
  });

  it("computed key is malformed live: compose-dynamic@v1 -> R3 is error, naming the computed-key read", async () => {
    const stub = stubFor("compose-anchor-dynamic");
    await stub.admit(anchorRoot("compose-dynamic@v1"));
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("clauses" in c)) throw new Error("compose() errored");
    const r3 = c.clauses.find((x) => x.criterionId === "R3")!;
    expect(r3.outcome).toBe("error");
    expect(r3.reason).toMatch(/computed key/);
  });

  it("vacuity still precedes the anchor: compose-vacuous@v1 -> unverifiable, never error", async () => {
    const stub = stubFor("compose-anchor-vacuity-order");
    await stub.admit(anchorRoot("compose-vacuous@v1"));
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("clauses" in c)) throw new Error("compose() errored");
    const r3 = c.clauses.find((x) => x.criterionId === "R3")!;
    expect(r3.outcome).toBe("unverifiable"); // R2 has no observe at all -- missing data, not a malformed relation
    expect(r3.outcome).not.toBe("error");
  });
});
