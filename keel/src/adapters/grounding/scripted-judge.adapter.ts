/**
 * scripted-judge.adapter.ts — PLAYBOOK-KEEL-GROUNDING-001: a deterministic,
 * no-LLM `JudgeGraderPort` (mirrors `ScriptedModelAdapter`'s role for
 * `ModelPort` — the point is proving the LOOP wiring, not the judge).
 * Declares itself `model-inferred`, honestly: a real judge here would be an
 * LLM call: this fixture selects behavior by `criterion.statement` so tests
 * can exercise every branch (surface-grounded / surface-contradicted /
 * abstain) without one.
 */
import type { JudgeGraderPort } from "../../domain/index";
import type { AcceptanceCriterion } from "../../domain/index";
import type { JudgeGradeLabel } from "../../domain/index";

export class ScriptedJudgeAdapter implements JudgeGraderPort {
  async grade(criterion: AcceptanceCriterion): Promise<{ label: JudgeGradeLabel; evidenceType: "model-inferred" }> {
    const label: JudgeGradeLabel = /abstain/i.test(criterion.statement) ? "abstain"
      : /contradict|false|wrong/i.test(criterion.statement) ? "surface-contradicted"
      : /ground|plausible|likely/i.test(criterion.statement) ? "surface-grounded"
      : "abstain"; // default: never invent confidence for an un-keyed fixture (fail-closed default)
    return { label, evidenceType: "model-inferred" };
  }
}
