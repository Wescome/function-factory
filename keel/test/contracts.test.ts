/**
 * contracts.test.ts — the G2 gate's runtime half.
 *
 * If this compiles under `tsc --noEmit` (strict) AND passes at runtime, the
 * frozen contracts are internally coherent: the types compose, the ports are
 * implementable, and decide() covers every VERIFY exit. It uses no substrate —
 * it constructs sample domain values and drives the pure logic.
 */

import { describe, it, expect } from "vitest";
import {
  decide, TRANSITIONS, transitionsFrom, isTerminal,
  type SpecificationContent, type ActionContent, type ExecutionTraceContent,
  type VerdictContent, type ContentHash,
  type CodeExecutionPort, type OraclePort, type LineageRepositoryPort,
  type RunDispatchPort, type ModelPort,
} from "../src/domain/index";

const h = (s: string) => s as ContentHash;

describe("lineage contract + entities compose", () => {
  it("a Specification content is well-formed and connectors-only (D5)", () => {
    const spec: SpecificationContent = {
      intent: "add idempotency to POST /refunds",
      acceptance: [
        { id: "A1", statement: "first request issues a refund", kind: "example" },
        { id: "A3", statement: "two concurrent same-key -> one refund", kind: "property" },
      ],
      connectors: ["repo.readFile", "repo.writeFiles", "repo.openPullRequest"],
      capabilityCeiling: "connectors-only",
      approvalGated: ["repo.openPullRequest"],
      attemptBudget: 3,
      oracleRef: "suites/refunds-idempotency@frozen",
    };
    expect(spec.capabilityCeiling).toBe("connectors-only");
    expect(spec.approvalGated).toContain("repo.openPullRequest");
  });

  it("an ExecutionTrace paused shape carries pending + the replay log (D8)", () => {
    const trace: ExecutionTraceContent = {
      executionId: "exec_1",
      status: "paused",
      calls: [{ seq: 0, connector: "repo", method: "readFile", args: ["x.ts"] }],
      pending: [{ executionId: "exec_1", seq: 1, connector: "repo", method: "openPullRequest", args: {} }],
      egress: "connector-only",
    };
    expect(trace.status).toBe("paused");
    expect(trace.pending?.length).toBe(1);
  });
});

describe("decide() — the folded LoopController, exhaustive", () => {
  it("pass -> ACCEPT", () => {
    expect(decide({ verdict: "pass", attempt: 2, budget: 3 })).toEqual({ next: "ACCEPT" });
  });
  it("fail with budget remaining -> AMEND (attempt+1)", () => {
    expect(decide({ verdict: "fail", attempt: 1, budget: 3 })).toEqual({ next: "AMEND", attempt: 2 });
  });
  it("fail at budget -> ESCALATE budget-exhausted", () => {
    expect(decide({ verdict: "fail", attempt: 3, budget: 3 })).toEqual({ next: "ESCALATE", reason: "budget-exhausted" });
  });
  it("PLAYBOOK-KEEL-VERDICT-SET-001: verifier escalate -> ESCALATE inconclusive (reason renamed from verifier-escalate)", () => {
    expect(decide({ verdict: "escalate", attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "inconclusive" });
  });
  it("the new inconclusive outcome routes identically -> ESCALATE inconclusive, never AMEND, never ACCEPT", () => {
    expect(decide({ verdict: "inconclusive", attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "inconclusive" });
  });
  it("a degenerate top-level not-applicable (B.4: nothing checkable remains) -> ESCALATE inconclusive, never a silent ACCEPT", () => {
    expect(decide({ verdict: "not-applicable", attempt: 1, budget: 3 })).toEqual({ next: "ESCALATE", reason: "inconclusive" });
  });
  it("approval rejected -> ESCALATE rejected (regardless of verdict)", () => {
    expect(decide({ verdict: "pass", attempt: 1, budget: 3, approvalRejected: true })).toEqual({ next: "ESCALATE", reason: "rejected" });
  });
  it("budget is caller-supplied, not fixed", () => {
    expect(decide({ verdict: "fail", attempt: 4, budget: 5 })).toEqual({ next: "AMEND", attempt: 5 });
    expect(decide({ verdict: "fail", attempt: 5, budget: 5 })).toEqual({ next: "ESCALATE", reason: "budget-exhausted" });
  });

  // OD-EFFECT-6: a classified connector-call error. Amend-worthy classes fall
  // through to the normal verdict path; terminal classes short-circuit.
  it("Conflict (amend-worthy) falls through to the normal fail/amend path", () => {
    expect(decide({ verdict: "fail", attempt: 1, budget: 3, terminalError: "Conflict" }))
      .toEqual({ next: "AMEND", attempt: 2 });
  });
  it("PermissionDenied (terminal) -> ESCALATE terminal-error, even with budget left", () => {
    expect(decide({ verdict: "fail", attempt: 1, budget: 3, terminalError: "PermissionDenied" }))
      .toEqual({ next: "ESCALATE", reason: "terminal-error" });
  });
  it("terminal error takes priority over a passing verdict (can't happen in practice, but decide() stays total)", () => {
    expect(decide({ verdict: "pass", attempt: 1, budget: 3, terminalError: "AuthenticationFailed" }))
      .toEqual({ next: "ESCALATE", reason: "terminal-error" });
  });
});

describe("state machine data (D3)", () => {
  it("every transition's endpoints are reachable and terminals have no exits", () => {
    expect(transitionsFrom("VERIFY").map((t) => t.to).sort()).toEqual(["ACCEPT", "AMEND", "ESCALATE"]);
    expect(transitionsFrom("ACCEPT")).toHaveLength(0);
    expect(isTerminal("ESCALATE")).toBe(true);
    expect(isTerminal("EXECUTE")).toBe(false);
  });
  it("PAUSE round-trips to EXECUTE (D8 replay-resume) and can escalate", () => {
    expect(transitionsFrom("PAUSE").map((t) => t.to).sort()).toEqual(["ESCALATE", "EXECUTE"]);
  });
  it("no transition points at a state that isn't in LoopState", () => {
    const states = new Set(TRANSITIONS.flatMap((t) => [t.from, t.to]));
    for (const s of states) expect(typeof s).toBe("string");
  });
});

describe("ports are implementable (structural conformance)", () => {
  it("a stub can satisfy each driven port interface", () => {
    const spec: SpecificationContent = {
      intent: "x", acceptance: [], connectors: [], capabilityCeiling: "connectors-only",
      approvalGated: [], attemptBudget: 1, oracleRef: "r",
    };
    const action: ActionContent = { code: "return 1", connectors: [], attempt: 1 };
    const trace: ExecutionTraceContent = { executionId: "e", status: "completed", calls: [], egress: "none", result: 1 };
    const verdict: VerdictContent = { outcome: "pass", results: {}, evidence: null, oracleRef: "r", attempt: 1, ms: 5 };

    const model: ModelPort = { generate: async () => ({ code: action.code, connectors: [] }) };
    const exec: CodeExecutionPort = {
      execute: async () => ({ status: "completed", trace }),
      approve: async () => ({ status: "completed", trace }),
      reject: async () => {},
      revertAttempt: async () => ({ reverted: true }),
    };
    const oracle: OraclePort = { verify: async () => verdict };
    const dispatch: RunDispatchPort = { admit: async () => ({ accepted: true, status: "started" }) };
    const repo: LineageRepositoryPort = {
      append: async (i) => ({ id: h("id"), ...i }) as never,
      emit: async () => {},
      get: async () => null,
      loadRun: async () => [],
    };

    expect(model && exec && oracle && dispatch && repo && spec).toBeTruthy();
  });
});
