/**
 * PLAYBOOK-KEEL-SEAM (INV-DECOMP-5): `geo@v1`'s A2 cross-step anchor, one
 * scale up — did the value threaded from an upstream child survive being
 * read by a downstream one, not just "do the outputs jointly satisfy a
 * parent relation" (that's compose's `composes`, a distinct question). The
 * Mars-Orbiter shape: A emits full precision, B reads it as minor units,
 * both individually green, the seam silently wrong.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { compileSeam, checkSeamAnchor } from "../src/adapters/oracle/suite";

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
    compose(): Promise<{ ready: boolean; clauses: readonly ComposeClauseVerdict[]; seams: readonly ComposeClauseVerdict[] } | { error: string }>;
  };
}

async function pollJoinReady(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 80; i++) {
    const j = await stub.join();
    if ("ready" in j && j.ready) return;
    await sleep(20);
  }
}

// templateDerive rewrites intent to "<parent.intent> — sub-goal: return a
// result object with the field(s) described by: <clause statement>" —
// pairing these exact strings with ScriptedModelAdapter's own cases (added
// alongside this playbook) gives real observed values with no live model.
const seamRoot = (oracleRef: string, s2statement: string) => ({
  intent: "seam-anchor-test", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "S1", statement: "S1 marker", kind: "example" as const },
    { id: "S2", statement: s2statement, kind: "example" as const },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef,
  forbids: [], decomposable: true,
});

describe("suite.ts — compileSeam / checkSeamAnchor (pure)", () => {
  it("checkSeamAnchor: a relation referencing upstream is ok", () => {
    expect(checkSeamAnchor("downstream === upstream")).toEqual({ ok: true });
  });

  it("checkSeamAnchor: a relation reading only downstream is anchor-malformed", () => {
    const r = checkSeamAnchor("downstream === 14");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/upstream/);
  });

  it("compileSeam: matching values -> pass, observed records exactly what was compared", () => {
    const code = compileSeam("S3", 14, 14, "downstream === upstream");
    // eslint-disable-next-line no-new-func
    const fn = new Function(code);
    const { results, observed } = fn();
    expect(results.S3).toBe("pass");
    expect(observed.S3).toEqual({ upstream: 14, downstream: 14 }); // values, never an expectation
  });

  it("compileSeam: mismatched values -> fail (the Mars-Orbiter shape)", () => {
    const code = compileSeam("S3", 14, 99, "downstream === upstream");
    // eslint-disable-next-line no-new-func
    const fn = new Function(code);
    const { results } = fn();
    expect(results.S3).toBe("fail");
  });

  it("compileSeam: a throwing relation -> error, never a silent pass", () => {
    const code = compileSeam("S3", 14, 99, "upstream.nope.nope");
    // eslint-disable-next-line no-new-func
    const fn = new Function(code);
    const { results } = fn();
    expect(results.S3).toBe("error");
  });
});

describe("Orchestrator.compose() — the seam leg", () => {
  it("the seam break, caught: S2 recorded an invented value -> seam fail, both children individually green", async () => {
    const stub = stubFor("seam-live-break");
    await stub.admit(seamRoot("seam-demo@v1", "S2 marker mismatch"));
    await stub.derive();
    await pollJoinReady(stub);
    const j = await stub.join();
    if (!("children" in j)) throw new Error("join() errored");
    for (const c of j.children as { outcome: string | null }[]) expect(c.outcome).toBe("pass"); // individually green
    const c = await stub.compose();
    if (!("seams" in c)) throw new Error("compose() errored");
    expect(c.ready).toBe(true);
    expect(c.seams).toHaveLength(1);
    const s = c.seams[0]!;
    expect(s.outcome).toBe("fail");
    expect(s.outputs).toEqual({ upstream: 14, downstream: 99 });
  });

  it("the honest pass: S2 recorded exactly S1's value -> seam pass", async () => {
    const stub = stubFor("seam-live-pass");
    await stub.admit(seamRoot("seam-demo@v1", "S2 marker match"));
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("seams" in c)) throw new Error("compose() errored");
    const s = c.seams.find((x) => x.criterionId === "S3[S1->S2]")!;
    expect(s.outcome).toBe("pass");
    expect(s.outputs).toEqual({ upstream: 14, downstream: 14 });
  });

  it("vacuity: upstream not observable -> unverifiable, never pass/fail", async () => {
    const stub = stubFor("seam-live-vacuous");
    await stub.admit(seamRoot("seam-vacuous@v1", "S2 marker match"));
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("seams" in c)) throw new Error("compose() errored");
    const s = c.seams[0]!;
    expect(s.outcome).toBe("unverifiable");
    expect(s.reason).toMatch(/S1/);
    expect(s.outcome).not.toBe("pass");
    expect(s.outcome).not.toBe("fail");
  });

  it("anchor: a relation reading only downstream -> error, anchor-malformed", async () => {
    const stub = stubFor("seam-live-unanchored");
    await stub.admit(seamRoot("seam-unanchored@v1", "S2 marker match"));
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("seams" in c)) throw new Error("compose() errored");
    const s = c.seams[0]!;
    expect(s.outcome).toBe("error");
    expect(s.reason).toMatch(/upstream/);
  });

  it("cross-cut unaffected: compose-demo@v1 (no seams declared) -> seams: [], clauses unchanged", async () => {
    const stub = stubFor("seam-live-crosscut-only");
    await stub.admit({
      intent: "compose-anchor-test", capabilityCeiling: "connectors-only" as const,
      acceptance: [{ id: "R1", statement: "R1 marker", kind: "example" as const }, { id: "R2", statement: "R2 marker", kind: "example" as const }],
      connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "compose-demo@v1",
      forbids: [], decomposable: true,
    });
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("seams" in c)) throw new Error("compose() errored");
    expect(c.seams).toEqual([]);
    expect(c.clauses).toHaveLength(1);
    expect(c.clauses[0]!.outcome).toBe("pass"); // R1 === R2 === 14, byte-identical to the compose playbook's own milestone
  });

  it("both legs together: a tree can pass cross-cut and fail seam in the same run", async () => {
    const stub = stubFor("seam-live-both-legs");
    await stub.admit({
      intent: "compose-anchor-test", capabilityCeiling: "connectors-only" as const,
      // Only 3 root clauses (R1, R2, S2) — the real maxFanout is 3; R1 doubles
      // as the seam's upstream, so a separate S1 isn't needed (see the
      // fixture's own comment in suite.ts for why a 4th clause here would
      // trip the coverage gate instead of testing what this test is about).
      acceptance: [
        { id: "R1", statement: "R1 marker", kind: "example" as const },
        { id: "R2", statement: "R2 marker", kind: "example" as const },
        { id: "S2", statement: "S2 marker mismatch", kind: "example" as const },
      ],
      connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "seam-and-compose-demo@v1",
      forbids: [], decomposable: true,
    });
    await stub.derive();
    await pollJoinReady(stub);
    const c = await stub.compose();
    if (!("seams" in c)) throw new Error("compose() errored");
    expect(c.clauses).toHaveLength(1);
    expect(c.clauses[0]!.outcome).toBe("pass"); // R1 === R2 === 14 -- cross-cut holds
    expect(c.seams).toHaveLength(1);
    expect(c.seams[0]!.outcome).toBe("fail"); // S2 invented 99 -- seam broken -- distinct legs, distinct verdicts
  });
});
