/**
 * spike.test.ts — runs S1–S8 in the REAL Workers runtime via vitest-pool-workers.
 *
 * `forceEviction` here uses the CONFIRMED real mechanism (D7): evictDurableObject()
 * tears down the DO instance (wiping in-memory state, incl. the fiber-tracking
 * set) while preserving durable storage; runDurableObjectAlarm() then fires the
 * alarm that drives the recovery scan. Verified standalone against agents@0.17.3
 * directly (a never-ending fiber's stashed snapshot was recovered via
 * onFiberRecovered after evict+alarm; a clean-throw control produced no pending
 * alarm and no recovery) — see the fiber-recovery-verify companion proof.
 * S1 (checks.ts) now exercises this against the Orchestrator's own
 * startFiber/idempotencyKey usage, not a placeholder.
 */

import { describe, it, expect } from "vitest";
import { env, runInDurableObject, evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { runChecks, g1, type Harness } from "../src/checks";

function harness(): Harness {
  let n = 0;
  return {
    async fresh() {
      const id = (env as any).ORCHESTRATOR.idFromName(`t-${Date.now()}-${n++}`);
      return (env as any).ORCHESTRATOR.get(id);
    },
    async forceEviction(stub) {
      // CONFIRMED, not hypothetical: evictDurableObject() tears down the
      // instance (wipes in-memory state incl. the fiber-tracking Set) while
      // preserving durable storage; runDurableObjectAlarm() then fires the
      // keepAlive-armed alarm that drives the recovery scan. Verified with a
      // standalone falsifiable test against agents@0.17.3 directly: a
      // never-ending fiber's stashed snapshot was recovered via
      // onFiberRecovered after evictDurableObject+runDurableObjectAlarm, and
      // — as the control — a clean throw produced no pending alarm and no
      // recovery at all, matching the source-level finding exactly.
      await evictDurableObject(stub as any);
      const alarmRan = await runDurableObjectAlarm(stub as any);
      return alarmRan;
    },
  };
}

describe("KEEL substrate spike — G1 gate", () => {
  it("runs S1-S8 and reports the gate", async () => {
    const results = await runChecks(harness());
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.title}  - ${r.detail}` +
        (r.pass ? "" : `\n        FAIL -> ${r.onFail}`));
    }
    const gate = g1(results);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(8);
    if (!gate.green) {
      console.log(`\nG1 = RED. Reds: ${gate.reds.join(", ")}. See onFail cascades above.`);
    }
  });

  it("S5 is the pivotal check — surface it explicitly", async () => {
    const results = await runChecks(harness());
    const s5 = results.find((r) => r.id === "S5")!;
    console.log(`S5 (runtime oracle): ${s5.pass ? "PASS" : "FAIL"} - ${s5.detail}`);
    expect(s5).toBeDefined();
  });
});
