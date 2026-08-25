/**
 * PLAYBOOK-KEEL-LIFT-PROPOSER-001 — the FULL loop, end to end, against
 * REAL probe execution (compileMetamorphic + `new Function()`, mirroring
 * test/family-oracle.test.ts's eval style) — not synthetic booleans. Proves
 * D.2 (a sound candidate completes: propose -> challenge -> surface ->
 * ratify -> written, through freezeGate) and D.3 (an overgeneral candidate
 * is defeated by a REAL failing probe and never surfaces as-is), plus
 * D.3's narrow-and-re-challenge path against a genuinely re-executed probe.
 */
import { describe, it, expect } from "vitest";
import {
  proposeCandidate, challengeCandidate, surfaceCandidate, ratifyAndWrite,
  type ChallengeCase, type SpecificationContent, type GatePolicy,
} from "../src/domain/index";
import { compileMetamorphic, type OracleAssertion } from "../src/adapters/oracle/suite";
import type { AcceptanceCriterion } from "../src/domain/index";

// eslint-disable-next-line no-new-func
const run = (code: string) => new Function(code)() as { results: Record<string, string[]> };

/** Runs the candidate's family probe for real (the same compileMetamorphic
 * production uses) and turns the per-probe status array into ChallengeCase[]
 * -- a failing probe's legitimacy is supplied by the test (playing the
 * role of the model/human judgment challenge.ts deliberately doesn't
 * invent). */
function realChallenge(
  actionCode: string, probes: readonly number[], family: AcceptanceCriterion["family"],
  applicability: readonly string[] | undefined, invalidators: readonly string[] | undefined,
  legitimacyOf: (input: number) => ChallengeCase["legitimacy"],
): readonly ChallengeCase[] {
  const criterion: AcceptanceCriterion = { id: "A1", statement: "s", kind: "property", family, applicability, invalidators };
  const assertion: OracleAssertion = { criterionId: "A1", kind: "property", metamorphic: { probes } };
  const { results } = run(compileMetamorphic(actionCode, [{ criterion, assertion }]));
  return probes.map((input, i) => {
    const status = results.A1![i];
    const passed = status === "pass" || status === "not-applicable"; // excluded-from-tally counts as not-defeated
    return passed ? { input, passed: true } : { input, passed: false, legitimacy: legitimacyOf(input) };
  });
}

const parent: SpecificationContent = {
  intent: "x", connectors: ["echo"], capabilityCeiling: "connectors-only", approvalGated: [], attemptBudget: 2,
  oracleRef: "derived-mr@v1", decomposable: true,
  behaviorDispositions: [{ behaviorRef: "refund-flow", disposition: "preserve" }],
  acceptance: [{ id: "A1", statement: "check equals value doubled", kind: "example", behaviorRef: "refund-flow" }],
};
const policy: GatePolicy = { effectful: [] };

describe("the Lift-Proposer, end to end, real probe execution", () => {
  it("D.2: a sound candidate survives, surfaces, and (ratified) writes through freezeGate", () => {
    const proposal = proposeCandidate("A1", { kind: "equality", expected: "input * 2" }, "preserve");
    expect(proposal.admitted).toBe(true);
    if (!proposal.admitted) return;

    const cases = realChallenge("return value * 2;", [0, 1, -1, 100, -100], proposal.candidate.family, undefined, undefined, () => "confirmed-legitimate");
    const challenged = challengeCandidate(proposal.candidate, cases);
    expect(challenged.survives).toBe(true); // genuinely correct code -- every real probe passes

    const surfaced = surfaceCandidate(challenged.candidate, false);
    expect(surfaced.ready).toBe(true);
    if (!surfaced.ready) return;

    const written = ratifyAndWrite(surfaced.surfaced.candidate, { ratified: true }, parent, parent, policy);
    expect(written.written).toBe(true);
    if (written.written) {
      expect(written.gate.tier).not.toBe("reject");
      expect(written.spec.acceptance.find((a) => a.id === "A1")?.kind).toBe("property");
    }
  });

  it("D.3: an overgeneral candidate is DEFEATED by a real, legitimate failing probe -- never surfaces as-is", () => {
    const proposal = proposeCandidate("A1", { kind: "equality", expected: "input * 2" }, "preserve");
    expect(proposal.admitted).toBe(true);
    if (!proposal.admitted) return;

    // wrong for input=100 specifically -- a normal, legitimate input the
    // requirement genuinely covers, not excludable.
    const code = "return value === 100 ? 999 : value * 2;";
    const cases = realChallenge(code, [0, 1, -1, 100, -100], proposal.candidate.family, undefined, undefined, () => "confirmed-legitimate");
    const challenged = challengeCandidate(proposal.candidate, cases);

    expect(challenged.survives).toBe(false);
    expect(challenged.candidate.status).toBe("rejected");
    expect(challenged.legitimateDefeats.map((d) => d.input)).toEqual([100]);

    const surfaced = surfaceCandidate(challenged.candidate, false);
    expect(surfaced.ready).toBe(false); // B.3: never surfaced as-is
  });

  it("D.3 (the narrow-and-re-challenge path): a candidate wrong ONLY on an illegitimate boundary case narrows and survives, and the narrowed exclusion holds under a REAL re-probe", () => {
    const proposal = proposeCandidate("A1", { kind: "equality", expected: "input * 2" }, "preserve");
    expect(proposal.admitted).toBe(true);
    if (!proposal.admitted) return;

    // wrong ONLY for input=-100 -- an out-of-domain boundary case the
    // requirement doesn't actually require (confirmed-illegitimate).
    const code = "return value === -100 ? 0 : value * 2;";
    const round1 = realChallenge(code, [0, 1, -1, 100, -100], proposal.candidate.family, undefined, undefined, (input) => (input === -100 ? "confirmed-illegitimate" : "confirmed-legitimate"));
    const challenged1 = challengeCandidate(proposal.candidate, round1);
    expect(challenged1.survives).toBe(true);
    expect(challenged1.candidate.applicability).toEqual(["input !== -100"]);

    // RE-CHALLENGE for real: compileMetamorphic, run again with the
    // candidate's NOW-NARROWED applicability -- -100 must read
    // not-applicable this time (excluded, not silently re-failed).
    const criterion: AcceptanceCriterion = {
      id: "A1", statement: "s", kind: "property", family: challenged1.candidate.family, applicability: challenged1.candidate.applicability,
    };
    const assertion: OracleAssertion = { criterionId: "A1", kind: "property", metamorphic: { probes: [0, 1, -1, 100, -100] } };
    const { results } = run(compileMetamorphic(code, [{ criterion, assertion }]));
    expect(results.A1).toEqual(["pass", "pass", "pass", "pass", "not-applicable"]);

    const surfaced = surfaceCandidate(challenged1.candidate, false);
    expect(surfaced.ready).toBe(true); // survives, genuinely, under real re-probing
  });
});
