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
 *
 * PLAYBOOK-KEEL-DISPOSITION-001 (D1): a disposition overlay runs AFTER the
 * grounding gate's own oracle/judge grading (grounding/grader.ts stays
 * completely untouched, its proven core from the prior spike). For each
 * criterion carrying a `behaviorRef`: resolve its disposition -- the spec's
 * OWN carried `behaviorDispositions` first (mirrors `spanning`, checked
 * before the external ledger), else the `BehaviorLedgerPort`, else unknown.
 * `unknown` skips the judge call entirely (zero grounding-pass, D.2) and
 * forces escalate; `intentionally-change` additionally requires the spec's
 * root to match the ledger entry's recorded authority (B.3) or it also
 * escalates. A criterion with no `behaviorRef` is untouched (Track C).
 */
import type {
  GroundingGatePort, JudgeGraderPort, BehaviorLedgerPort, BehaviorLedgerEntry,
  SpecificationContent, VerdictContent, OracleGrade, JudgeGrade, RelationFamily,
} from "../../domain/index";
import {
  gradeOracleFact, gradeCriteria, aggregateGate, type GroundingWeights,
  resolveDisposition, authorityMatches, familyMismatch, overlayDisposition,
} from "../../domain/index";
import type { OracleSuiteRegistry } from "../oracle/suite";

/** A.1's `kind` is the closest existing signal to a graded relation's
 *  "family" until R4 defines one properly (B.4/OD-DISP-4 is explicit that
 *  family selection firms up later) -- "example" reads as an equality
 *  check, "property" as a bound. Documented placeholder, not a real
 *  classifier. */
function gradedFamilyOf(kind: "example" | "property"): RelationFamily {
  return kind === "property" ? "bound" : "equality";
}

export class GroundingGateAdapter implements GroundingGatePort {
  constructor(
    private readonly registry: OracleSuiteRegistry,
    private readonly judge: JudgeGraderPort,
    private readonly weights?: GroundingWeights,
    private readonly ledger?: BehaviorLedgerPort,
  ) {}

  private async resolveEntry(spec: SpecificationContent, behaviorRef: string): Promise<BehaviorLedgerEntry | null> {
    const local = spec.behaviorDispositions?.find((d) => d.behaviorRef === behaviorRef);
    if (local) {
      return {
        behaviorRef,
        behaviorDisposition: local.disposition,
        authority: local.authority ?? "",
        rationale: local.rationale ?? "",
        assignedBy: "owner", // a spec-carried entry IS the owner's classification, by construction
      };
    }
    return this.ledger ? this.ledger.resolve(behaviorRef) : null;
  }

  async grade(spec: SpecificationContent, evidence?: VerdictContent): Promise<VerdictContent> {
    const suite = this.registry.resolve(spec.oracleRef);

    const pairs = await Promise.all(spec.acceptance.map(async (c) => {
      const entry = c.behaviorRef ? await this.resolveEntry(spec, c.behaviorRef) : undefined;
      const disposition = c.behaviorRef ? resolveDisposition(entry) : undefined;

      const hasAssertion = !!suite?.assertions.some((a) => a.criterionId === c.id);
      const priorResult = evidence?.results[c.id];
      const oracle: OracleGrade = { criterionId: c.id, label: gradeOracleFact({ hasAssertion, priorResult }) };

      let judge: JudgeGrade | undefined;
      // D.2: unknown blocks BEFORE any grading -- skip the judge call
      // entirely when the disposition already settles this criterion.
      if (oracle.label === "silent" && disposition !== "unknown") {
        const j = await this.judge.grade(c);
        judge = { criterionId: c.id, label: j.label, evidenceType: j.evidenceType };
      }
      return { criterionId: c.id, oracle, judge, kind: c.kind, behaviorRef: c.behaviorRef, disposition, entry };
    }));

    const baseResults = gradeCriteria(pairs, this.weights);
    const dispositionEvidence: Record<string, { disposition: string; authorityOk: boolean; familyWarning: boolean }> = {};

    const results = baseResults.map((r, i) => {
      const p = pairs[i]!;
      if (p.disposition === undefined) return r; // no behaviorRef -- untouched (Track C)

      const authorityOk = authorityMatches(spec.derivedFrom?.root, p.entry?.authority ?? "");
      const outcome = overlayDisposition(r.outcome, p.disposition, authorityOk);
      const warning = familyMismatch(p.disposition, gradedFamilyOf(p.kind));
      dispositionEvidence[p.criterionId] = { disposition: p.disposition, authorityOk, familyWarning: warning };

      return outcome === r.outcome ? r : { ...r, outcome };
    });

    const outcome = aggregateGate(results);

    const perCriterion: Record<string, "pass" | "fail"> = {};
    for (const r of results) perCriterion[r.criterionId] = r.outcome === "grounded" ? "pass" : "fail";

    return {
      outcome,
      evidence: { source: "grounding-gate", suiteRef: spec.oracleRef, suiteFound: !!suite, results, dispositions: dispositionEvidence },
      results: perCriterion,
      oracleRef: spec.oracleRef,
      attempt: 0, // overwritten by the loop, mirrors every other OraclePort-shaped adapter
      ms: 0,
    };
  }
}
