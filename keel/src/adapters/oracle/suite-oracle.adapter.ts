/**
 * suite-oracle.adapter.ts — the REAL OraclePort (D2).
 *
 * Resolves oracleRef -> suite, compiles each acceptance criterion into a
 * runnable assertion, executes covered ones inline in a Dynamic Worker (S5),
 * and assembles a per-criterion Verdict. Fail-closed and honest:
 *   - a criterion tested false        -> "fail"         (-> AMEND)
 *   - a criterion with no assertion, a suite miss, or an assertion that threw
 *                                     -> "inconclusive"  (verifier can't
 *                                        judge -- NOT the same fact as a
 *                                        failed criterion, PLAYBOOK-KEEL-
 *                                        VERDICT-SET-001 L1; never a false
 *                                        fail, never a silent pass) (-> ESCALATE)
 * Independent of the generating model; runs only over the recorded trace.
 */
import type { OraclePort, OracleSpec, ExecutionTraceContent, VerdictContent } from "../../domain/index";
import { aggregateVerdict, type CriterionVerdictStatus } from "../../domain/index";
import type { CodemodeHandle } from "../codemode/runtime";
import { compileProgram, compileMetamorphic, type OracleSuiteRegistry } from "./suite";

type CritStatus = "pass" | "fail" | "unverifiable" | "error" | "not-applicable";

export class SuiteOracleAdapter implements OraclePort {
  constructor(private readonly rt: CodemodeHandle, private readonly registry: OracleSuiteRegistry) {}

  async verify(trace: ExecutionTraceContent, spec: OracleSpec): Promise<VerdictContent> {
    const t0 = Date.now();
    const suite = this.registry.resolve(spec.oracleRef);
    const perCriterion: Record<string, CritStatus> = {};
    // PLAYBOOK-KEEL-SPANNING-CHECKABILITY: a spanning clause (A7 already
    // guarantees it's CARRIED here, in spec.acceptance) with no matching
    // assertion in this child's resolved suite is fail-closed to
    // "unverifiable" exactly like any other missing assertion — that part
    // was already correct. What's missing is legibility: an ordinary
    // authoring gap and "this decomposition structurally cannot check the
    // spanning obligation it was required to carry" land in the same bucket
    // today. Tag exactly the ids in spec.spanning, nothing else.
    const spanningIds = new Set(spec.spanning ?? []);
    const spanningUncheckable: string[] = [];

    const covered = spec.acceptance
      .map((c) => ({ c, a: suite?.assertions.find((x) => x.criterionId === c.id) }))
      .filter((x): x is { c: typeof x.c; a: NonNullable<typeof x.a> } => {
        if (!x.a) {
          perCriterion[x.c.id] = "unverifiable";
          if (spanningIds.has(x.c.id)) spanningUncheckable.push(x.c.id);
          return false;
        }
        return true;
      });

    let raw: unknown = null;
    let observed: Record<string, unknown> = {};

    const plain = covered.filter((x) => !x.a.metamorphic);
    const meta = covered.filter((x) => !!x.a.metamorphic);

    // Plain criteria: assert against the single recorded trace (as before).
    if (suite && plain.length) {
      const out = await this.rt.tool().execute({ code: compileProgram(trace, plain.map((x) => x.a)) }, undefined);
      raw = out;
      const res = out.status === "completed" ? (out.result as { results?: Record<string, string>; observed?: Record<string, unknown> }) : {};
      const sandbox = res.results ?? {};
      observed = { ...observed, ...(res.observed ?? {}) };
      for (const { a } of plain) {
        const v = sandbox[a.criterionId];
        perCriterion[a.criterionId] = v === "pass" ? "pass" : v === "fail" ? "fail" : "error";
      }
    }

    // Metamorphic criteria: re-probe the action code over hidden inputs. Needs
    // the action code; without it they are unverifiable (fail-closed).
    if (suite && meta.length) {
      if (!spec.action?.code) {
        for (const { a } of meta) perCriterion[a.criterionId] = "unverifiable";
      } else {
        // PLAYBOOK-KEEL-RELATION-SCOPE-001 (R1): compileMetamorphic now
        // returns an ARRAY of per-probe statuses per criterion (scoped or
        // not -- a unified refactor, D.7). Rolled up here with the SAME
        // aggregateVerdict (L1) SuiteOracleAdapter's own overall outcome
        // uses below, so there is exactly one rollup rule in this file.
        const out = await this.rt.tool().execute({ code: compileMetamorphic(spec.action.code, meta.map((x) => ({ criterion: x.c, assertion: x.a }))) }, undefined);
        const res = out.status === "completed" ? (out.result as { results?: Record<string, readonly CriterionVerdictStatus[]>; observed?: Record<string, unknown> }) : {};
        const sandboxResults = res.results ?? {};
        observed = { ...observed, ...(res.observed ?? {}) };
        for (const { a } of meta) {
          const perProbe = sandboxResults[a.criterionId];
          if (!perProbe || !perProbe.length) { perCriterion[a.criterionId] = "error"; continue; }
          const rolled = aggregateVerdict(perProbe);
          perCriterion[a.criterionId] =
            rolled === "pass" ? "pass"
            : rolled === "fail" ? "fail"
            : rolled === "not-applicable" ? "not-applicable"
            : "unverifiable"; // rolled === "inconclusive" (or the unreachable "escalate")
        }
      }
    }

    // PLAYBOOK-KEEL-VERDICT-SET-001 (L1) / PLAYBOOK-KEEL-RELATION-SCOPE-001
    // (R1): the frozen results map now HONESTLY exposes inconclusive AND
    // not-applicable -- unverifiable/error/not-applicable are no longer
    // squashed into a false "fail"; the full per-criterion detail still
    // also lives in evidence.perCriterion (unchanged).
    const results: Record<string, CriterionVerdictStatus> = {};
    for (const [k, v] of Object.entries(perCriterion)) {
      results[k] = v === "pass" ? "pass" : v === "fail" ? "fail" : v === "not-applicable" ? "not-applicable" : "inconclusive";
    }
    const outcome: VerdictContent["outcome"] = aggregateVerdict(Object.values(results));

    return {
      outcome,
      // BRIEF-KEEL-SKILL-001: terminalError rides along so the NEXT generate()
      // call (if any — decide() already ESCALATEs immediately on a terminal
      // class, so this is only ever seen for an amend-worthy one) can select
      // an amend-prompt skill by divergence class, not just by intent.
      evidence: { suiteRef: spec.oracleRef, suiteFound: !!suite, perCriterion, observed, calls: trace.calls, raw, terminalError: trace.terminalError, spanningUncheckable },
      results,
      oracleRef: spec.oracleRef,
      attempt: 0,
      ms: Date.now() - t0,
    };
  }
}
