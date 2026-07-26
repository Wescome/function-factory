/**
 * run.ts — THE LOOP USE-CASE (Ring 1, substrate-free).
 *
 * Walks the full governed loop over the frozen ports and closes it (M3):
 * AMEND (fail + budget -> re-generate with evidence), ESCALATE (budget
 * exhausted / verifier escalate), and PAUSE (an approval-gated call aborts the
 * action; a later resume replays it — D8). Depends only on ports + domain
 * types + decide(); imports no substrate.
 */

import { decide } from "./decide";
import type { ContentHash } from "../lineage/contract";
import type {
  Specification, Action, ExecutionTrace, Verdict, Amendment, VerdictContent,
} from "../lineage/nodes";
import type { ModelPort } from "../ports/model.port";
import type { CodeExecutionPort } from "../ports/code-execution.port";
import type { OraclePort } from "../ports/oracle.port";
import type { LineageRepositoryPort } from "../ports/lineage-repository.port";

export interface RunPorts {
  readonly model: ModelPort;
  readonly exec: CodeExecutionPort;
  readonly oracle: OraclePort;
  readonly repo: LineageRepositoryPort;
  readonly now: () => number;
}

export type RunTerminal =
  | { readonly state: "ACCEPT"; readonly verdict: VerdictContent }
  | { readonly state: "ESCALATE"; readonly reason: string; readonly verdict?: VerdictContent }
  | { readonly state: "PAUSE"; readonly executionId: string; readonly action: ContentHash; readonly attempt: number };

/** Context needed to resume a paused run after a human approves the gate. */
export interface PauseContext {
  readonly action: ContentHash;
  readonly executionId: string;
  readonly attempt: number;
}

// --- one attempt: generate + execute --------------------------------------
type GenExec =
  | { readonly kind: "paused"; readonly action: Action; readonly executionId: string }
  | { readonly kind: "ready"; readonly action: Action; readonly trace: ExecutionTrace };

async function genExec(spec: Specification, p: RunPorts, attempt: number, evidence?: VerdictContent): Promise<GenExec> {
  const gen = await p.model.generate(spec.content, evidence);
  const action = await p.repo.append<Action>({
    kind: "Action",
    content: { code: gen.code, connectors: [...gen.connectors], attempt, skills: gen.skills },
    provenance: [{ rel: "PRODUCES", to: spec.id }],
  });
  await p.repo.emit({ type: "ActionGenerated", at: p.now(), run: spec.id, action: action.id, attempt });

  const outcome = await p.exec.execute(action.content);
  const trace = await p.repo.append<ExecutionTrace>({
    kind: "ExecutionTrace",
    content: outcome.trace,
    provenance: [{ rel: "EXECUTES", to: action.id }],
  });
  await p.repo.emit({ type: "ExecutionRecorded", at: p.now(), run: spec.id, trace: trace.id });

  if (outcome.status === "paused") {
    await p.repo.emit({ type: "ActionPaused", at: p.now(), run: spec.id, trace: trace.id, executionId: outcome.trace.executionId });
    return { kind: "paused", action, executionId: outcome.trace.executionId };
  }
  return { kind: "ready", action, trace };
}

// --- verify + decide for a completed attempt ------------------------------
type Decided =
  | { readonly done: RunTerminal }
  | { readonly amend: number; readonly evidence: VerdictContent };

async function verifyDecide(spec: Specification, p: RunPorts, action: Action, trace: ExecutionTrace, attempt: number): Promise<Decided> {
  const vcRaw = await p.oracle.verify(trace.content, {
    oracleRef: spec.content.oracleRef,
    acceptance: spec.content.acceptance,
    action: { code: action.content.code },
    spanning: spec.content.spanning,
  });
  const vc: VerdictContent = { ...vcRaw, attempt }; // the loop owns the attempt number
  const verdict = await p.repo.append<Verdict>({
    kind: "Verdict",
    content: vc,
    provenance: [{ rel: "VERIFIES", to: trace.id }],
  });
  await p.repo.emit({ type: "VerdictEmitted", at: p.now(), run: spec.id, verdict: verdict.id, outcome: vc.outcome, attempt });

  const d = decide({
    verdict: vc.outcome, attempt, budget: spec.content.attemptBudget,
    terminalError: trace.content.terminalError,
  });

  if (d.next === "ACCEPT") {
    await p.repo.emit({ type: "RunAccepted", at: p.now(), run: spec.id, verdict: verdict.id });
    return { done: { state: "ACCEPT", verdict: vc } };
  }
  if (d.next === "ESCALATE") {
    await p.repo.emit({ type: "RunEscalated", at: p.now(), run: spec.id, reason: d.reason, verdict: verdict.id });
    return { done: { state: "ESCALATE", reason: d.reason, verdict: vc } };
  }
  const failed = Object.entries(vc.results).filter(([, r]) => r === "fail").map(([k]) => k);
  const amendment = await p.repo.append<Amendment>({
    kind: "Amendment",
    content: { from: verdict.id, carries: failed, attempt: d.attempt },
    provenance: [{ rel: "AMENDS", to: verdict.id }],
  });
  await p.repo.emit({ type: "AmendmentRequested", at: p.now(), run: spec.id, amendment: amendment.id, attempt: d.attempt });
  return { amend: d.attempt, evidence: vc };
}

/** PLAYBOOK-KEEL-WRITE-ROLLBACK-001: after a completed attempt's verdict is
 *  decided, revert its writes if the attempt is done for (ESCALATE) or is
 *  about to be superseded by another try (AMEND) -- workspace-only, never
 *  the ledger (INV-RB-LEDGER-UNTOUCHED). ACCEPT never reverts: its effects
 *  are the point. Shared by `continueFrom` and `resumeApproved` (D8) so both
 *  paths honor the same rule. */
async function afterAttempt(p: RunPorts, executionId: string, vd: Decided): Promise<Decided> {
  if ("done" in vd) {
    // ESCALATE: best-effort cleanup: the run is terminal either way, so the
    // revert's own success/failure doesn't change the outcome returned.
    if (vd.done.state === "ESCALATE") await p.exec.revertAttempt(executionId);
    return vd;
  }
  // AMEND: C.3 fail-closed -- a revert that can't complete must not let the
  // loop regenerate atop a half-reverted scratch. Escalate instead.
  const rb = await p.exec.revertAttempt(executionId);
  if (!rb.reverted) {
    return { done: { state: "ESCALATE", reason: "rollback incomplete: the failed attempt's writes could not be cleanly reverted" } };
  }
  return vd;
}

const score = (v?: VerdictContent): number =>
  v ? Object.values(v.results).filter((r) => r === "pass").length : -1;

/** Best-of-N selector (D-C): among candidate verdicts, the first that PASSES;
 *  else the highest-scoring. The oracle is the selector — no new component. */
export function selectBest(verdicts: readonly VerdictContent[]): number {
  let bestIdx = 0, bestScore = -1;
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]!;
    if (v.outcome === "pass") return i;
    const sc = score(v);
    if (sc > bestScore) { bestScore = sc; bestIdx = i; }
  }
  return bestIdx;
}

// --- the loop, from a given attempt ---------------------------------------
async function continueFrom(spec: Specification, p: RunPorts, attempt: number, evidence?: VerdictContent): Promise<RunTerminal> {
  let a = attempt;
  let ev = evidence;
  let best = evidence; // best-scoring attempt so far (keep-best / D-B)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ge = await genExec(spec, p, a, ev);
    if (ge.kind === "paused") {
      return { state: "PAUSE", executionId: ge.executionId, action: ge.action.id, attempt: a };
    }
    const vd = await afterAttempt(p, ge.trace.content.executionId, await verifyDecide(spec, p, ge.action, ge.trace, a));
    if ("done" in vd) {
      // INV-NO-REGRESS: on escalate, report the best attempt seen, not the last.
      const done = vd.done;
      if (done.state === "ESCALATE" && score(best) > score(done.verdict)) {
        return { ...done, verdict: best };
      }
      return done;
    }
    // keep-best: never carry a strictly-worse attempt's evidence forward.
    if (score(vd.evidence) > score(best)) best = vd.evidence;
    ev = best;
    a = vd.amend;
  }
}

/** Start a run from attempt 1 (INTENT already done by the caller). */
export function runLoop(spec: Specification, p: RunPorts): Promise<RunTerminal> {
  return continueFrom(spec, p, 1, undefined);
}

/**
 * Resume a paused run after approval. D8: approve() replays the whole action —
 * prior logged calls are no-ops, the approved call runs for real — yielding a
 * completed trace, which then goes through verify/decide like any attempt.
 */
export async function resumeApproved(spec: Specification, p: RunPorts, ctx: PauseContext): Promise<RunTerminal> {
  const outcome = await p.exec.approve(ctx.executionId);
  const trace = await p.repo.append<ExecutionTrace>({
    kind: "ExecutionTrace",
    content: outcome.trace,
    provenance: [{ rel: "EXECUTES", to: ctx.action }],
  });
  await p.repo.emit({ type: "ExecutionRecorded", at: p.now(), run: spec.id, trace: trace.id });

  if (outcome.status === "paused") {
    // another gate in the same action
    await p.repo.emit({ type: "ActionPaused", at: p.now(), run: spec.id, trace: trace.id, executionId: outcome.trace.executionId });
    return { state: "PAUSE", executionId: outcome.trace.executionId, action: ctx.action, attempt: ctx.attempt };
  }

  // rebuild a minimal Action node for verifyDecide's provenance need
  const action = { id: ctx.action, kind: "Action", content: { code: "", connectors: [], attempt: ctx.attempt }, provenance: [] } as Action;
  const vd = await afterAttempt(p, trace.content.executionId, await verifyDecide(spec, p, action, trace, ctx.attempt));
  if ("done" in vd) return vd.done;
  return continueFrom(spec, p, vd.amend, vd.evidence);
}
