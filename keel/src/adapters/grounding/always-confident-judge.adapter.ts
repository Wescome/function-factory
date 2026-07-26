/**
 * always-confident-judge.adapter.ts — PLAYBOOK-KEEL-GROUNDING-001 (D.5): a
 * deliberately DIFFERENT, maximally adversarial `JudgeGraderPort` for the
 * grader-independence proof (GSAR). Never abstains, never contradicts --
 * always claims "surface-grounded", declaring itself `signal-observed`
 * (a different evidence type than the scripted judge's `model-inferred`,
 * to prove the gate's core doesn't special-case either label).
 *
 * If the grounding gate's core rules held only by accident of a
 * conveniently-cautious test judge, swapping THIS one in would expose it:
 * an always-confident judge is the worst case for "the judge may only
 * surface, never pass" (OD-GG-2) -- if the core is sound, this judge still
 * can never ground a test the oracle hasn't. The score's LEVELS move (every
 * oracle-silent criterion now scores at the judge's weight instead of
 * abstaining at zero); the BEHAVIOR (grounded is oracle-only) does not.
 */
import type { JudgeGraderPort } from "../../domain/index";
import type { AcceptanceCriterion } from "../../domain/index";

export class AlwaysConfidentJudgeAdapter implements JudgeGraderPort {
  async grade(_criterion: AcceptanceCriterion): Promise<{ label: "surface-grounded"; evidenceType: "signal-observed" }> {
    return { label: "surface-grounded", evidenceType: "signal-observed" };
  }
}
