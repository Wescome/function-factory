/**
 * Improvement-loop mining + the deterministic (crystallized-procedure) pass.
 * Pure, substrate-free (D6). The miner is UNTRUSTED input — like the 6a deriver,
 * it only proposes; the gate (evaluateProcedure / evaluateImprovement) decides.
 * The real replay (re-run a procedure under the anchored oracle) and lineage
 * queries are substrate — injected here, wired by the agent.
 */
import { IMPROVABLE_SURFACES, type ImprovementDecision, type VerdictPair } from "./gate";

export interface TraceSummary {
  readonly key: string;       // task/intent pattern key
  readonly code: string;      // normalized procedure code
  readonly accepted: boolean; // terminal verified ACCEPT (within budget)
  readonly attempts: number;
}
export interface ProcedureCandidate {
  readonly key: string; readonly code: string;
  readonly support: number; readonly avgAttempts: number;
}

/** Mine recurring ACCEPTed procedures: same (key, code) verified-ACCEPTed
 *  >= minRepeats times with NO associated failure. */
export function mineProcedures(traces: readonly TraceSummary[], minRepeats = 2): ProcedureCandidate[] {
  const groups = new Map<string, TraceSummary[]>();
  for (const t of traces) {
    const k = `${t.key}\u0000${t.code}`;
    const g = groups.get(k); if (g) g.push(t); else groups.set(k, [t]);
  }
  const out: ProcedureCandidate[] = [];
  for (const ts of groups.values()) {
    const accepted = ts.filter((t) => t.accepted);
    if (accepted.length >= minRepeats && ts.every((t) => t.accepted)) {
      out.push({
        key: ts[0]!.key, code: ts[0]!.code, support: accepted.length,
        avgAttempts: accepted.reduce((s, t) => s + t.attempts, 0) / accepted.length,
      });
    }
  }
  return out;
}

/** Procedure gate: verified ACCEPT on replay + no regression + not MORE attempts
 *  than the arc it replaces (the value is reliability / fewer attempts). */
export function evaluateProcedure(p: {
  surfaces: readonly string[]; afterAccepted: boolean;
  regression: readonly VerdictPair[]; attemptsBefore: number; attemptsAfter: number;
  effectful?: boolean; // procedure calls an approval-gated connector
}): ImprovementDecision {
  const illegal = p.surfaces.filter((s) => !(IMPROVABLE_SURFACES as readonly string[]).includes(s));
  if (illegal.length) return { promote: false, disposition: "auto", reason: `rejects: non-harness surface(s) [${illegal.join(", ")}]` };
  // INV-IMPROVE-EFFECT-HUMAN: replay is side-effect-free, so an effectful procedure
  // cannot be auto-verified (it would perform the effect) and must NOT be auto-
  // promoted (promotion is not pre-approval). Route to a human — not a failure.
  if (p.effectful) return { promote: false, disposition: "human", reason: "human disposition: effectful (approval-gated) procedure — replay is side-effect-free; promotion is not pre-approval" };
  if (!p.afterAccepted) return { promote: false, disposition: "auto", reason: "rejects: procedure did not verify-ACCEPT on replay (self-score is not evidence)" };
  if (p.regression.some((t) => t.beforeAccepted && !t.afterAccepted)) return { promote: false, disposition: "auto", reason: "rejects: a regression trace lost its ACCEPT" };
  if (p.attemptsAfter > p.attemptsBefore) return { promote: false, disposition: "auto", reason: `rejects: procedure needs MORE attempts (${p.attemptsBefore}->${p.attemptsAfter})` };
  return { promote: true, disposition: "auto", reason: `promote: verified ACCEPT, 0 regressions, attempts ${p.attemptsBefore}->${p.attemptsAfter}` };
}

export interface ReplayResult { readonly afterAccepted: boolean; readonly attemptsAfter: number; readonly regression: readonly VerdictPair[]; readonly effectful?: boolean; }
export interface ProcedurePassResult { readonly candidate: ProcedureCandidate; readonly decision: ImprovementDecision; }

/** Deterministic pass: mine -> replay (injected) -> gate. Promotions are the
 *  procedures verified to re-ACCEPT without regression. */
export async function runProcedurePass(
  traces: readonly TraceSummary[],
  replay: (c: ProcedureCandidate) => Promise<ReplayResult>,
  minRepeats = 2,
): Promise<ProcedurePassResult[]> {
  const out: ProcedurePassResult[] = [];
  for (const c of mineProcedures(traces, minRepeats)) {
    const r = await replay(c);
    out.push({ candidate: c, decision: evaluateProcedure({
      surfaces: ["procedure"], afterAccepted: r.afterAccepted, regression: r.regression,
      attemptsBefore: Math.ceil(c.avgAttempts), attemptsAfter: r.attemptsAfter, effectful: r.effectful,
    }) });
  }
  return out;
}
