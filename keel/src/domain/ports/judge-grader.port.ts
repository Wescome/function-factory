/**
 * judge-grader.port.ts — JudgeGraderPort (driven), PLAYBOOK-KEEL-GROUNDING-001
 * (B1). The guessing grader: grades what the oracle grader cannot reach
 * (world-knowledge claims), only ever consulted when the oracle is silent.
 * Swappable by design (D.5, GSAR's grader-independence): the gate's core
 * decision rules (`decideCriterion`/`aggregateGate`, grader.ts) only ever
 * read a grade's `label` and `evidenceType` — never which implementation of
 * this port produced it. `evidenceType` is grader-supplied, honestly: a
 * heuristic/pattern-matching judge declares `signal-observed`; an LLM-based
 * one declares `model-inferred`. Either way OD-GG-2 holds: this port may
 * only ever surface, never pass — the gate's core enforces that
 * structurally, not this port.
 */
import type { AcceptanceCriterion } from "../lineage/nodes";
import type { JudgeGradeLabel, EvidenceType } from "../grounding/grader";

export interface JudgeGraderPort {
  grade(criterion: AcceptanceCriterion): Promise<{ readonly label: JudgeGradeLabel; readonly evidenceType: EvidenceType }>;
}
