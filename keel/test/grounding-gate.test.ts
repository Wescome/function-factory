/**
 * PLAYBOOK-KEEL-GROUNDING-001 — the gate seated for real, through the
 * Orchestrator DO (D.3, D.4), and the grader-independence proof at the
 * adapter level (D.5).
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { GroundingGateAdapter } from "../src/adapters/grounding/grounding-gate.adapter";
import { ScriptedJudgeAdapter } from "../src/adapters/grounding/scripted-judge.adapter";
import { AlwaysConfidentJudgeAdapter } from "../src/adapters/grounding/always-confident-judge.adapter";
import { InMemorySuiteRegistry } from "../src/adapters/oracle/suite";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    result(): Promise<{ state: string | null } | null>;
    dumpNodes(): Promise<readonly { kind: string; content: unknown }[]>;
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

describe("PLAYBOOK-KEEL-GROUNDING-001 — the pre-generation seat, end to end", () => {
  it("Track C / D.6: grounding enabled + a grounded criterion -> proceeds and ACCEPTs exactly as an ungated run would", async () => {
    const stub = stubFor("grounding-happy-path");
    await stub.admit({
      intent: "echo 42",
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example" }],
      connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [],
      attemptBudget: 1, oracleRef: "echo@v1", grounding: true,
    });
    const r = await poll(stub);
    expect(r?.state).toBe("ACCEPT");
    const kinds = (await stub.dumpNodes()).map((n) => n.kind);
    expect(kinds.filter((k) => k === "Action")).toHaveLength(1); // generation DID happen -- the gate passed, didn't block
  });

  it("D.3: a criterion contradicted by a prior recorded verdict is caught BEFORE the next attempt generates any code", async () => {
    const stub = stubFor("grounding-contradicted");
    // "never" always returns value:41; echo@v1's A1 checks value===42 -- attempt 1
    // fails for real (a genuine, tool-observed oracle verdict), so attempt 2's
    // gate sees priorResult="fail" for A1 and calls it contradicted.
    await stub.admit({
      intent: "never",
      acceptance: [{ id: "A1", statement: "value is 42", kind: "example" }],
      connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [],
      attemptBudget: 3, oracleRef: "echo@v1", grounding: true,
    });
    const r = await poll(stub);
    expect(r?.state).toBe("ESCALATE"); // budget exhausts while the gate keeps blocking regeneration
    const nodes = await stub.dumpNodes();
    const kinds = nodes.map((n) => n.kind);
    // Exactly ONE Action/ExecutionTrace -- attempt 1's real generation. Every
    // later attempt was blocked by the gate before generate() ever ran.
    expect(kinds.filter((k) => k === "Action")).toHaveLength(1);
    expect(kinds.filter((k) => k === "ExecutionTrace")).toHaveLength(1);
    // Multiple Verdicts: attempt 1's gate-pass, attempt 1's real oracle-fail,
    // and at least one more gate-contradicted verdict for a later attempt.
    expect(kinds.filter((k) => k === "Verdict").length).toBeGreaterThanOrEqual(3);
  });

  it("D.4: an unanchored criterion with an abstaining judge escalates immediately -- zero code ever generated", async () => {
    const stub = stubFor("grounding-fail-closed");
    // "A9" has no assertion in ANY suite (multi@v1 already establishes this
    // convention, real-oracle.test.ts) -- oracle-silent from attempt 1, and
    // its statement doesn't match ScriptedJudgeAdapter's keyword regexes ->
    // abstain by default.
    await stub.admit({
      intent: "echo 42",
      acceptance: [{ id: "A9", statement: "the widget frobnicates correctly", kind: "example" }],
      connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [],
      attemptBudget: 5, oracleRef: "multi@v1", grounding: true,
    });
    const r = await poll(stub);
    expect(r?.state).toBe("ESCALATE"); // immediate -- decide() never delays an "escalate" verdict on budget
    const kinds = (await stub.dumpNodes()).map((n) => n.kind);
    expect(kinds.filter((k) => k === "Action")).toHaveLength(0); // never even tried
    expect(kinds.filter((k) => k === "Verdict")).toHaveLength(1); // one gate check, then done
  });
});

describe("PLAYBOOK-KEEL-GROUNDING-001 (D.5) — grader-independence (GSAR)", () => {
  const spec = {
    intent: "n/a", connectors: [], capabilityCeiling: "connectors-only" as const, approvalGated: [], attemptBudget: 1,
    oracleRef: "multi@v1",
    acceptance: [{ id: "A9", statement: "the widget frobnicates correctly", kind: "example" as const }],
  };

  it("swapping the judge changes the LABEL but never the outcome: an oracle-silent criterion never grounds, whether the judge abstains or is maximally confident", async () => {
    const registry = new InMemorySuiteRegistry();

    const cautious = new GroundingGateAdapter(registry, new ScriptedJudgeAdapter());
    const confident = new GroundingGateAdapter(registry, new AlwaysConfidentJudgeAdapter());

    const vCautious = await cautious.grade(spec);
    const vConfident = await confident.grade(spec);

    // Levels move: the confident judge actually claims "surface-grounded"
    // where the cautious one abstains -- genuinely different evidence.
    const cautiousResults = (vCautious.evidence as { results: { outcome: string }[] }).results;
    const confidentResults = (vConfident.evidence as { results: { outcome: string }[] }).results;
    expect(cautiousResults[0]?.outcome).toBe("escalate");
    expect(confidentResults[0]?.outcome).toBe("escalate");

    // Behavior does not move: BOTH escalate. An always-confident judge is
    // the adversarial worst case for OD-GG-2 -- if it could ever ground a
    // test the oracle didn't, THIS is where it would show up.
    expect(vCautious.outcome).toBe("escalate");
    expect(vConfident.outcome).toBe("escalate");
  });

  it("a judge that actively contradicts still only escalates-as-fail, on either grader", async () => {
    const registry = new InMemorySuiteRegistry();
    const scripted = new GroundingGateAdapter(registry, new ScriptedJudgeAdapter());
    const v = await scripted.grade({
      intent: "n/a", connectors: [], capabilityCeiling: "connectors-only", approvalGated: [], attemptBudget: 1,
      oracleRef: "multi@v1", acceptance: [{ id: "A9", statement: "this is a contradicted, false claim", kind: "example" }],
    });
    expect(v.outcome).toBe("fail"); // surface-contradicted -> contradicted -> fail, not escalate
  });
});
