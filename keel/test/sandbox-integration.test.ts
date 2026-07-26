/**
 * PLAYBOOK-KEEL-RUN-SUITE-001 (Track C, D.2, D.3): the REAL-container proof.
 * Deliberately NOT part of the deterministic gate -- Track C: "the default
 * gate cannot depend on a live container (cold start, network, real
 * toolchain) -- that is the A1 flakiness lesson." Real container + Docker
 * are now wired (Dockerfile, wrangler `containers`/`durable_objects`
 * config) and live-verified via `wrangler dev` (both this playbook's
 * pass/fail cases confirmed for real: evidence.source === "sandbox" with a
 * real git clone of octocat/Hello-World and a real container `exec()`).
 * `vitest run` alone can't reach it though -- `@cloudflare/vitest-pool-
 * workers` runs in workerd only, it doesn't drive wrangler's container
 * orchestration the way `wrangler dev`/a real deploy does -- so this stays
 * an opt-in, run-on-demand check:
 *
 *   KEEL_SANDBOX_INTEGRATION=1 npx wrangler dev  # then hit /admit + /approve,
 *   or run against the deployed worker once SANDBOX is live there.
 *
 * This file documents the fixtures that were actually used for the live
 * verification, so the check is exactly reproducible.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

declare const process: { env: Record<string, string | undefined> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RUN_INTEGRATION = process.env.KEEL_SANDBOX_INTEGRATION === "1";

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    approve(): Promise<{ resumed: boolean; state?: string }>;
    result(): Promise<{ state: string | null } | null>;
    lastVerdict(): Promise<{ outcome: string; evidence: unknown } | null>;
  };
}

async function driveToTerminal(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 300; i++) {
    const r = await stub.result();
    if (r?.state === "ACCEPT" || r?.state === "ESCALATE") return r;
    if (r?.state === "PAUSE") { await stub.approve(); continue; }
    await sleep(200);
  }
  return stub.result();
}

const spec = (testCommand: string) => ({
  intent: "run-real-suite-test",
  acceptance: [{ id: "A1", statement: "the real suite passes", kind: "example" as const }],
  connectors: ["sandbox"],
  capabilityCeiling: "connectors-only" as const,
  approvalGated: ["sandbox"],
  attemptBudget: 1,
  oracleRef: "sandbox@v1",
  runSuite: { repo: "https://github.com/octocat/Hello-World", testCommand },
});

describe.skipIf(!RUN_INTEGRATION)("PLAYBOOK-KEEL-RUN-SUITE-001 (opt-in) — a real repo, a real container", () => {
  it("D.2: a passing command -> real container runs it -> verdict passed", async () => {
    const stub = stubFor("sandbox-integration-pass");
    await stub.admit(spec('node -e "process.exit(0)"'));
    const r = await driveToTerminal(stub);
    expect(r?.state).toBe("ACCEPT");
    const v = await stub.lastVerdict();
    expect(v?.evidence).toMatchObject({ source: "sandbox", passed: true, failures: [] });
  }, 120000);

  it("D.3: a failing command -> failures[] populated with {id, expected, received}", async () => {
    const stub = stubFor("sandbox-integration-fail");
    await stub.admit(spec('node -e "process.exit(1)"'));
    const r = await driveToTerminal(stub);
    expect(r?.state).toBe("ESCALATE");
    const v = await stub.lastVerdict();
    expect(v?.evidence).toMatchObject({
      source: "sandbox", passed: false,
      failures: [{ id: "exec", expected: "exit code 0", received: "exit code 1" }],
    });
  }, 120000);
});
