/**
 * PLAYBOOK-KEEL-RUN-SUITE-001 (A1, D.3): SandboxOracleAdapter reads the
 * sandbox.runSuite connector call SandboxConnector already recorded on the
 * trace and projects it into the same VerdictContent shape SuiteOracleAdapter
 * produces -- a hand-built trace, no container needed (governance: B.4, the
 * Sandbox run is JUST a logged ConnectorCall by the time the oracle sees it).
 */
import { describe, it, expect } from "vitest";
import { SandboxOracleAdapter } from "../src/adapters/oracle/sandbox-oracle.adapter";
import type { ExecutionTraceContent, AcceptanceCriterion } from "../src/domain/index";

const acceptance: readonly AcceptanceCriterion[] = [
  { id: "A1", statement: "the repo's real test suite passes", kind: "example" },
];

function traceWith(calls: ExecutionTraceContent["calls"], result: unknown = {}): ExecutionTraceContent {
  return { executionId: "e1", status: "completed", calls, egress: "connector-only", result };
}

describe("SandboxOracleAdapter — verify() projects the recorded sandbox.runSuite call", () => {
  it("passed -> outcome pass, every acceptance criterion marked pass", async () => {
    const trace = traceWith([
      { seq: 0, connector: "sandbox", method: "runSuite", args: { repo: "https://example.com/r" }, response: { passed: true, failures: [] } },
    ]);
    const v = await new SandboxOracleAdapter().verify(trace, { oracleRef: "sandbox@v1", acceptance });
    expect(v.outcome).toBe("pass");
    expect(v.results).toEqual({ A1: "pass" });
  });

  it("D.3: failed -> outcome fail, structured failures ride in evidence (not a bare flag)", async () => {
    const failures = [{ id: "subtracts numbers", expected: "passed", received: "expected 2 to be 3" }];
    const trace = traceWith([
      { seq: 0, connector: "sandbox", method: "runSuite", args: { repo: "https://example.com/r" }, response: { passed: false, failures } },
    ]);
    const v = await new SandboxOracleAdapter().verify(trace, { oracleRef: "sandbox@v1", acceptance });
    expect(v.outcome).toBe("fail");
    expect(v.results).toEqual({ A1: "fail" });
    expect((v.evidence as { failures: unknown }).failures).toEqual(failures);
  });

  it("fail-closed: no sandbox.runSuite call recorded -> inconclusive, never a false fail, never a silent pass", async () => {
    const trace = traceWith([{ seq: 0, connector: "echo", method: "emit", args: {}, response: { value: 42 } }]);
    const v = await new SandboxOracleAdapter().verify(trace, { oracleRef: "sandbox@v1", acceptance });
    // PLAYBOOK-KEEL-VERDICT-SET-001: was "escalate" / results: {A1: "fail"} --
    // "can't judge" is not the same fact as "the test failed".
    expect(v.outcome).toBe("inconclusive");
    expect(v.results).toEqual({ A1: "inconclusive" });
  });

  it("fail-closed: a malformed sandbox response (no boolean `passed`) -> inconclusive", async () => {
    const trace = traceWith([
      { seq: 0, connector: "sandbox", method: "runSuite", args: {}, response: { ok: true } },
    ]);
    const v = await new SandboxOracleAdapter().verify(trace, { oracleRef: "sandbox@v1", acceptance });
    expect(v.outcome).toBe("inconclusive"); // PLAYBOOK-KEEL-VERDICT-SET-001: was "escalate"
  });
});
