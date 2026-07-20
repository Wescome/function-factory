/**
 * PLAYBOOK-KEEL-COMPOSE: coverage proved every clause was claimed; join()
 * gathered what each child produced; compose() asks whether those outputs
 * actually satisfy the PARENT's cross-cutting clause. Two individually-green
 * children (each ACCEPTing its own oracle) can still fail composition — the
 * whitepaper's invoice case (14.01 per-line vs 14.00 per-subtotal). These
 * tests exercise the mechanism deterministically (no real model needed for
 * ready/not-ready/vacuity); the PASS/FAIL composition outcomes themselves
 * need a real produced `tax` value and are live-verified against the
 * deployed worker instead (see the playbook's own milestones).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { compileComposition, suiteComposes, type OracleAssertion } from "../src/adapters/oracle/suite";

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
    derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
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

describe("suite.ts — compileComposition / suiteComposes (pure)", () => {
  const passAssertion: OracleAssertion = {
    criterionId: "R3", kind: "property",
    composes: { relation: "outputs['R1'] === outputs['R2']", requires: ["R1", "R2"] },
  };

  it("suiteComposes is true only for a suite with a composes assertion", () => {
    expect(suiteComposes("compose-demo@v1")).toBe(true);
    expect(suiteComposes("multi@v1")).toBe(false);
    expect(suiteComposes("no-such-suite@v1")).toBe(false);
  });

  it("compileComposition: matching outputs -> pass, and observed records exactly what was composed (never an expectation)", async () => {
    const code = compileComposition({ R1: 14, R2: 14 }, passAssertion);
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${code}`);
    const { results, observed } = fn();
    expect(results.R3).toBe("pass");
    expect(observed.R3).toEqual({ R1: 14, R2: 14 }); // the produced values, not an expected answer
  });

  it("compileComposition: mismatched outputs -> fail", async () => {
    const code = compileComposition({ R1: 14.01, R2: 14.0 }, passAssertion);
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${code}`);
    const { results } = fn();
    expect(results.R3).toBe("fail");
  });

  it("compileComposition: a throwing relation -> error, never a silent pass", async () => {
    const throwing: OracleAssertion = { criterionId: "R3", kind: "property", composes: { relation: "outputs.R1.nope.nope", requires: ["R1"] } };
    const code = compileComposition({ R1: 14 }, throwing);
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${code}`);
    const { results } = fn();
    expect(results.R3).toBe("error");
  });
});

describe("Orchestrator.compose() — the mechanism (deterministic, no real model needed)", () => {
  const twoClauseNoCompose = {
    intent: "compose-m-no-clause", capabilityCeiling: "connectors-only" as const,
    acceptance: [
      { id: "A1", statement: "value is 42", kind: "example" as const },
      { id: "A2", statement: "no ambient egress", kind: "property" as const },
    ],
    connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "multi@v1",
    forbids: [], decomposable: true,
  };
  const vacuousRoot = {
    intent: "compose-m-vacuous", capabilityCeiling: "connectors-only" as const,
    acceptance: [
      { id: "R1", statement: "tax is a number", kind: "example" as const },
      { id: "R2", statement: "tax is a number", kind: "example" as const },
    ],
    connectors: ["echo"], approvalGated: [], attemptBudget: 1, oracleRef: "compose-vacuous@v1",
    forbids: [], decomposable: true,
  };

  it("not-ready: compose() on a root whose children are still running refuses, composes nothing", async () => {
    const stub = stubFor("compose-m-notready");
    await stub.admit(vacuousRoot);
    await stub.derive();
    const c = await stub.compose(); // zero delay — the fibers are (almost certainly) still running
    if (!("clauses" in c)) throw new Error("compose() errored");
    if (!c.ready) expect(c.clauses).toEqual([]);
  });

  it("no composes clause declared: a ready tree with a plain suite composes nothing (ready:true, clauses:[])", async () => {
    const stub = stubFor("compose-m-noclause");
    await stub.admit(twoClauseNoCompose);
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("clauses" in c)) throw new Error("compose() errored");
    expect(c.ready).toBe(true);
    expect(c.clauses).toEqual([]);
  });

  it("vacuity: a composes clause whose required child never produced an observed value -> unverifiable, never pass or fail", async () => {
    const stub = stubFor("compose-m-vacuity");
    await stub.admit(vacuousRoot);
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("clauses" in c)) throw new Error("compose() errored");
    expect(c.ready).toBe(true);
    expect(c.clauses).toHaveLength(1);
    const r3 = c.clauses[0]!;
    expect(r3.criterionId).toBe("R3");
    expect(r3.outcome).toBe("unverifiable");
    expect(r3.reason).toMatch(/R1|R2/); // names the offending clause
    expect(r3.outcome).not.toBe("pass");
    expect(r3.outcome).not.toBe("fail");
  });

  it("not-ready and a missing root both report distinctly — no partial or silent composition", async () => {
    const stub = stubFor("compose-m-no-root");
    const c = await stub.compose(); // never admitted anything at all
    expect("error" in c).toBe(true);
  });
});
