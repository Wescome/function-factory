/**
 * grounding-gate.adapter.ts — PLAYBOOK-KEEL-GROUNDING-001 (B1): the real
 * `GroundingGatePort`. Sources the oracle grader's "recorded fact" from two
 * REAL, already-existing places (A.4) rather than inventing a third: the
 * frozen `OracleSuiteRegistry` (does a real, checkable assertion exist for
 * this criterion — the same registry `SuiteOracleAdapter` already resolves
 * post-generation) and the prior attempt's own real oracle verdict
 * (`evidence.results[criterionId]` — mirrors the sandbox-oracle's pattern
 * of reading an already-recorded fact off prior state, A.4's hint). Live
 * repo/symbol anchoring (R1) is a named fast-follow, not built here.
 *
 * The judge is only ever consulted when the oracle is silent (B.1: "grades
 * what the oracle cannot reach") -- saves a call for every criterion the
 * oracle already has an opinion on.
 */
import type { GroundingGatePort, JudgeGraderPort, SpecificationContent, VerdictContent, OracleGrade, JudgeGrade } from "../../domain/index";
import { gradeOracleFact, gradeCriteria, aggregateGate, type GroundingWeights } from "../../domain/index";
import type { OracleSuiteRegistry } from "../oracle/suite";

export class GroundingGateAdapter implements GroundingGatePort {
  constructor(
    private readonly registry: OracleSuiteRegistry,
    private readonly judge: JudgeGraderPort,
    private readonly weights?: GroundingWeights,
  ) {}

  async grade(spec: SpecificationContent, evidence?: VerdictContent): Promise<VerdictContent> {
    const suite = this.registry.resolve(spec.oracleRef);

    const pairs = await Promise.all(spec.acceptance.map(async (c) => {
      const hasAssertion = !!suite?.assertions.some((a) => a.criterionId === c.id);
      const priorResult = evidence?.results[c.id];
      const oracle: OracleGrade = { criterionId: c.id, label: gradeOracleFact({ hasAssertion, priorResult }) };

      let judge: JudgeGrade | undefined;
      if (oracle.label === "silent") {
        const j = await this.judge.grade(c);
        judge = { criterionId: c.id, label: j.label, evidenceType: j.evidenceType };
      }
      return { criterionId: c.id, oracle, judge };
    }));

    const results = gradeCriteria(pairs, this.weights);
    const outcome = aggregateGate(results);

    const perCriterion: Record<string, "pass" | "fail"> = {};
    for (const r of results) perCriterion[r.criterionId] = r.outcome === "grounded" ? "pass" : "fail";

    return {
      outcome,
      evidence: { source: "grounding-gate", suiteRef: spec.oracleRef, suiteFound: !!suite, results },
      results: perCriterion,
      oracleRef: spec.oracleRef,
      attempt: 0, // overwritten by the loop, mirrors every other OraclePort-shaped adapter
      ms: 0,
    };
  }
}
