/**
 * PLAYBOOK-KEEL-GROUNDING-001 (D.2, D.4): the pure core -- monotone score,
 * fail-closed decision -- proven directly, including adversarial weights.
 */
import { describe, it, expect } from "vitest";
import {
  scoreCriterion, decideCriterion, gradeCriteria, aggregateGate, gradeOracleFact,
  DEFAULT_GROUNDING_WEIGHTS,
  type OracleGrade, type JudgeGrade, type GroundingWeights,
} from "../src/domain/index";

const oracle = (label: OracleGrade["label"]): OracleGrade => ({ criterionId: "A1", label });
const judge = (label: JudgeGrade["label"], evidenceType: JudgeGrade["evidenceType"] = "model-inferred"): JudgeGrade =>
  ({ criterionId: "A1", label, evidenceType });

const ADVERSARIAL_WEIGHTS: readonly GroundingWeights[] = [
  DEFAULT_GROUNDING_WEIGHTS,
  { toolObserved: 1, signalObserved: 1, modelInferred: 1 }, // flat -- no scale separation at all
  { toolObserved: 1, signalObserved: 1_000_000, modelInferred: 1_000_000 }, // judge weighted ABOVE oracle
  { toolObserved: 0.001, signalObserved: 1e9, modelInferred: 1e9 }, // oracle near-zero, judge astronomical
];

describe("gradeOracleFact — the oracle grader's label from real, already-computed facts", () => {
  it("a real assertion exists, no prior failure -> grounded", () => {
    expect(gradeOracleFact({ hasAssertion: true })).toBe("grounded");
  });
  it("no assertion, no prior result -> silent (nothing anchors it)", () => {
    expect(gradeOracleFact({ hasAssertion: false })).toBe("silent");
  });
  it("a prior REAL oracle verdict already failed this criterion -> contradicted, even if an assertion exists", () => {
    expect(gradeOracleFact({ hasAssertion: true, priorResult: "fail" })).toBe("contradicted");
  });
});

describe("D.4 — fail-closed: decideCriterion never silently passes", () => {
  it("oracle grounded -> grounded, judge irrelevant", () => {
    expect(decideCriterion(oracle("grounded"), judge("abstain"))).toBe("grounded");
  });
  it("oracle contradicted -> contradicted, judge irrelevant", () => {
    expect(decideCriterion(oracle("contradicted"), judge("surface-grounded"))).toBe("contradicted");
  });
  it("oracle silent + judge abstains -> escalate, never a silent pass", () => {
    expect(decideCriterion(oracle("silent"), judge("abstain"))).toBe("escalate");
  });
  it("oracle silent + NO judge at all -> escalate, never a silent pass", () => {
    expect(decideCriterion(oracle("silent"), undefined)).toBe("escalate");
  });
  it("OD-GG-2: oracle silent + judge SURFACE-GROUNDED -> still escalate, never grounded -- the judge may only surface, never pass", () => {
    expect(decideCriterion(oracle("silent"), judge("surface-grounded"))).toBe("escalate");
  });
  it("oracle silent + judge surface-contradicted -> contradicted (the judge CAN raise suspicion)", () => {
    expect(decideCriterion(oracle("silent"), judge("surface-contradicted"))).toBe("contradicted");
  });
});

describe("D.2 — INV-GRADE-MONOTONE (structural, not numeric, v1.3): a model-inferred label never grounds a test on its own, for every weight set", () => {
  it.each(ADVERSARIAL_WEIGHTS)("scoreCriterion never lets a judge-grounded label flip an oracle-contradicted sign (weights=%o)", (weights) => {
    const s = scoreCriterion(oracle("contradicted"), judge("surface-grounded"), weights);
    expect(s).toBeLessThan(0); // the oracle's contradiction always wins the sign
  });

  it.each(ADVERSARIAL_WEIGHTS)("decideCriterion is structurally immune to weights -- it doesn't even take them (weights=%o)", (weights) => {
    // decideCriterion has no weights parameter at all; this test documents
    // WHY that's the guarantee -- there is no weight set to attack.
    void weights;
    expect(decideCriterion(oracle("silent"), judge("surface-grounded"))).toBe("escalate");
    expect(decideCriterion(oracle("contradicted"), judge("surface-grounded"))).toBe("contradicted");
  });

  it.each(ADVERSARIAL_WEIGHTS)("aggregateGate never reaches pass when any criterion is oracle-contradicted (weights=%o)", (weights) => {
    const results = gradeCriteria([
      { criterionId: "A1", oracle: oracle("contradicted"), judge: judge("surface-grounded") },
      { criterionId: "A2", oracle: oracle("grounded") },
    ], weights);
    expect(aggregateGate(results)).toBe("fail");
  });
});

describe("gradeCriteria / aggregateGate — the whole-gate rollup", () => {
  it("everything grounded -> pass (proceed to generation)", () => {
    const results = gradeCriteria([
      { criterionId: "A1", oracle: oracle("grounded") },
      { criterionId: "A2", oracle: oracle("grounded") },
    ]);
    expect(aggregateGate(results)).toBe("pass");
  });
  it("any escalate (and nothing contradicted) -> escalate", () => {
    const results = gradeCriteria([
      { criterionId: "A1", oracle: oracle("grounded") },
      { criterionId: "A2", oracle: oracle("silent"), judge: judge("abstain") },
    ]);
    expect(aggregateGate(results)).toBe("escalate");
  });
  it("contradicted outranks escalate in the rollup (fix the test first)", () => {
    const results = gradeCriteria([
      { criterionId: "A1", oracle: oracle("contradicted") },
      { criterionId: "A2", oracle: oracle("silent"), judge: judge("abstain") },
    ]);
    expect(aggregateGate(results)).toBe("fail");
  });
});
