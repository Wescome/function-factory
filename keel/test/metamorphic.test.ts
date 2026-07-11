/**
 * metamorphic.test.ts — D-A: relational criteria verified over multiple hidden
 * inputs. Correct code converges; an extensional hardcode is caught (anchor law).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null; nodeKinds: string[] } | null>;
    lastVerdict(): Promise<{ outcome: string; results: Record<string, string> } | null>;
  };
}
const spec = (intent: string, budget = 2) => ({
  intent,
  acceptance: [
    { id: "A1", statement: "check is value doubled (any value)", kind: "example" as const },
    { id: "A2", statement: "value is preserved", kind: "property" as const },
  ],
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: budget,
  oracleRef: "derived-mr@v1",
});
async function poll(stub: ReturnType<typeof stubFor>, until: (s: string | null) => boolean) {
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r && until(r.state)) return r; await sleep(20); }
  return null;
}

describe("D-A metamorphic oracle", () => {
  it("correct relational code passes the MR across all hidden inputs -> ACCEPT", async () => {
    const stub = stubFor("mr-ok");
    await stub.admit(spec("mr-correct"));
    expect((await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE"))?.state).toBe("ACCEPT");
    expect((await stub.lastVerdict())?.results).toEqual({ A1: "pass", A2: "pass" });
  });

  it("ANTI-GAMING: an extensional hardcode passes value=42 but FAILS the probes -> ESCALATE", async () => {
    const stub = stubFor("mr-cheat");
    await stub.admit(spec("mr-cheat"));
    // if this ACCEPTs, the relation was anchored on an output field, not `input`
    expect((await poll(stub, (s) => s === "ACCEPT" || s === "ESCALATE"))?.state).toBe("ESCALATE");
    expect((await stub.lastVerdict())?.results.A1).toBe("fail");
  });
});
