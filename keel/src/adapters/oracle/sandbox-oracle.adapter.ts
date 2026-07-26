/**
 * sandbox-oracle.adapter.ts — PLAYBOOK-KEEL-RUN-SUITE-001 (A3): the second
 * real `OraclePort`, selected by routing (B.3) instead of `SuiteOracleAdapter`
 * for specs that declare `SpecificationContent.runSuite`. Same interface,
 * same call site in `verifyDecide()` (A.1) -- "a Sandbox run's verdict
 * enters the same place, in the same shape" (`VerdictContent`).
 *
 * Reads the `sandbox.runSuite` call `SandboxConnector` already recorded on
 * the trace (B.4: it is a logged connector call, not a second execution
 * path) and projects its `{passed, failures[]}` response into the one
 * verdict shape. The oracle stays primary (B.5): this adapter is only ever
 * constructed when the spec's `runSuite` field routes here (INV-RUN-ORACLE-
 * PRIMARY, D.6 -- the self-contained path is untouched).
 */
import type { OraclePort, OracleSpec, ExecutionTraceContent, VerdictContent } from "../../domain/index";
import type { SimulationResult } from "../sandbox/verdict-projection";

function isSimulationResult(v: unknown): v is SimulationResult {
  return !!v && typeof v === "object" && typeof (v as { passed?: unknown }).passed === "boolean";
}

export class SandboxOracleAdapter implements OraclePort {
  async verify(trace: ExecutionTraceContent, spec: OracleSpec): Promise<VerdictContent> {
    const t0 = Date.now();
    const call = trace.calls.find((c) => c.connector === "sandbox" && c.method === "runSuite");

    if (!call || !isSimulationResult(call.response)) {
      // Fail-closed, same discipline as SuiteOracleAdapter's "unverifiable":
      // no recorded sandbox call (or a malformed one) means this run cannot
      // be judged -- never a silent pass.
      const results: Record<string, "pass" | "fail"> = {};
      for (const c of spec.acceptance) results[c.id] = "fail";
      return {
        outcome: "escalate",
        evidence: { source: "sandbox", reason: "no sandbox.runSuite call recorded on the trace" },
        results,
        oracleRef: spec.oracleRef,
        attempt: 0,
        ms: Date.now() - t0,
      };
    }

    const sim = call.response;
    // The Sandbox verifies the WHOLE suite, not per-criterion (unlike the
    // oracle's per-assertion granularity) -- every declared acceptance
    // criterion shares the one measured outcome.
    const results: Record<string, "pass" | "fail"> = {};
    for (const c of spec.acceptance) results[c.id] = sim.passed ? "pass" : "fail";

    return {
      outcome: sim.passed ? "pass" : "fail",
      // D.3: structured failures ride in evidence, so the NEXT generate()
      // call sees {id, expected, received} per failing test, not a bare flag.
      evidence: { source: "sandbox", passed: sim.passed, failures: sim.failures },
      results,
      oracleRef: spec.oracleRef,
      attempt: 0,
      ms: Date.now() - t0,
    };
  }
}
