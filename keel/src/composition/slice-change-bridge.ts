/**
 * composition/slice-change-bridge.ts — PLAYBOOK-KEEL-SCR-PORT-4 (Track 1):
 * the join between KEEL's own orchestration (C1/C1b/C2) and SCR's review
 * log, at the slice→Change boundary.
 *
 * Substrate-aware by construction (it drives `ReviewCore`'s RPC surface),
 * so it lives in `composition/`, not `domain/` — the pure half of the
 * translation is `domain/spec-loop/slice-change.ts`, which this file
 * consumes.
 *
 * THE SPINE. Every stage of KEEL's own loop already has an exact
 * counterpart in SCR's log; this file is the wiring, not a new policy:
 *
 *   slice (a C2 derived child)      →  Change      (`openChange`)
 *   its written hunks               →  Revision    (`appendRevision`)
 *   its VERIFY verdict              →  Check       (`recordCheck`, "integrated")
 *   its human approval (PAUSE→approve)
 *                                   →  Verdict     (`recordVerdict`, "approve")
 *   C2's `dependsOnClauses`         →  `parents`   (one graph, not two)
 *
 * Two things this file refuses to do, both for the same reason (the
 * review log is signed and append-only, so anything it records must be
 * true):
 *
 *  1. It never invents an approver. A slice that is approval-gated but
 *     whose approver identity the caller does not know cannot be
 *     projected: there is no honest name to sign a verdict with, and
 *     defaulting to a literal ("human", "keel", the actor id) would put a
 *     signature in an append-only log against someone who never
 *     approved anything. The caller must supply the real identity — which
 *     is exactly why `Orchestrator.approve()` now takes and records an
 *     `approverId` (PORT-4, locked decision 2).
 *  2. It never records a verdict for a gate that has not actually been
 *     cleared. A gated-but-unapproved slice gets its Change opened WITH
 *     the approver in `requiredReviewers` and NO verdict, so `land()`
 *     refuses it (INV-3, `service.ts:699-706`) until a real approval
 *     arrives. Fail-closed by construction: the absence of evidence
 *     blocks the land rather than passing it.
 */
import type { Hunk, CheckKind, CheckOutcome, Decision } from "../scr/events";
import { InvariantViolation } from "../scr/events";
import type { ExecutionTraceContent, ConnectorCall } from "../domain/index";
import type { SliceChangeMapping } from "../domain/spec-loop/slice-change";
import type { JoinChildReport } from "./orchestrator";

/** What this bridge needs off `ReviewCore` — declared structurally rather
 *  than importing the DO class, so it is equally satisfiable by a real
 *  `DurableObjectStub<ReviewCore>` (Track 3's wiring) and by a plain
 *  object (the pure tests). Every method here exists on `ReviewCore` with
 *  a compatible signature; `openChange`'s 5th parameter and
 *  `appendRevision`'s 4th are the two PORT-4 widened onto it. */
export interface ReviewCoreLike {
  openChange(
    actorId: string,
    seriesId: string,
    title: string,
    requiredReviewers?: string[],
    parents?: string[],
  ): Promise<string>;
  appendRevision(actorId: string, changeId: string, hunks: Hunk[], reason?: string): Promise<number>;
  recordCheck(actorId: string, changeId: string, kind: CheckKind, outcome: CheckOutcome): Promise<string>;
  recordVerdict(reviewerId: string, changeId: string, decision: Decision): Promise<string>;
}

/** One projected slice. */
export interface SliceLanding {
  readonly servesClause: string;
  readonly changeId: string;
}

/**
 * A slice's human-approval state, as the CALLER knows it — never as this
 * file guesses it.
 *
 *  - `undefined` returned for a slice: that slice is not approval-gated
 *    (`approvalGated: []`). Its Change gets `requiredReviewers: []` and no
 *    verdict, and `land()` demands nothing of it — which is correct, and
 *    is already `land()`'s own behavior for an empty required list.
 *  - `{ approverId, approved: true }`: the gate was really cleared, by
 *    that identity (the one passed to `Orchestrator.approve(approverId)`
 *    and recorded there). The Change gets `requiredReviewers:
 *    [approverId]` AND a signed `approve` verdict from the same identity.
 *  - `{ approverId, approved: false }`: the slice is gated and the gate is
 *    still held by that identity. The Change gets `requiredReviewers:
 *    [approverId]` and NO verdict — `land()` refuses it until a real
 *    approval is recorded.
 *
 * There is deliberately no fourth case. "Gated, approver unknown" is not
 * representable, because nothing honest could be written for it.
 */
export interface SliceApproval {
  readonly approverId: string;
  readonly approved: boolean;
}

export interface ProjectOptions {
  /** Who is doing the projecting — the actor named on the ChangeOpened /
   *  RevisionAppended / CheckRecorded envelopes. NOT an approver: this
   *  identity never signs a verdict. */
  readonly actorId?: string;
  /** C2's dependency edges for this slice, as CLAUSE ids (the output of
   *  `seriesParentsFor`). Default: no dependencies — every slice a root. */
  readonly parentClausesOf?: (c: JoinChildReport) => readonly string[];
  /** The slice's approval state; see `SliceApproval`. Default: nothing is
   *  gated. */
  readonly approvalOf?: (c: JoinChildReport) => SliceApproval | undefined;
  /** Title for the Change. Default: the clause id. */
  readonly titleOf?: (c: JoinChildReport) => string;
}

/**
 * The insertion SEQUENCE: a dependency-respecting order over the slices,
 * with the input order as tiebreak. Needed purely because a Change's
 * parents must already exist in the log when `openChange` names them.
 *
 * This is not a second ordering authority, and it provably cannot become
 * one. `Model.openOrder` is Kahn's algorithm over the SAME edges with
 * ties broken by the order changes were OPENED (`model.ts:401`) — i.e.
 * by exactly this sequence. When a rank order is itself a valid
 * topological order, Kahn-picking-the-lowest-ready-rank reproduces it
 * exactly: the lowest-rank unemitted node always has every parent already
 * emitted (its parents have lower rank), so it is always ready and always
 * minimal. By induction `Model.openOrder` === this sequence, for every
 * batch. The Track 1 test asserts that equality on a fixture whose input
 * order is deliberately NOT its topological order, so the claim is
 * checked rather than merely argued.
 */
function insertionSequence(
  children: readonly JoinChildReport[],
  parentClausesOf: (c: JoinChildReport) => readonly string[],
): readonly JoinChildReport[] {
  const byClause = new Map<string, JoinChildReport>();
  for (const c of children) if (c.servesClause) byClause.set(c.servesClause, c);

  const emitted = new Set<string>();
  const out: JoinChildReport[] = [];
  for (;;) {
    let progressed = false;
    for (const [clause, child] of byClause) {
      if (emitted.has(clause)) continue;
      const deps = parentClausesOf(child).filter((p) => byClause.has(p));
      if (!deps.every((p) => emitted.has(p))) continue;
      emitted.add(clause);
      out.push(child);
      progressed = true;
    }
    if (!progressed) break;
  }
  if (out.length !== byClause.size) {
    // Unreachable through the live path: `checkDependencyGraph` fails the
    // whole batch on a cycle before any candidate is admitted (C2a,
    // INV-HANDOFF-CYCLE). Kept as a fail-closed floor rather than a
    // silent partial projection, and named on the SCR invariant that owns
    // acyclicity so the two checks read as the one guarantee they are.
    const stranded = [...byClause.keys()].filter((c) => !emitted.has(c)).sort();
    throw new InvariantViolation(
      "INV-13",
      `slice dependency graph is cyclic — ${stranded.join(",")} can never be ordered`,
    );
  }
  return out;
}

/**
 * Project a batch of finished slices into the review log as a Change per
 * slice, wired into ONE graph.
 *
 * `hunksOf` supplies each slice's content. In the live wiring that is
 * `Orchestrator.writtenHunks()` (PORT-4, Track 2) — the recorded
 * `state.writeFile`/`state.writeSection` calls off the slice's own
 * ExecutionTraces, an observed set, never a declared one. A slice that
 * wrote nothing yields no hunks, and is skipped: a Change with no
 * revision is DRAFT, and `land()` refuses to land a DRAFT (INV-2), so
 * opening one would only ever poison an otherwise landable set.
 */
export async function projectSlicesAsChanges(
  core: ReviewCoreLike,
  seriesId: string,
  children: readonly JoinChildReport[],
  hunksOf: (c: JoinChildReport) => Hunk[],
  opts: ProjectOptions = {},
): Promise<readonly SliceLanding[]> {
  const actorId = opts.actorId ?? "keel";
  const parentClausesOf = opts.parentClausesOf ?? (() => []);
  const approvalOf = opts.approvalOf ?? (() => undefined);
  const titleOf = opts.titleOf ?? ((c: JoinChildReport) => c.servesClause ?? c.runId);

  const ordered = insertionSequence(children, parentClausesOf);
  const changeOf = new Map<string, string>(); // clause -> changeId
  const mappings: SliceChangeMapping[] = [];

  for (const child of ordered) {
    const clause = child.servesClause!;
    const hunks = hunksOf(child);
    if (hunks.length === 0) continue;

    // Explicitly `[]` for a root, never `undefined`: `openChange`'s own
    // default is "stack on the current tips" (service.ts:138), which
    // would silently invent a linear spine C2 never declared — the
    // second graph, arriving by omission.
    const parents = parentClausesOf(child)
      .map((p) => changeOf.get(p))
      .filter((id): id is string => !!id);

    const approval = approvalOf(child);
    const requiredReviewers = approval ? [approval.approverId] : [];

    const changeId = await core.openChange(actorId, seriesId, titleOf(child), requiredReviewers, parents);
    changeOf.set(clause, changeId);
    mappings.push({ servesClause: clause, changeId, parents });

    await core.appendRevision(actorId, changeId, hunks, "author-edit");

    // Check = VERIFY verdict. `recordCheck` self-stamps BOTH INV-4 axes
    // (revision seq + base fingerprint, service.ts:298-307), so a later
    // base move stales this with no event and no heuristic — which is
    // precisely the guarantee KEEL's own per-slice VERIFY never had.
    await core.recordCheck(actorId, changeId, "integrated", child.outcome === "pass" ? "pass" : "fail");

    // Verdict = the HUMAN approval, and only ever a real one.
    if (approval?.approved) {
      await core.recordVerdict(approval.approverId, changeId, "approve");
    }
  }

  return mappings.map((m) => ({ servesClause: m.servesClause, changeId: m.changeId }));
}

/** The write-effectful `state.*` calls `writtenHunks()` reads. Kept here
 *  beside `mergedTraceFor`, which has to remove exactly the calls that
 *  produced the hunks it is replacing — if these two ever disagreed, a
 *  merged trace would carry a slice's pre-merge write AND the merged one. */
function isHunkWrite(c: ConnectorCall): boolean {
  return c.connector === "state" && (c.method === "writeFile" || c.method === "writeSection");
}

/**
 * PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1): one slice's own ExecutionTrace,
 * restated over the content a seam merge actually produced — the input
 * KEEL's VERIFY needs in order to be re-run on merged content at all.
 *
 * OD-PORT4-1's requirement is that the check re-runs on the MERGED
 * content. VERIFY is a set of assertions over an `ExecutionTraceContent`
 * (`compileProgram`, suite.ts), and a merge is not an execution: it
 * produces content, not a trace. This is the bridge between those two
 * facts, and it is deliberately the smallest possible one.
 *
 * What changes: every write-effectful `state.*` call is dropped and
 * replaced by one call per merged hunk, in the merge's own order. After
 * the merge those are the writes that actually stand — the slice's own
 * pre-merge write to a region another slice also wrote is no longer what
 * the file says. This is the ONLY thing the merge is entitled to change,
 * and it is the exact inverse of `Orchestrator.writtenHunks()`, which
 * derived those hunks from these same calls.
 *
 * What does NOT change, and why: `result`, `status`, `egress`, `error`,
 * `terminalError` and every non-write call stay the slice's own recorded
 * values. They are facts about an execution that really happened, and no
 * merge re-runs that execution — restating them would be inventing an
 * observation. The consequence is disclosed rather than hidden: an
 * assertion that only reads `trace.result` is not made any more
 * discerning by being re-run here, and will return the same verdict it
 * returned for the slice alone. An assertion that reads what was WRITTEN
 * genuinely sees the merged content, and genuinely can now fail.
 *
 * That asymmetry is not left for a caller to notice. `OracleAssertion`
 * carries a declared `mergeSensitive` flag, and
 * `Orchestrator.verifyMergedContent` refuses to record a check derived
 * from an assertion that does not set it — the clause is treated as
 * unverifiable, no check is written, and `land()` refuses on INV-4.
 * A merge-blind assertion re-run here is a real oracle run answering
 * the wrong question, and the answer is discarded rather than recorded.
 *
 * The reconstructed calls carry NO `response`. A response is something a
 * connector returned during a real execution; nothing executed here, so
 * there is nothing to report and none is claimed. `ConnectorCall.response`
 * is optional precisely so absence is representable (nodes.ts:261-264).
 * `seq` continues the surviving calls' numbering — a position in this
 * restated trace, not a claim about when anything happened.
 */
export function mergedTraceFor(
  trace: ExecutionTraceContent,
  merged: readonly Hunk[],
): ExecutionTraceContent {
  const kept = trace.calls.filter((c) => !isHunkWrite(c));
  const calls: ConnectorCall[] = [
    ...kept,
    ...merged.map((hunk, i) => ({
      seq: kept.length + i,
      connector: "state",
      method: hunk.anchor === "file" ? "writeFile" : "writeSection",
      args:
        hunk.anchor === "file"
          ? { path: hunk.path, content: hunk.content }
          : { path: hunk.path, anchor: hunk.anchor, content: hunk.content },
    })),
  ];
  return { ...trace, calls };
}
