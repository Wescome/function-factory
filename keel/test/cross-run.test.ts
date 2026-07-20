/**
 * cross-run.test.ts — the D1 cross-run index. Several runs (separate DOs) each
 * emit their crossRunRecord to a shared D1 table; the index aggregates them.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { D1CrossRunAdapter } from "../src/adapters/persistence/d1-cross-run.adapter";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null } | null>;
  };
}
const spec = (intent: string, budget = 3) => ({
  intent,
  acceptance: [{ id: "A1", statement: "", kind: "example" as const }],
  connectors: ["echo"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: [] as string[],
  attemptBudget: budget,
  oracleRef: "echo@v1",
});
async function runTo(name: string, intent: string, budget: number, want: string) {
  const stub = stubFor(name);
  await stub.admit(spec(intent, budget));
  for (let i = 0; i < 80; i++) { const r = await stub.result(); if (r?.state === want) return; await sleep(20); }
  throw new Error(`${name} did not reach ${want}`);
}

describe("cross-run D1 index", () => {
  it("aggregates terminal + attempts across separate runs", async () => {
    const db = (env as { DB?: D1Database }).DB;
    expect(db, "D1 binding DB must be configured for this test").toBeTruthy();

    await runTo("xr-conv", "converge", 3, "ACCEPT");   // ACCEPT after an amend (2 verdicts)
    await runTo("xr-never", "never", 2, "ESCALATE");   // ESCALATE at budget (2 verdicts)
    await runTo("xr-echo", "echo 42", 3, "ACCEPT");    // ACCEPT attempt 1 (1 verdict)

    const idx = new D1CrossRunAdapter(db!);
    // the index may lag the terminal by a tick; poll briefly
    let all: readonly { intent: string; terminal: string; attempts: number; nodeCounts: Record<string, number> }[] = [];
    for (let i = 0; i < 25; i++) { all = await idx.list(); if (all.length >= 3) break; await sleep(20); }

    const conv = all.find((r) => r.intent === "converge");
    const never = all.find((r) => r.intent === "never");
    const echo = all.find((r) => r.intent === "echo 42");

    expect(conv?.terminal).toBe("ACCEPT");
    expect(conv?.attempts).toBeGreaterThanOrEqual(2);
    expect(conv?.nodeCounts.Amendment).toBeGreaterThanOrEqual(1);
    expect(never?.terminal).toBe("ESCALATE");
    expect(never?.attempts).toBe(2);
    expect(echo?.terminal).toBe("ACCEPT");
    expect(echo?.attempts).toBe(1);

    // filter works
    const accepted = await idx.list({ terminal: "ACCEPT" });
    expect(accepted.every((r) => r.terminal === "ACCEPT")).toBe(true);
    expect(accepted.length).toBeGreaterThanOrEqual(2);
  });
});
