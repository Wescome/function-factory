/**
 * suite-oracle.adapter.ts — the REAL OraclePort (D2).
 *
 * Resolves oracleRef -> suite, compiles each acceptance criterion into a
 * runnable assertion, executes covered ones inline in a Dynamic Worker (S5),
 * and assembles a per-criterion Verdict. Fail-closed and honest:
 *   - a criterion tested false        -> "fail"   (-> AMEND)
 *   - a criterion with no assertion, a suite miss, or an assertion that threw
 *                                     -> "escalate" (verifier can't verify;
 *                                        never a silent pass)  (-> ESCALATE)
 * Independent of the generating model; runs only over the recorded trace.
 */
import type { OraclePort, OracleSpec, ExecutionTraceContent, VerdictContent } from "../../domain/index";
import type { CodemodeHandle } from "../codemode/runtime";
import { compileProgram, compileMetamorphic, type OracleSuiteRegistry } from "./suite";

type CritStatus = "pass" | "fail" | "unverifiable" | "error";

export class SuiteOracleAdapter implements OraclePort {
  constructor(private readonly rt: CodemodeHandle, private readonly registry: OracleSuiteRegistry) {}

  async verify(trace: ExecutionTraceContent, spec: OracleSpec): Promise<VerdictContent> {
    const t0 = Date.now();
    const suite = this.registry.resolve(spec.oracleRef);
    const perCriterion: Record<string, CritStatus> = {};

    const covered = spec.acceptance
      .map((c) => ({ c, a: suite?.assertions.find((x) => x.criterionId === c.id) }))
      .filter((x): x is { c: typeof x.c; a: NonNullable<typeof x.a> } => {
        if (!x.a) { perCriterion[x.c.id] = "unverifiable"; return false; }
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
        const out = await this.rt.tool().execute({ code: compileMetamorphic(spec.action.code, meta.map((x) => x.a)) }, undefined);
        const res = out.status === "completed" ? (out.result as { results?: Record<string, string>; observed?: Record<string, unknown> }) : {};
        const sandbox = res.results ?? {};
        observed = { ...observed, ...(res.observed ?? {}) };
        for (const { a } of meta) {
          const v = sandbox[a.criterionId];
          perCriterion[a.criterionId] = v === "pass" ? "pass" : v === "fail" ? "fail" : "error";
        }
      }
    }

    const statuses = Object.values(perCriterion);
    const outcome: VerdictContent["outcome"] =
      statuses.length === 0 || statuses.some((s) => s === "unverifiable" || s === "error") ? "escalate"
      : statuses.some((s) => s === "fail") ? "fail"
      : "pass";

    // Frozen results map is pass|fail; the authoritative per-criterion detail
    // (incl. unverifiable/error) lives in evidence.
    const results: Record<string, "pass" | "fail"> = {};
    for (const [k, v] of Object.entries(perCriterion)) results[k] = v === "pass" ? "pass" : "fail";

    return {
      outcome,
      results,
      evidence: { suiteRef: spec.oracleRef, suiteFound: !!suite, perCriterion, observed, calls: trace.calls, raw },
      oracleRef: spec.oracleRef,
      attempt: 0,
      ms: Date.now() - t0,
    };
  }
}
