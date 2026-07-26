/**
 * PLAYBOOK-KEEL-RUN-SUITE-001 (B.2, D.3): the Sandbox's own verdict
 * projection -- pure, deterministic, no container needed.
 */
import { describe, it, expect } from "vitest";
import { parseSimulationResult } from "../src/adapters/sandbox/verdict-projection";

describe("parseSimulationResult — reporter parse + exit-code fallback", () => {
  it("a passing jest/vitest-shaped json report -> passed, no failures", () => {
    const stdout = JSON.stringify({
      numFailedTests: 0,
      testResults: [{ assertionResults: [{ fullName: "adds numbers", status: "passed" }] }],
    });
    expect(parseSimulationResult({ stdout, exitCode: 0 })).toEqual({ passed: true, failures: [] });
  });

  it("a failing report -> structured failures with {id, expected, received}, not a bare flag", () => {
    const stdout = JSON.stringify({
      numFailedTests: 1,
      testResults: [{
        assertionResults: [
          { fullName: "adds numbers", status: "passed" },
          { fullName: "subtracts numbers", status: "failed", failureMessages: ["expected 2 to be 3"] },
        ],
      }],
    });
    const sim = parseSimulationResult({ stdout, exitCode: 1 });
    expect(sim.passed).toBe(false);
    expect(sim.failures).toEqual([
      { id: "subtracts numbers", expected: "passed", received: "expected 2 to be 3" },
    ]);
  });

  it("the reporter JSON is interleaved with npm's own stdout noise -- still parses", () => {
    const stdout = `npm warn deprecated foo@1.0.0\n> test\n> vitest run --reporter=json\n${JSON.stringify({ numFailedTests: 0, testResults: [] })}\n`;
    expect(parseSimulationResult({ stdout, exitCode: 0 })).toEqual({ passed: true, failures: [] });
  });

  it("OD-RUN-2: no parseable reporter, exit 0 -> passed, no failures", () => {
    expect(parseSimulationResult({ stdout: "ok\n", exitCode: 0 })).toEqual({ passed: true, failures: [] });
  });

  it("OD-RUN-2: no parseable reporter, non-zero exit -> ONE unstructured failure, never a throw", () => {
    const sim = parseSimulationResult({ stdout: "command not found: npm\n", exitCode: 127 });
    expect(sim.passed).toBe(false);
    expect(sim.failures).toEqual([{ id: "exec", expected: "exit code 0", received: "exit code 127" }]);
  });

  it("malformed JSON in stdout doesn't throw -- falls back to exit code", () => {
    const sim = parseSimulationResult({ stdout: "{not json", exitCode: 1 });
    expect(sim).toEqual({ passed: false, failures: [{ id: "exec", expected: "exit code 0", received: "exit code 1" }] });
  });
});
