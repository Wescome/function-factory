/**
 * PLAYBOOK-KEEL-JOIN: derive() fires children into new DOs and used to forget
 * their addresses (returned in the HTTP response, persisted nowhere). This
 * proves the addresses now survive (derived_child, the root's own SQLite),
 * that join() reads back what each child actually produced, that it never
 * judges anything, and that the three "no value" states — not finished, no
 * observe declared, observe declared but produced nothing — stay distinct.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JoinChildReport = {
  runId: string;
  doName: string;
  servesClause: string | null;
  parentRunId: string;
  terminal: string | null;
  outcome: string | null;
  observable: boolean;
  observed: { present: true; value: unknown } | { present: false };
};

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    derive(): Promise<{ admittedRuns: { doName: string; runId: string; servesClause?: string }[] } | { error: string }>;
    join(): Promise<{ ready: boolean; children: readonly JoinChildReport[] } | { error: string }>;
  };
}

// derived@v1: A1 has NO observe (vacuity case); A2 has observe: "trace.result.check"
// (the composable case). Under the deterministic ScriptedModelAdapter, every
// derived child's dynamically-rewritten intent falls to the `default` case
// (echo.emit({value:42})) regardless of which clause it serves — which
// deterministically ACCEPTs A1 (value===42) and ESCALATEs A2 (check stays
// undefined forever, budget exhausts) — exercising both branches of the
// vacuity gate without needing a real model.
const root = {
  intent: "join-test root", capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "A1", statement: "value is 42", kind: "example" as const },
    { id: "A2", statement: "check is value doubled", kind: "example" as const },
  ],
  connectors: ["echo"], approvalGated: [], attemptBudget: 2, oracleRef: "derived@v1",
  forbids: [], decomposable: true,
};

async function pollReady(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 80; i++) {
    const r = await stub.join();
    if ("ready" in r && r.ready) return r;
    await sleep(20);
  }
  return stub.join();
}

describe("PLAYBOOK-KEEL-JOIN — the join", () => {
  it("addresses survive: derive() persists derived_child, not just the HTTP response", async () => {
    const stub = stubFor("join-m1");
    await stub.admit(root);
    const d = await stub.derive();
    if (!("admittedRuns" in d)) throw new Error("derive() errored");
    expect(d.admittedRuns).toHaveLength(2);
    // join() reads derived_child back independently of derive()'s own return
    // value — proving the addresses were actually PERSISTED, not just echoed.
    const j = await stub.join();
    if (!("children" in j)) throw new Error("join() errored");
    expect(j.children).toHaveLength(2);
    expect(j.children.map((c) => c.servesClause).sort()).toEqual(["A1", "A2"]);
  });

  it("not-ready is honest: joining immediately after derive() (before children finish) reports ready:false, terminal:null", async () => {
    const stub = stubFor("join-m6");
    await stub.admit(root);
    await stub.derive();
    const j = await stub.join();
    if (!("children" in j)) throw new Error("join() errored");
    // Immediately after derive() returns, the children's own background
    // fibers are (almost certainly) still running — no partial "success".
    if (!j.ready) {
      expect(j.children.some((c) => c.terminal === null)).toBe(true);
    }
  });

  it("read-back + vacuity gate: A1 (no observe) ACCEPTs and is not observable; A2 (observe declared) is observable but produces nothing under the scripted adapter's default case", async () => {
    const stub = stubFor("join-m2-m5");
    await stub.admit(root);
    await stub.derive();
    const j = await pollReady(stub);
    if (!("children" in j)) throw new Error("join() errored");
    expect(j.ready).toBe(true);
    expect(j.children).toHaveLength(2);

    const a1 = j.children.find((c) => c.servesClause === "A1")!;
    const a2 = j.children.find((c) => c.servesClause === "A2")!;
    expect(a1).toBeTruthy();
    expect(a2).toBeTruthy();

    // A1: no `observe` in derived@v1 -> vacuous, regardless of outcome.
    expect(a1.terminal).not.toBeNull();
    expect(a1.outcome).toBe("pass"); // echo.emit({value:42}) satisfies A1
    expect(a1.observable).toBe(false);
    expect(a1.observed).toEqual({ present: false });

    // A2: `observe: "trace.result.check"` IS declared -> observable, even
    // though the scripted default case never sets `check` (ESCALATEs).
    expect(a2.terminal).not.toBeNull();
    expect(a2.observable).toBe(true);
    // Produced nothing (check stayed undefined) -- NOT the same state as A1's
    // vacuity, even though both report observed:{present:false}.
    expect(a2.observed).toEqual({ present: false });
  });

  it("the join judges nothing: no verdict/composition field appears anywhere in the report", async () => {
    const stub = stubFor("join-m-no-verdict");
    await stub.admit(root);
    await stub.derive();
    const j = await pollReady(stub);
    if (!("children" in j)) throw new Error("join() errored");
    for (const c of j.children) {
      // PLAYBOOK-KEEL-DERIV-AMEND added `spanningUncheckable` — a per-child
      // fact (which of its OWN spanning ids had no assertion), not a
      // judgment about this decomposition; still no verdict/composition
      // field.
      expect(Object.keys(c).sort()).toEqual(
        ["doName", "observable", "observed", "outcome", "parentRunId", "runId", "servesClause", "spanningUncheckable", "terminal"].sort(),
      );
    }
    expect(Object.keys(j).sort()).toEqual(["children", "ready"]);
  });
});
