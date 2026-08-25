/**
 * PLAYBOOK-KEEL-RUN-SUITE-001 (B.3, D.5, D.6): routing is measured from the
 * spec's own `runSuite` field, never a model judgment. Driven through the
 * real Orchestrator DO -- no container needed: SANDBOX is unbound in this
 * environment (matching the deployed worker's current config, since Tier 4
 * wiring is code-only per this playbook's scope), so a runSuite-routed spec
 * fails closed (no sandbox.runSuite call was ever recorded) -- but the
 * ESCALATE's own evidence proves SandboxOracleAdapter, not
 * SuiteOracleAdapter, was selected. That's the routing proof.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    result(): Promise<{ state: string | null } | null>;
    lastVerdict(): Promise<{ outcome: string; evidence: unknown } | null>;
  };
}

async function poll(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 80; i++) {
    const r = await stub.result();
    if (r && (r.state === "ACCEPT" || r.state === "ESCALATE")) return r;
    await sleep(30);
  }
  return stub.result();
}

describe("PLAYBOOK-KEEL-RUN-SUITE-001 — routing is measured, oracle stays primary", () => {
  it("D.5: a spec declaring runSuite routes to the Sandbox oracle, not the self-contained one", async () => {
    const stub = stubFor("sandbox-routing-1");
    await stub.admit({
      intent: "echo 42",
      acceptance: [{ id: "A1", statement: "the real suite passes", kind: "example" }],
      connectors: ["echo"],
      capabilityCeiling: "connectors-only",
      approvalGated: [],
      attemptBudget: 1,
      oracleRef: "sandbox@v1", // never resolved by SuiteOracleAdapter's registry -- proves THIS oracle wasn't used
      runSuite: { repo: "https://example.com/some-real-repo.git" },
    });
    const r = await poll(stub);
    expect(r?.state).toBe("ESCALATE"); // fails closed: SANDBOX is unbound, no call was ever recorded
    const v = await stub.lastVerdict();
    expect((v?.evidence as { source?: string })?.source).toBe("sandbox"); // proves SandboxOracleAdapter was selected
  });

  it("D.6: a spec WITHOUT runSuite routes to the oracle exactly as before -- unchanged", async () => {
    const stub = stubFor("sandbox-routing-2");
    await stub.admit({
      intent: "echo 42",
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example" }],
      connectors: ["echo"],
      capabilityCeiling: "connectors-only",
      approvalGated: [],
      attemptBudget: 1,
      oracleRef: "echo@v1",
      // no runSuite field at all
    });
    const r = await poll(stub);
    expect(r?.state).toBe("ACCEPT");
    const v = await stub.lastVerdict();
    // SuiteOracleAdapter's own evidence shape (suiteRef/perCriterion), not the sandbox one
    const evidence = v?.evidence as { suiteRef?: string; perCriterion?: unknown; source?: string };
    expect(evidence.suiteRef).toBe("echo@v1");
    expect(evidence.source).toBeUndefined();
  });
});
